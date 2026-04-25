import {
  startProvider,
  stopProvider,
  shutdown,
  preDownload,
} from "../src/core/qvac.js";
import { Discovery } from "../src/core/discovery.js";
import { Ledger } from "../src/core/ledger.js";
import { config, getModel, listModels } from "../src/config.js";
import { hostname } from "node:os";

const topic = process.env.QVAC_TOPIC || config.qvacTopic;
const peerName = process.env.PEER_NAME || hostname();
const modelKeys = (process.env.MODELS || listModels().map((m) => m.key).join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const servedModels = modelKeys.map((k) => getModel(k));

console.log(
  `[provider] ${peerName} will serve: ${servedModels.map((m) => `${m.key}(tier ${m.tier})`).join(", ")}`,
);

const ledger = new Ledger(`data/${peerName}.ledger.json`);
await ledger.load();
console.log(`[ledger] ${peerName} starting balance: ${ledger.balance()}`);

console.log(`Pre-downloading served models so first inference is hot...`);
for (const m of servedModels) {
  process.stdout.write(`  ${m.key}: `);
  let lastPct = -1;
  await preDownload({
    modelSrc: m.src,
    onProgress: (p) => {
      const pct = Math.floor(p.percentage);
      if (pct !== lastPct && pct % 10 === 0) {
        process.stdout.write(`${pct}% `);
        lastPct = pct;
      }
    },
  });
  process.stdout.write("done\n");
}

console.log(`Starting QVAC provider on topic ${topic.slice(0, 12)}...`);
const { publicKey } = await startProvider({ topic });
console.log(`PROVIDER_PUBLIC_KEY=${publicKey}`);

const discovery = new Discovery({
  topicHex: config.discoveryTopic,
  peerName,
  models: servedModels.map((m) => ({ id: m.id, key: m.key, tier: m.tier })),
  qvacTopic: topic,
  qvacProviderPublicKey: publicKey,
});

discovery.on("announce", (peer) => {
  console.log(
    `[discovery] saw peer ${peer.peerId.slice(0, 12)} (${peer.peerName}) models=${peer.models.map((m) => m.key ?? m.id).join(",") || "<none>"}`,
  );
});

discovery.on("creditAck", async (ack) => {
  await ledger.earn({
    from: ack.from,
    tokens: ack.tokens,
    credits: ack.credits,
    model: ack.model,
  });
  console.log(
    `[ledger] earned ${ack.credits} credits from ${ack.from.slice(0, 12)} (${ack.tokens} tokens, ${ack.model}) → balance: ${ledger.balance()}`,
  );
});

discovery.on("peerLeft", (peerId) => {
  console.log(`[discovery] peer left ${peerId.slice(0, 12)}`);
});

await discovery.start();
console.log(
  `Discovery joined as "${peerName}", peerId=${discovery.myPeerId().slice(0, 12)}`,
);
console.log("");
console.log(`Provider ready. Press Ctrl+C to stop.`);

const cleanup = async () => {
  console.log("Stopping provider + discovery...");
  try {
    await discovery.stop();
    await stopProvider({ topic });
    await shutdown();
  } catch (err) {
    console.error("Cleanup error:", err?.message ?? err);
  }
  process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

process.stdin.resume();
