import {
  startProvider,
  stopProvider,
  loadDelegatedModel,
  runCompletion,
  unload,
  shutdown,
} from "../src/core/qvac.js";
import { config } from "../src/config.js";

const topic = config.qvacTopic;

console.log(`Starting provider on topic ${topic.slice(0, 12)}...`);
const { publicKey } = await startProvider({ topic });
console.log(`Provider public key: ${publicKey}`);

console.log(`Loading delegated model (same process, via Hyperswarm)...`);
const modelId = await loadDelegatedModel({
  modelSrc: config.defaultModel.src,
  topic,
  providerPublicKey: publicKey,
  timeoutMs: config.requestTimeoutMs,
  onProgress: (p) => {
    process.stdout.write(`\r  download: ${p.percentage.toFixed(1)}%   `);
  },
});
process.stdout.write("\n");
console.log(`Delegated model loaded: ${modelId}`);

const response = runCompletion({
  modelId,
  history: [
    { role: "user", content: "Say hello in exactly 5 words." },
  ],
});

process.stdout.write("Response: ");
for await (const token of response.tokenStream) {
  process.stdout.write(token);
}
process.stdout.write("\n");

const stats = await response.stats;
console.log("Stats:", stats);

await unload({ modelId });
await stopProvider({ topic });
await shutdown();
