import process from "bare-process";
import "../qvac/worker.entry.mjs";
import { startComputeExchangeApi } from "../src/server/compute-exchange-api.js";
import { Discovery } from "../src/core/discovery.js";
import { Ledger } from "../src/core/ledger.js";
import { createChatHandler, createModelsHandler } from "../src/server/chat-handler.js";
import { config } from "../src/config.js";
import os from "bare-os";
const { hostname } = os;

const peerName = process.env.PEER_NAME || hostname();
const topic = process.env.QVAC_TOPIC || config.qvacTopic;

console.log(`[server] Starting P2P daemon for ${peerName}...`);

const ledger = new Ledger(`data/${peerName}.ledger.json`);
await ledger.load();
console.log(`[ledger] Starting balance: ${ledger.balance()}`);

const discovery = new Discovery({
  topicHex: config.discoveryTopic,
  peerName,
  models: [],
  qvacTopic: topic,
});

discovery.on("creditAck", async (ack) => {
  await ledger.earn(ack);
});

await discovery.start();
console.log(`[discovery] Joined as "${peerName}", peerId=${discovery.myPeerId().slice(0, 12)}`);

const api = await startComputeExchangeApi({
  host: "127.0.0.1",
  port: 11434,
  onGetModels: createModelsHandler({ discovery }),
  onGetPeers: async () => discovery.listPeers(),
  onGetBalance: async () => ({ balance: ledger.balance(), log: ledger.state.log }),
  onChat: createChatHandler({ ledger, discovery }),
});

console.log(`\n✅ HTTP API Server listening on ${api.url}`);
console.log(`   - Ollama API: ${api.url}/api/chat`);
console.log(`   - OpenAI API: ${api.url}/v1/chat/completions`);
console.log(`\nWaiting for providers to join the network...`);

process.on("SIGINT", async () => {
  console.log("Shutting down...");
  await api.stop?.();
  await discovery.stop();
  process.exit(0);
});
