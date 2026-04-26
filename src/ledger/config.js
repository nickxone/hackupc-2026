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

export function getRatingsBootstrapKey() {
  const { ratingsBootstrapKey } = loadMarketConfig();
  if (!/^[a-f0-9]{64}$/i.test(ratingsBootstrapKey || "")) {
    throw new Error(`Invalid ratingsBootstrapKey in ${MARKET_CONFIG_FILE}`);
  }
  return ratingsBootstrapKey;
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
  const tierPrices = normalizeTierPrices(config.tierPrices, config.pricePerRequest);
  return {
    pricePerRequest: config.pricePerRequest ?? 1,
    pricePerToken: config.pricePerToken ?? 0,
    tierPrices,
  };
}

export function getPriceForTier(tier) {
  const normalizedTier = Number(tier);
  if (!Number.isInteger(normalizedTier) || normalizedTier <= 0) {
    throw new Error(`Invalid model tier: ${tier}`);
  }

  const { tierPrices, pricePerRequest } = getCreditPricing();
  const direct = tierPrices[String(normalizedTier)];
  if (Number.isFinite(direct) && direct > 0) return direct;
  return Math.max(1, Math.ceil((pricePerRequest ?? 1) * normalizedTier));
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

export function saveRatingsBootstrapKey(key) {
  if (!/^[a-f0-9]{64}$/i.test(key || "")) {
    throw new Error(`Invalid ratings bootstrap key: ${key}`);
  }
  const current = existsSync(MARKET_CONFIG_FILE) ? loadMarketConfig() : {};
  const next = { ...current, ratingsBootstrapKey: key };
  mkdirSync(dirname(MARKET_CONFIG_FILE), { recursive: true });
  writeFileSync(MARKET_CONFIG_FILE, JSON.stringify(next, null, 2) + "\n");
}

function normalizeTierPrices(raw, fallbackPricePerRequest = 1) {
  const normalized = {};
  const source = raw && typeof raw === "object" ? raw : {};

  for (const [tier, value] of Object.entries(source)) {
    const numericTier = Number(tier);
    if (!Number.isInteger(numericTier) || numericTier <= 0) continue;
    if (!Number.isFinite(value) || value <= 0) continue;
    normalized[String(numericTier)] = value;
  }

  if (Object.keys(normalized).length === 0) {
    normalized["1"] = Math.max(1, Math.ceil(fallbackPricePerRequest || 1));
    normalized["2"] = Math.max(1, Math.ceil((fallbackPricePerRequest || 1) * 2));
    normalized["3"] = Math.max(1, Math.ceil((fallbackPricePerRequest || 1) * 3));
  }

  return normalized;
}
