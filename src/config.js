import {
  LLAMA_3_2_1B_INST_Q4_0,
  QWEN3_1_7B_INST_Q4,
} from "@qvac/sdk";
import { ledgerConfig } from "./ledger-config.js";
import { discoveryTopic, qvacTopic } from "./topics.js";

const models = {
  "llama-1b": {
    key: "llama-1b",
    id: "LLAMA_3_2_1B_INST_Q4_0",
    src: LLAMA_3_2_1B_INST_Q4_0,
    label: "Llama 3.2 1B (Q4)",
    tier: 1,
    priceCredits: ledgerConfig.getPriceForTier(1),
    contextTokens: 900,
  },
  "qwen-1.7b": {
    key: "qwen-1.7b",
    id: "QWEN3_1_7B_INST_Q4",
    src: QWEN3_1_7B_INST_Q4,
    label: "Qwen 3 1.7B (Q4)",
    tier: 3,
    priceCredits: ledgerConfig.getPriceForTier(3),
    contextTokens: 1800,
  },
};

const defaultModelKey = "llama-1b";

export const config = {
  qvacTopic,
  discoveryTopic,

  models,
  defaultModelKey,
  defaultModel: models[defaultModelKey],

  ledger: ledgerConfig,

  requestTimeoutMs: 60_000,
};

export function getModel(idOrKey) {
  for (const m of Object.values(models)) {
    if (m.key === idOrKey || m.id === idOrKey) return m;
  }
  throw new Error(
    `Unknown model "${idOrKey}". Available keys: ${Object.keys(models).join(", ")}`,
  );
}

export function listModels() {
  return Object.values(models);
}
