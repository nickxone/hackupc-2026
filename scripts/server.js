import process from "bare-process";
import "../qvac/worker.entry.mjs";
import { startComputeExchangeApi } from "../src/server/compute-exchange-api.js";
import { Discovery } from "../src/core/discovery.js";
import { Ledger } from "../src/core/ledger.js";
import { loadDelegatedModel, runCompletion, unload } from "../src/core/qvac.js";
import { config, getModel } from "../src/config.js";
import os from "bare-os";
const { hostname } = os;

const peerName = process.env.PEER_NAME || hostname();
const topic = process.env.QVAC_TOPIC || config.qvacTopic;

console.log(`[server] Starting P2P daemon for ${peerName}...`);

const ledger = new Ledger(`data/${peerName}.ledger.json`);
await ledger.load();
console.log(`[ledger] Starting balance: ${ledger.balance()}`);

const discovery = new Discovery({
  topicHex: config.discoveryTopic,
  peerName,
  models: [], // Server/consumer doesn't serve models
  qvacTopic: topic,
});

discovery.on("creditAck", async (ack) => {
  await ledger.earn(ack);
});

await discovery.start();
console.log(`[discovery] Joined as "${peerName}", peerId=${discovery.myPeerId().slice(0, 12)}`);

const api = await startComputeExchangeApi({
  host: "127.0.0.1",
  port: 11434, // Ollama default port
  onGetPeers: async () => discovery.listPeers(),
  onGetBalance: async () => ({ balance: ledger.balance(), log: ledger.state.log }),
  onChat: async (res, body, isOai = false) => {
    try {
      const modelKey = body.model || config.defaultModelKey;
      const model = getModel(modelKey);
      
      const peers = discovery.listPeers();
      const provider = peers.find(p => p.models.some(m => m.key === model.key || m.id === model.id));
      
      if (!provider) {
        throw new Error(`No providers found for model "${model.key}"`);
      }
      
      console.log(`[server] Delegating inference to ${provider.peerName} (${provider.peerId.slice(0, 8)})`);

      const modelId = await loadDelegatedModel({
        modelSrc: model.src,
        topic: provider.qvacTopic,
        providerPublicKey: provider.qvacProviderPublicKey,
        timeoutMs: config.requestTimeoutMs
      });

      // Handle both OpenAI's "messages" format and Ollama's format
      const history = (body.messages || []).map(m => ({ role: m.role, content: m.content }));
      
      const response = runCompletion({ modelId, history, stream: true });

      res.writeHead(200, {
        "Content-Type": isOai ? "text/event-stream" : "application/x-ndjson",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      });

      const id = `chatcmpl-${Math.random().toString(36).slice(2)}`;
      let totalTokens = 0;

      for await (const token of response.tokenStream) {
        totalTokens++;
        if (isOai) {
          const chunk = {
            id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: model.key,
            choices: [{ index: 0, delta: { content: token }, finish_reason: null }]
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        } else {
          const chunk = {
            model: model.key, created_at: new Date().toISOString(), message: { role: "assistant", content: token }, done: false
          };
          res.write(`${JSON.stringify(chunk)}\n`);
        }
      }

      // Finish streaming
      if (isOai) {
        res.write(`data: ${JSON.stringify({
          id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: model.key,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
        })}\n\n`);
        res.write("data: [DONE]\n\n");
      } else {
        const chunk = {
          model: model.key,
          created_at: new Date().toISOString(),
          message: { role: "assistant", content: "" },
          done: true,
          provider: providerInfo(provider),
        };
        res.write(`${JSON.stringify(chunk)}\n`);
      }
      res.end();

      // Handle credits
      const stats = await response.stats;
      const tokens = stats?.usage?.total_tokens || totalTokens;
      const credits = Math.ceil(tokens / 10) * model.tier;

      await ledger.spend({
        to: provider.qvacProviderPublicKey, tokens, credits, model: model.key
      });

      await discovery.sendCreditAck({
        to: provider.qvacProviderPublicKey, tokens, credits, model: model.key
      });

      console.log(`[ledger] Spent ${credits} credits. New balance: ${ledger.balance()}`);
      
      await unload({ modelId });
    } catch (err) {
      console.error("[server] Chat Error:", err.message);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      } else {
        res.end();
      }
    }
  }
});

console.log(`\n✅ HTTP API Server listening on ${api.url}`);
console.log(`   - Ollama API: ${api.url}/api/chat`);
console.log(`   - OpenAI API: ${api.url}/v1/chat/completions`);
console.log(`\nWaiting for providers to join the network...`);

process.on("SIGINT", async () => {
  console.log("Shutting down...");
  await api.stop?.();
  await discovery.stop();
  process.exit(0);
});

function providerInfo(provider) {
  return {
    peerName: provider.peerName ?? null,
    peerId: provider.peerId ?? null,
    qvacProviderPublicKey: provider.qvacProviderPublicKey ?? null,
    qvacTopic: provider.qvacTopic ?? null,
    models: provider.models ?? [],
    rating: provider.rating ?? null,
    lastSeenAt: provider.lastSeenAt ?? null,
  };
}
