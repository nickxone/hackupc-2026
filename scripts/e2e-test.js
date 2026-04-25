import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile, rm } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const providerScript = join(__dirname, "provider.js");
const consumerScript = join(__dirname, "auto-consumer.js");
const dataDir = join(__dirname, "..", "data");

const PROVIDER_NAME = "alice";
const CONSUMER_NAME = "bob";
const PROVIDER_READY_TIMEOUT_MS = 30_000;
const CONSUMER_TIMEOUT_MS = 120_000;

console.log("Resetting data/ ...");
await rm(dataDir, { recursive: true, force: true });

function spawnNamed(name, script) {
  const child = spawn("node", [script], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PEER_NAME: name },
  });
  child.stderr.on("data", (c) =>
    process.stderr.write(`[${name} stderr] ${c}`),
  );
  child.stdout.on("data", (c) => process.stdout.write(`[${name}] ${c}`));
  return child;
}

function waitForLine(child, regex, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(
      () => reject(new Error(`${label}: pattern not seen within ${timeoutMs}ms`)),
      timeoutMs,
    );
    const onData = (chunk) => {
      buf += chunk.toString();
      const m = buf.match(regex);
      if (m) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        resolve(m);
      }
    };
    child.stdout.on("data", onData);
    child.on("close", (code) => {
      clearTimeout(timer);
      reject(new Error(`${label}: process exited (code ${code}) before pattern`));
    });
  });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(new Error(`consumer did not exit within ${CONSUMER_TIMEOUT_MS}ms`)),
      CONSUMER_TIMEOUT_MS,
    );
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`consumer exited with code ${code}`));
    });
  });
}

const provider = spawnNamed(PROVIDER_NAME, providerScript);

try {
  console.log("\nWaiting for provider to come online + announce on discovery...\n");
  await waitForLine(
    provider,
    /Discovery joined as "alice"/,
    PROVIDER_READY_TIMEOUT_MS,
    "provider",
  );

  console.log("\nProvider ready. Waiting 3s for DHT propagation...\n");
  await new Promise((r) => setTimeout(r, 3000));

  console.log("\nSpawning auto-consumer...\n");
  const consumer = spawnNamed(CONSUMER_NAME, consumerScript);
  await waitForExit(consumer);

  console.log("\nConsumer finished. Giving provider 2s to receive creditAck...\n");
  await new Promise((r) => setTimeout(r, 2000));

  const aliceLedger = JSON.parse(
    await readFile(join(dataDir, `${PROVIDER_NAME}.ledger.json`), "utf8"),
  );
  const bobLedger = JSON.parse(
    await readFile(join(dataDir, `${CONSUMER_NAME}.ledger.json`), "utf8"),
  );

  const aliceEarned = aliceLedger.balance - 100;
  const bobSpent = 100 - bobLedger.balance;

  console.log("\n--- ledger summary ---");
  console.log(`alice balance: ${aliceLedger.balance}  (earned ${aliceEarned})`);
  console.log(`bob   balance: ${bobLedger.balance}  (spent  ${bobSpent})`);

  if (aliceEarned > 0 && bobSpent > 0 && aliceEarned === bobSpent) {
    console.log("\nE2E credits test: PASS");
  } else {
    console.error("\nE2E credits test: FAIL — balances did not move symmetrically");
    process.exitCode = 1;
  }
} catch (err) {
  console.error("\nE2E credits test: FAIL —", err.message);
  process.exitCode = 1;
} finally {
  if (!provider.killed) provider.kill("SIGTERM");
}
