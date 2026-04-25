import process from "bare-process";
import os from "bare-os";
import { resolve } from "bare-path";
import {
  startProvider,
  stopProvider,
  shutdown,
  preDownload,
} from "../core/qvac.js";
import { Discovery } from "../core/discovery.js";
import { LedgerNode } from "../ledger/node.js";
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

  const ledger = new LedgerNode({
    rootDir: resolve(`data/${peerName}/ledger`),
    name: peerName,
  });
  await ledger.ready();
  const ledgerRegistration = await ledger.announceAccount();
  log(
    `[ledger] ${peerName} accountId=${ledger.accountId.slice(0, 12)} balance=${await ledger.balance()}`,
  );

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
    ledgerAccountId: ledger.accountId,
    ledgerRegistration,
  });

  discovery.on("announce", (peer) => {
    log(
      `[discovery] saw peer ${peer.peerId.slice(0, 12)} (${peer.peerName}) models=${peer.models.map((m) => m.key ?? m.id).join(",") || "<none>"} ledger=${peer.ledgerAccountId?.slice(0, 12) ?? "—"}`,
    );
  });

  discovery.on("ledgerRegister", async ({ event }) => {
    try {
      await ledger.ingestSignedEvent(event);
    } catch (err) {
      error(`[ledger] failed to ingest registration: ${err?.message ?? err}`);
    }
  });

  discovery.on("ledgerProposal", async ({ from, event }) => {
    try {
      await ledger.ingestSignedEvent(event);
      if (event.toAccount !== ledger.accountId) return;

      const memoSummary = summarizeMemo(event.memo);
      log(
        `[ledger] proposal ${event.txId.slice(0, 8)} from ${event.fromAccount.slice(0, 12)} amount=${event.amount} ${memoSummary}`,
      );

      const acceptance = await ledger.signAcceptance(event.txId);
      await ledger.ingestSignedEvent(acceptance);
      discovery.broadcastLedgerEvent("transfer-acceptance", acceptance);
      log(
        `[ledger] accepted ${event.txId.slice(0, 8)} -> balance=${await ledger.balance()}`,
      );
    } catch (err) {
      error(`[ledger] proposal handling failed: ${err?.message ?? err}`);
    }
  });

  discovery.on("ledgerAcceptance", async ({ event }) => {
    try {
      await ledger.ingestSignedEvent(event);
    } catch (err) {
      error(`[ledger] failed to ingest acceptance: ${err?.message ?? err}`);
    }
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
    log("Stopping provider + discovery + ledger...");
    try {
      await discovery.stop();
      await stopProvider({ topic });
      await shutdown();
      await ledger.close();
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

function summarizeMemo(memo) {
  if (!memo) return "";
  try {
    const parsed = JSON.parse(memo);
    const prompt = typeof parsed.prompt === "string"
      ? parsed.prompt.slice(0, 60)
      : "<no prompt>";
    return `model=${parsed.model ?? "?"} prompt="${prompt}${parsed.prompt?.length > 60 ? "..." : ""}"`;
  } catch {
    return `memo=${String(memo).slice(0, 80)}`;
  }
}
