import process from "bare-process";
import "../qvac/worker.entry.mjs";
import { resolve } from "bare-path";
import { startComputeExchangeApi } from "../src/server/compute-exchange-api.js";
import { Discovery } from "../src/core/discovery.js";
import { LedgerNode } from "../src/ledger/node.js";
import { RatingsNode } from "../src/ratings/node.js";
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

const ratings = new RatingsNode({
  rootDir: resolve(`data/${peerName}/ratings`),
  name: peerName,
});
await ratings.ready();
ratings.startBackgroundUpdates();

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

discovery.on("rating", async ({ event }) => {
  try {
    await ratings.ingestEvent(event);
  } catch (err) {
    console.warn(`[ratings] failed to ingest rating: ${err?.message ?? err}`);
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
    peers: await enrichPeersWithRatings(discovery.listPeers(), ratings),
  }),
  onGetBalance: async () => ({
    balance: await ledger.balance(),
    log: await ledger.history(),
  }),
  onRate: async ({ provider, provider_id: providerIdAlt, score }) => {
    const requested = String(provider ?? providerIdAlt ?? "").trim();
    const target = resolveRatingTarget(discovery.listPeers(), requested);
    if (!target) {
      return { accepted: false, error: "Missing provider ledger account id to rate." };
    }

    const event = await ratings.createRating({ target, score: Number(score) });
    discovery.broadcastRatingEvent(event);

    const values = await ratings.ratingsFor(target);
    return {
      accepted: true,
      provider: target,
      score: event.score,
      average: await ratings.averageFor(target),
      count: values.length,
      rating: event,
    };
  },
  onGetRatings: async ({ target }) => {
    if (target) {
      const ratingsForTarget = await ratings.ratingsFor(target);
      return {
        target,
        average: await ratings.averageFor(target),
        count: ratingsForTarget.length,
        ratings: ratingsForTarget,
      };
    }

    return {
      averages: await ratings.allAverages(),
    };
  },
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
  await ratings.close();
  await ledger.close().catch(() => {});
  process.exit(0);
});

async function enrichPeersWithRatings(peers, ratings) {
  return Promise.all(
    peers.map(async (peer) => ({
      ...peer,
      rating: peer.ledgerAccountId ? await ratings.averageFor(peer.ledgerAccountId) : null,
    })),
  );
}

function resolveRatingTarget(peers, requested) {
  if (!requested) return null;

  const byLedger = peers.find((peer) => peer.ledgerAccountId === requested);
  if (byLedger?.ledgerAccountId) return byLedger.ledgerAccountId;

  const byPeer = peers.find((peer) => peer.peerId === requested);
  if (byPeer?.ledgerAccountId) return byPeer.ledgerAccountId;

  return requested;
}
