import process from "bare-process";
import "../qvac/worker.entry.mjs";
import { startProviderRuntime } from "../src/server/provider-runtime.js";

const provider = await startProviderRuntime();

console.log("");
console.log("Provider ready. Press Ctrl+C to stop.");

const cleanup = async () => {
  try {
    await provider.stop();
  } catch {
    process.exit(1);
    return;
  }
  process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

process.stdin.resume();
