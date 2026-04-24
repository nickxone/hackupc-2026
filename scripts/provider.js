import { startProvider, stopProvider, shutdown } from "../src/core/qvac.js";
import { config } from "../src/config.js";

const topic = process.env.QVAC_TOPIC || process.argv[2] || config.qvacTopic;

console.log(`Starting provider on topic ${topic.slice(0, 12)}...`);
const { publicKey } = await startProvider({ topic });

console.log(`PROVIDER_PUBLIC_KEY=${publicKey}`);
console.log("");
console.log("On the other machine, run:");
console.log(`  node scripts/consumer.js ${publicKey}`);
console.log("");
console.log(`Provider ready. Press Ctrl+C to stop.`);

const cleanup = async () => {
  console.log("Stopping provider...");
  try {
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
