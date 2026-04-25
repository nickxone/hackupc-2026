import { readFileSync, writeFileSync, existsSync, mkdirSync } from "bare-fs";
import { resolve, dirname } from "bare-path";

export const MARKET_CONFIG_FILE = resolve("config/market.json");

export function loadMarketConfig() {
  if (!existsSync(MARKET_CONFIG_FILE)) {
    throw new Error(`Missing market config file: ${MARKET_CONFIG_FILE}`);
  }
  return JSON.parse(readFileSync(MARKET_CONFIG_FILE, "utf8"));
}

export function getLedgerBootstrapKey() {
  const { ledgerBootstrapKey } = loadMarketConfig();
  if (!/^[a-f0-9]{64}$/i.test(ledgerBootstrapKey || "")) {
    throw new Error(`Invalid ledgerBootstrapKey in ${MARKET_CONFIG_FILE}`);
  }
  return ledgerBootstrapKey;
}

export function getInitialCreditAmount() {
  const { initialCredits } = loadMarketConfig();
  if (!Number.isInteger(initialCredits) || initialCredits <= 0) {
    throw new Error(`Invalid initialCredits in ${MARKET_CONFIG_FILE}`);
  }
  return initialCredits;
}

export function getCreditPricing() {
  const config = loadMarketConfig();
  return {
    pricePerRequest: config.pricePerRequest ?? 1,
    pricePerToken: config.pricePerToken ?? 0,
  };
}

export function saveLedgerBootstrapKey(key) {
  if (!/^[a-f0-9]{64}$/i.test(key || "")) {
    throw new Error(`Invalid ledger bootstrap key: ${key}`);
  }
  const current = existsSync(MARKET_CONFIG_FILE) ? loadMarketConfig() : {};
  const next = { ...current, ledgerBootstrapKey: key };
  mkdirSync(dirname(MARKET_CONFIG_FILE), { recursive: true });
  writeFileSync(MARKET_CONFIG_FILE, JSON.stringify(next, null, 2) + "\n");
}
