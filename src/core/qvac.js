import {
  startQVACProvider,
  stopQVACProvider,
  loadModel,
  unloadModel,
  completion,
  close,
  downloadAsset,
} from "@qvac/sdk";

export async function startProvider({ topic, firewall } = {}) {
  const response = await startQVACProvider({ topic, firewall });
  return { publicKey: response.publicKey, topic };
}

export async function stopProvider({ topic }) {
  await stopQVACProvider({ topic });
}

export async function loadLocalModel({ modelSrc, onProgress }) {
  return loadModel({ modelSrc, modelType: "llm", onProgress });
}

export async function loadDelegatedModel({
  modelSrc,
  modelConfig,
  topic,
  providerPublicKey,
  timeoutMs = 30_000,
  fallbackToLocal = false,
  onProgress,
}) {
  return loadModel({
    modelSrc,
    modelType: "llm",
    ...(modelConfig ? { modelConfig } : {}),
    delegate: {
      topic,
      providerPublicKey,
      timeout: timeoutMs,
      fallbackToLocal,
    },
    onProgress,
  });
}

export function runCompletion({ modelId, history, stream = true, generationParams }) {
  return completion({
    modelId,
    history,
    stream,
    ...(generationParams ? { generationParams } : {}),
  });
}

export async function unload({ modelId }) {
  await unloadModel({ modelId });
}

export async function shutdown() {
  await close();
}

export async function preDownload({ modelSrc, onProgress }) {
  await downloadAsset({ assetSrc: modelSrc, onProgress });
}
