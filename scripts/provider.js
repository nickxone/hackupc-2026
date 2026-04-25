import { startProvider, stopProvider, shutdown } from "../src/core/qvac.js";
import { Discovery } from "../src/core/discovery.js";
import { config } from "../src/config.js";
import { hostname } from "node:os";

const topic = process.env.QVAC_TOPIC || process.argv[2] || config.qvacTopic;
const peerName = process.env.PEER_NAME || hostname();

console.log(`Starting provider on topic ${topic.slice(0, 12)}...`);
const { publicKey } = await startProvider({ topic });

console.log(`PROVIDER_PUBLIC_KEY=${publicKey}`);

const discovery = new Discovery({
  topicHex: config.discoveryTopic,
  peerName,
  models: [
    { id: config.defaultModel.id, tier: config.defaultModel.tier },
  ],
  qvacTopic: topic,
  qvacProviderPublicKey: publicKey,
});

discovery.on("announce", (peer) => {
  console.log(
    `[discovery] saw peer ${peer.peerId.slice(0, 12)} (${peer.peerName}) models=${peer.models.map((m) => m.id).join(",")}`,
  );
});

discovery.on("creditAck", (ack) => {
  console.log(
    `[discovery] credit ack from ${ack.from.slice(0, 12)}: +${ack.credits} credits (${ack.tokens} tokens, ${ack.model})`,
  );
});

discovery.on("peerLeft", (peerId) => {
  console.log(`[discovery] peer left ${peerId.slice(0, 12)}`);
});

await discovery.start();
console.log(`Discovery joined as "${peerName}", peerId=${discovery.myPeerId().slice(0, 12)}`);
console.log("");
console.log("On the other machine, run (manual mode):");
console.log(`  node scripts/consumer.js ${publicKey}`);
console.log("");
console.log("Or run an auto-discovering consumer (once we add it).");
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
