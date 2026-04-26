import process from "bare-process";
import { mkdirSync, existsSync, renameSync } from "bare-fs";
import { resolve } from "bare-path";
import Autobase from "autobase";
import Corestore from "corestore";

import { writeFileSync, existsSync as _exists, readFileSync } from "bare-fs";
import {
  MARKET_CONFIG_FILE,
  saveLedgerBootstrapKey,
} from "../src/ledger/config.js";
import { openLedgerView, createApply } from "../src/ledger/protocol.js";

const DEFAULT_INITIAL_CREDITS = 100;
const DEFAULT_PRICE_PER_REQUEST = 1;

async function main() {
  const rootArg = getRootArg();
  const rootDir = resolve(rootArg || "data/_bootstrap");
  mkdirSync(rootDir, { recursive: true });

  const key = await initBootstrap(rootDir);
  ensureMarketDefaults();
  saveLedgerBootstrapKey(key);

  console.log(`Initialized ledger bootstrap at ${rootDir}`);
  console.log(`Bootstrap key: ${key}`);
  console.log(`Wrote ${MARKET_CONFIG_FILE}`);
}

function ensureMarketDefaults() {
  let current = {};
  if (_exists(MARKET_CONFIG_FILE)) {
    try {
      current = JSON.parse(readFileSync(MARKET_CONFIG_FILE, "utf8"));
    } catch {
    }
  }
  if (!Number.isInteger(current.initialCredits) || current.initialCredits <= 0) {
    current.initialCredits = DEFAULT_INITIAL_CREDITS;
  }
  if (!Number.isFinite(current.pricePerRequest) || current.pricePerRequest < 0) {
    current.pricePerRequest = DEFAULT_PRICE_PER_REQUEST;
  }
  writeFileSync(MARKET_CONFIG_FILE, JSON.stringify(current, null, 2) + "\n");
}

async function initBootstrap(rootDir) {
  try {
    return await readOrCreate(rootDir);
  } catch (err) {
    if (!isMovedUnsafelyError(err)) throw err;
    const backup = `${rootDir}.corrupt-${Date.now()}`;
    renameSync(rootDir, backup);
    mkdirSync(rootDir, { recursive: true });
    console.log(`Backed up broken bootstrap store to ${backup}`);
    return await readOrCreate(rootDir);
  }
}

async function readOrCreate(rootDir) {
  const store = new Corestore(rootDir);
  const base = new Autobase(store, null, {
    open: openLedgerView,
    apply: createApply(),
    valueEncoding: "json",
    optimistic: true,
  });
  try {
    await base.ready();
    return base.key.toString("hex");
  } finally {
    await base.close().catch(() => {});
    await store.close().catch(() => {});
  }
}

function isMovedUnsafelyError(err) {
  return String(err?.message || err).includes("Invalid device file, was moved unsafely");
}

function getRootArg() {
  const args = process.argv.slice(2);
  for (const arg of args) {
    if (!arg) continue;
    if (arg.endsWith(".js")) continue;
    return arg;
  }
  return null;
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
