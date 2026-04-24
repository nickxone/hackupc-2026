import { createHash } from "node:crypto";
import { LLAMA_3_2_1B_INST_Q4_0 } from "@qvac/sdk";

const topicFromName = (name) =>
  createHash("sha256").update(name).digest("hex");

export const config = {
  qvacTopic: topicFromName("compute-exchange-qvac-v1"),
  discoveryTopic: topicFromName("compute-exchange-discovery-v1"),

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
