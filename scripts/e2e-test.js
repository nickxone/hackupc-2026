import process from "bare-process";
import { spawn } from "bare-subprocess";
import { dirname, join } from "bare-path";
import { readFile, rm } from "bare-fs/promises";
import { LocalLedgerApp } from "../src/ledger/app.js";

const providerScript = "scripts/provider.js";
const consumerScript = "scripts/auto-consumer.js";
const dataDir = "data";
const ledgerDir = ".p2p-ledger-demo";

const PROVIDER_NAME = "alice";
const CONSUMER_NAME = "bob";
const PROVIDER_READY_TIMEOUT_MS = 30_000;
const CONSUMER_TIMEOUT_MS = 120_000;

console.log("Resetting data/ and .p2p-ledger-demo/ ...");
await rm(dataDir, { recursive: true, force: true }).catch(() => {});
await rm(ledgerDir, { recursive: true, force: true }).catch(() => {});

function spawnNamed(name, script) {
  const child = spawn("pear", ["run", script], {
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

  const app = new LocalLedgerApp();
  const balances = await app.balances();
  const aliceBalance = balances.find(b => b.name === PROVIDER_NAME)?.amount || 0;
  const bobBalance = balances.find(b => b.name === CONSUMER_NAME)?.amount || 0;

  const aliceEarned = aliceBalance - 100;
  const bobSpent = 100 - bobBalance;

  console.log("\n--- ledger summary ---");
  console.log(`alice balance: ${aliceBalance}  (earned ${aliceEarned})`);
  console.log(`bob   balance: ${bobBalance}  (spent  ${bobSpent})`);

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
