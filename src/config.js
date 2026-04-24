import { LLAMA_3_2_1B_INST_Q4_0 } from "@qvac/sdk";

export const config = {
  qvacTopic:
    "636f6d707574652d65786368616e67652d7631636f6d707574652d65786368",
  discoveryTopic:
    "636f6d707574652d65786368616e67652d646973636f766572792d76310000",

  defaultModel: {
    src: LLAMA_3_2_1B_INST_Q4_0,
    id: "LLAMA_3_2_1B_INST_Q4_0",
    tier: 1,
  },

  ledger: {
    initialBalance: 100,
    pricePerTokenPerTier: 0.1,
  },

  requestTimeoutMs: 30_000,
};
