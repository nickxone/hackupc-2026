import crypto from "bare-crypto";

const { createHash } = crypto;

export const topicFromName = (name) =>
  createHash("sha256").update(name).digest("hex");

export const qvacTopic = topicFromName("compute-exchange-qvac-v1");
export const discoveryTopic = topicFromName("compute-exchange-discovery-v1");
