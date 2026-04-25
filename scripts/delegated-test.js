import process from "bare-process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "../src/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const providerScript = join(__dirname, "provider.js");
const consumerScript = join(__dirname, "consumer.js");

const topic = config.qvacTopic;
const PROVIDER_READY_TIMEOUT_MS = 30_000;

function spawnProvider() {
  const child = spawn("node", [providerScript, topic], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.on("data", (c) => process.stderr.write(c));
  return child;
}

function waitForPublicKey(child) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => {
      reject(new Error("provider did not emit public key in time"));
    }, PROVIDER_READY_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      const s = chunk.toString();
      buf += s;
      process.stdout.write(s);
      const m = buf.match(/PROVIDER_PUBLIC_KEY=([a-f0-9]+)/i);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });

    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      reject(new Error(`provider exited early (code ${code})`));
    });
  });
}

function runConsumer(topic, pubkey) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [consumerScript, pubkey], {
      stdio: "inherit",
      env: { ...process.env, QVAC_TOPIC: topic },
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`consumer exited with code ${code}`));
    });
  });
}

const provider = spawnProvider();

try {
  console.log("Waiting for provider to announce pubkey...\n");
  const pubkey = await waitForPublicKey(provider);
  console.log(`\nProvider pubkey captured: ${pubkey.slice(0, 12)}...`);
  console.log("Waiting 3s for DHT propagation...");
  await new Promise((r) => setTimeout(r, 3000));
  console.log("Running consumer in a separate process...\n");
  await runConsumer(topic, pubkey);
  console.log("\nDelegated inference test: PASS");
} catch (err) {
  console.error("\nDelegated inference test: FAIL —", err.message);
  process.exitCode = 1;
} finally {
  if (!provider.killed) provider.kill("SIGTERM");
}
