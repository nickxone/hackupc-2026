import { loadDelegatedModel, runCompletion, unload } from "../core/qvac.js";
import { config, getModel, listModels } from "../config.js";

export { listModels };

export function createModelsHandler({ discovery }) {
  return async function onGetModels() {
    const peers = discovery.listPeers();
    const seen = new Set();
    const models = [];
    for (const peer of peers) {
      for (const m of (peer.models || [])) {
        if (m.key && !seen.has(m.key)) {
          seen.add(m.key);
          models.push(m);
        }
      }
    }
    return models.length > 0 ? models : listModels();
  };
}

export function createChatHandler({ ledger, discovery }) {
  return async function onChat(res, body, isOai = false) {
    try {
      const modelKey = body.model || config.defaultModelKey;
      const model = getModel(modelKey);

      const peers = discovery.listPeers();
      const provider = peers.find(p => p.models.some(m => m.key === model.key || m.id === model.id));

      if (!provider) {
        throw new Error(`No providers found for model "${model.key}"`);
      }

      console.log(`[chat] Delegating to ${provider.peerName} (${provider.peerId.slice(0, 8)})`);

      const modelId = await loadDelegatedModel({
        modelSrc: model.src,
        topic: provider.qvacTopic,
        providerPublicKey: provider.qvacProviderPublicKey,
        timeoutMs: config.requestTimeoutMs,
      });

      const raw = (body.messages || []).map(m => ({ role: m.role, content: m.content }));
      const history = truncateHistory(raw, model.contextTokens ?? 1024);

      const response = runCompletion({ modelId, history, stream: true });

      res.writeHead(200, {
        "Content-Type": isOai ? "text/event-stream" : "application/x-ndjson",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });

      const id = `chatcmpl-${Math.random().toString(36).slice(2)}`;
      let totalTokens = 0;

      for await (const token of response.tokenStream) {
        totalTokens++;
        if (isOai) {
          res.write(`data: ${JSON.stringify({
            id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: model.key,
            choices: [{ index: 0, delta: { content: token }, finish_reason: null }],
          })}\n\n`);
        } else {
          res.write(`${JSON.stringify({
            model: model.key, created_at: new Date().toISOString(),
            message: { role: "assistant", content: token }, done: false,
          })}\n`);
        }
      }

      if (isOai) {
        res.write(`data: ${JSON.stringify({
          id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: model.key,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        })}\n\n`);
        res.write("data: [DONE]\n\n");
      } else {
        res.write(`${JSON.stringify({
          model: model.key, created_at: new Date().toISOString(),
          message: { role: "assistant", content: "" }, done: true,
          provider: providerInfo(provider),
        })}\n`);
      }
      res.end();

      const stats = await response.stats;
      const tokens = stats?.usage?.total_tokens || totalTokens;
      const credits = Math.ceil(tokens / 10) * model.tier;

      await ledger.spend({ to: provider.qvacProviderPublicKey, tokens, credits, model: model.key });
      await discovery.sendCreditAck({ to: provider.qvacProviderPublicKey, tokens, credits, model: model.key });

      console.log(`[ledger] Spent ${credits} credits. New balance: ${ledger.balance()}`);

      await unload({ modelId });
    } catch (err) {
      console.error("[chat] Error:", err.message);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      } else {
        res.end();
      }
    }
  };
}

function truncateHistory(messages, tokenBudget) {
  const filtered = messages.filter(m => m.role !== "system");
  let total = filtered.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
  while (filtered.length > 1 && total > tokenBudget) {
    const removed = filtered.shift();
    total -= Math.ceil(removed.content.length / 4);
  }
  return filtered;
}

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
