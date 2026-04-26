import process from "bare-process";
import "../qvac/worker.entry.mjs";
import { resolve } from "bare-path";
import { startComputeExchangeApi } from "../src/server/compute-exchange-api.js";
import { Discovery } from "../src/core/discovery.js";
import { LedgerNode } from "../src/ledger/node.js";
import { createChatHandler, createModelsHandler } from "../src/server/chat-handler.js";
import { config } from "../src/config.js";
import os from "bare-os";
const { hostname } = os;

const peerName = process.env.PEER_NAME || hostname();
const topic = process.env.QVAC_TOPIC || config.qvacTopic;

console.log(`[server] Starting P2P daemon for ${peerName}...`);

const ledger = new LedgerNode({
  rootDir: resolve(`data/${peerName}/ledger`),
  name: peerName,
});
await ledger.ready();
const ledgerRegistration = await ledger.announceAccount();
ledger.startBackgroundUpdates();
console.log(
  `[ledger] ${peerName} accountId=${ledger.accountId.slice(0, 12)} balance=${await ledger.balance()}`,
);

const discovery = new Discovery({
  topicHex: config.discoveryTopic,
  peerName,
  models: [],
  qvacTopic: topic,
  ledgerAccountId: ledger.accountId,
  ledgerRegistration,
});

discovery.on("ledgerRegister", async ({ event }) => {
  try {
    await ledger.ingestSignedEvent(event);
  } catch (err) {
    console.warn(`[ledger] failed to ingest registration: ${err?.message ?? err}`);
  }
});

discovery.on("ledgerProposal", async ({ event }) => {
  try {
    await ledger.ingestSignedEvent(event);
  } catch (err) {
    console.warn(`[ledger] failed to ingest proposal: ${err?.message ?? err}`);
  }
});

discovery.on("ledgerAcceptance", async ({ event }) => {
  try {
    await ledger.ingestSignedEvent(event);
  } catch (err) {
    console.warn(`[ledger] failed to ingest acceptance: ${err?.message ?? err}`);
  }
});

await discovery.start();
console.log(`[discovery] Joined as "${peerName}", peerId=${discovery.myPeerId().slice(0, 12)}`);

const api = await startComputeExchangeApi({
  host: "127.0.0.1",
  port: 11434,
  onGetModels: createModelsHandler({ discovery }),
  onGetPeers: async () => ({
    peerId: discovery.myPeerId(),
    peers: discovery.listPeers(),
  }),
  onGetBalance: async () => ({
    balance: await ledger.balance(),
    log: await ledger.history(),
  }),
  onChat: createChatHandler({
    ledger,
    discovery,
    pricePerRequest: config.ledger.pricePerRequest ?? 1,
  }),
});

console.log(`\n✅ HTTP API Server listening on ${api.url}`);
console.log(`   - Ollama API: ${api.url}/api/chat`);
console.log(`   - OpenAI API: ${api.url}/v1/chat/completions`);
console.log(`\nWaiting for providers to join the network...`);

async function shutdown(signal) {
  console.log(`\n[server] Received ${signal}; shutting down...`);
  await api.stop?.().catch(() => {});
  await discovery.stop().catch(() => {});
  await ledger.close().catch(() => {});
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  console.error("[server] Unhandled rejection:", reason?.message ?? reason);
});
