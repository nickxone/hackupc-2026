import { startProvider, stopProvider, shutdown } from "../src/core/qvac.js";
import { Discovery } from "../src/core/discovery.js";
import { Ledger } from "../src/core/ledger.js";
import { config } from "../src/config.js";
import { hostname } from "node:os";

const topic = process.env.QVAC_TOPIC || process.argv[2] || config.qvacTopic;
const peerName = process.env.PEER_NAME || hostname();

const ledger = new Ledger(`data/${peerName}.ledger.json`);
await ledger.load();
console.log(`[ledger] ${peerName} starting balance: ${ledger.balance()}`);

console.log(`Starting provider on topic ${topic.slice(0, 12)}...`);
const { publicKey } = await startProvider({ topic });

console.log(`PROVIDER_PUBLIC_KEY=${publicKey}`);

const discovery = new Discovery({
  topicHex: config.discoveryTopic,
  peerName,
  models: [{ id: config.defaultModel.id, tier: config.defaultModel.tier }],
  qvacTopic: topic,
  qvacProviderPublicKey: publicKey,
});

discovery.on("announce", (peer) => {
  console.log(
    `[discovery] saw peer ${peer.peerId.slice(0, 12)} (${peer.peerName}) models=${peer.models.map((m) => m.id).join(",") || "<none>"}`,
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
console.log("Manual consumer command:");
console.log(`  node scripts/consumer.js ${publicKey}`);
console.log("Auto-discovering consumer (run on another machine):");
console.log("  node scripts/auto-consumer.js");
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
