import {
  loadDelegatedModel,
  runCompletion,
  unload,
  shutdown,
} from "../src/core/qvac.js";
import { Discovery } from "../src/core/discovery.js";
import { Ledger } from "../src/core/ledger.js";
import { config, getModel } from "../src/config.js";
import os from "bare-os";
const { hostname } = os;

const peerName = process.env.PEER_NAME || hostname();
const prompt = process.argv[2] || "Say hello in exactly 5 words.";
const requestedModel = getModel(
  process.env.MODEL || config.defaultModelKey,
);
const FIND_TIMEOUT_MS = 30_000;

const ledger = new Ledger(`data/${peerName}.ledger.json`);
await ledger.load();
console.log(`[ledger] ${peerName} starting balance: ${ledger.balance()}`);

const discovery = new Discovery({
  topicHex: config.discoveryTopic,
  peerName,
  models: [],
  qvacTopic: null,
  qvacProviderPublicKey: null,
});
await discovery.start();
console.log(`[discovery] my peerId: ${discovery.myPeerId().slice(0, 12)}`);

console.log(
  `Looking for a provider that serves ${requestedModel.key} (${requestedModel.label}, tier ${requestedModel.tier})...`,
);
const provider = await waitForProvider({
  discovery,
  model: requestedModel,
  timeoutMs: FIND_TIMEOUT_MS,
});
console.log(
  `Found provider ${provider.peerName} (peerId=${provider.peerId.slice(0, 12)}, qvacPubkey=${provider.qvacProviderPublicKey.slice(0, 12)})`,
);

const modelId = await loadDelegatedModel({
  modelSrc: requestedModel.src,
  topic: provider.qvacTopic,
  providerPublicKey: provider.qvacProviderPublicKey,
  timeoutMs: config.requestTimeoutMs,
});
console.log(`Delegated model loaded: ${modelId}`);

const response = runCompletion({
  modelId,
  history: [{ role: "user", content: prompt }],
});

let tokenCount = 0;
process.stdout.write("Response: ");
for await (const token of response.tokenStream) {
  tokenCount++;
  process.stdout.write(token);
}
process.stdout.write("\n");

const stats = await response.stats;
console.log("Stats:", stats);

const tokens =
  stats.totalTokens ??
  stats.completionTokens ??
  stats.tokens ??
  tokenCount;
const credits = ledger.priceOf({ tokens, tier: requestedModel.tier });

const event = await ledger.spend({
  to: provider.peerName,
  tokens,
  credits,
  model: requestedModel.id,
});
console.log(
  `[ledger] spent ${credits} credits (${tokens} tokens, tier ${requestedModel.tier}) → balance: ${ledger.balance()}`,
);

try {
  await discovery.sendCreditAck({
    to: provider.peerId,
    tokens,
    credits,
    model: requestedModel.id,
    txId: event.value.txId,
    fromName: peerName,
  });
  console.log(`[discovery] sent creditAck → ${provider.peerId.slice(0, 12)}`);
} catch (err) {
  console.warn(`[discovery] could not send creditAck:`, err.message);
}

await unload({ modelId });
await discovery.stop();
await shutdown();
process.exit(0);

function waitForProvider({ discovery, model, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let done = false;
    let timer = null;
    const finish = (ok, value) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (ok) resolve(value);
      else reject(value);
    };

    const matchPeer = (p) =>
      p.qvacProviderPublicKey &&
      p.models.some((m) => m.key === model.key || m.id === model.id);

    const existing = discovery.listPeers().find(matchPeer);
    if (existing) return finish(true, existing);

    timer = setTimeout(() => {
      finish(
        false,
        new Error(
          `no provider for ${model.key} (${model.id}) found within ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    discovery.on("announce", (peer) => {
      if (matchPeer(peer)) finish(true, peer);
    });
  });
}
