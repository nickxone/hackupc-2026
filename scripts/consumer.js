import process from "bare-process";
import {
  loadDelegatedModel,
  runCompletion,
  unload,
  shutdown,
} from "../src/core/qvac.js";
import { config } from "../src/config.js";

const providerPublicKey = process.argv[2];
const prompt = process.argv[3] || "Say hello in exactly 5 words.";
const topic = process.env.QVAC_TOPIC || config.qvacTopic;

if (!providerPublicKey) {
  console.error(
    "Usage: node scripts/consumer.js <provider-public-key> [prompt]",
  );
  console.error(
    "       (topic defaults to config.qvacTopic; override with QVAC_TOPIC=<hex>)",
  );
  process.exit(1);
}

console.log(
  `Consumer → topic ${topic.slice(0, 12)}..., provider ${providerPublicKey.slice(0, 12)}...`,
);

const modelId = await loadDelegatedModel({
  modelSrc: config.defaultModel.src,
  topic,
  providerPublicKey,
  timeoutMs: config.requestTimeoutMs,
  onProgress: (p) => {
    process.stdout.write(`\r  download: ${p.percentage.toFixed(1)}%   `);
  },
});
process.stdout.write("\n");
console.log(`Delegated model loaded: ${modelId}`);

const response = runCompletion({
  modelId,
  history: [{ role: "user", content: prompt }],
});

process.stdout.write("Response: ");
for await (const token of response.tokenStream) {
  process.stdout.write(token);
}
process.stdout.write("\n");

const stats = await response.stats;
console.log("Stats:", stats);

await unload({ modelId });
await shutdown();
process.exit(0);
