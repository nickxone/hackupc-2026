import process from "bare-process";
import os from "bare-os";
import {
  startProvider,
  stopProvider,
  shutdown,
  preDownload,
} from "../core/qvac.js";
import { Discovery } from "../core/discovery.js";
import { Ledger } from "../core/ledger.js";
import { config, getModel, listModels } from "../config.js";

const { hostname } = os;

export async function startProviderRuntime({
  topic = process.env.QVAC_TOPIC || config.qvacTopic,
  peerName = process.env.PEER_NAME || hostname(),
  modelKeys = parseModelKeys(process.env.MODELS),
  predownload = true,
  log = console.log,
  error = console.error,
} = {}) {
  const servedModels = modelKeys.map((key) => getModel(key));
  if (servedModels.length === 0) {
    throw new Error("Provider needs at least one model. Pass --models <key> or set MODELS.");
  }

  log(
    `[provider] ${peerName} will serve: ${servedModels.map((m) => `${m.key}(tier ${m.tier})`).join(", ")}`,
  );

  const ledger = new Ledger(`data/${peerName}.ledger.json`);
  await ledger.load();
  log(`[ledger] ${peerName} starting balance: ${ledger.balance()}`);

  if (predownload) {
    log("Pre-downloading served models so first inference is hot...");
    for (const model of servedModels) {
      await preDownloadModel({ model, log });
    }
  }

  log(`Starting QVAC provider on topic ${topic.slice(0, 12)}...`);
  const { publicKey } = await startProvider({ topic });
  log(`PROVIDER_PUBLIC_KEY=${publicKey}`);

  const discovery = new Discovery({
    topicHex: config.discoveryTopic,
    peerName,
    models: servedModels.map((m) => ({ id: m.id, key: m.key, tier: m.tier })),
    qvacTopic: topic,
    qvacProviderPublicKey: publicKey,
  });

  discovery.on("announce", (peer) => {
    log(
      `[discovery] saw peer ${peer.peerId.slice(0, 12)} (${peer.peerName}) models=${peer.models.map((m) => m.key ?? m.id).join(",") || "<none>"}`,
    );
  });

  discovery.on("creditAck", async (ack) => {
    await ledger.earn({
      from: ack.from,
      tokens: ack.tokens,
      credits: ack.credits,
      model: ack.model,
    });
    log(
      `[ledger] earned ${ack.credits} credits from ${ack.from.slice(0, 12)} (${ack.tokens} tokens, ${ack.model}) -> balance: ${ledger.balance()}`,
    );
  });

  discovery.on("peerLeft", (peerId) => {
    log(`[discovery] peer left ${peerId.slice(0, 12)}`);
  });

  await discovery.start();
  log(
    `Discovery joined as "${peerName}", peerId=${discovery.myPeerId().slice(0, 12)}`,
  );

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    log("Stopping provider + discovery...");
    try {
      await discovery.stop();
      await stopProvider({ topic });
      await shutdown();
    } catch (err) {
      error("Cleanup error:", err?.message ?? err);
      throw err;
    }
  };

  return {
    topic,
    peerName,
    servedModels,
    publicKey,
    peerId: discovery.myPeerId(),
    discovery,
    ledger,
    stop,
  };
}

export function parseModelKeys(value) {
  const raw = value || listModels().map((m) => m.key).join(",");
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function preDownloadModel({ model, log }) {
  process.stdout.write(`  ${model.key}: `);
  let lastPct = -1;
  await preDownload({
    modelSrc: model.src,
    onProgress: (progress) => {
      const pct = Math.floor(progress.percentage);
      if (pct !== lastPct && pct % 10 === 0) {
        process.stdout.write(`${pct}% `);
        lastPct = pct;
      }
    },
  });
  process.stdout.write("done\n");
}
