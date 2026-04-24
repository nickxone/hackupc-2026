import {
  loadLocalModel,
  runCompletion,
  unload,
  shutdown,
} from "../src/core/qvac.js";
import { config } from "../src/config.js";

console.log(`Loading ${config.defaultModel.id} locally...`);

const modelId = await loadLocalModel({
  modelSrc: config.defaultModel.src,
  onProgress: (p) => {
    process.stdout.write(`\r  download: ${p.percentage.toFixed(1)}%   `);
  },
});
process.stdout.write("\n");
console.log(`Loaded: ${modelId}`);

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
await shutdown();
