import { loadDelegatedModel, runCompletion } from "../core/qvac.js";
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

export function createChatHandler({ ledger, discovery, pricePerRequest, acceptanceTimeoutMs = 15_000 }) {
  let inFlight = false;
  const modelCache = new Map();

  discovery.on("peerLeft", (peerId) => {
    for (const [key] of modelCache) {
      if (key.includes(peerId)) modelCache.delete(key);
    }
  });

  async function getOrLoadModel(provider, model) {
    const cacheKey = `${provider.qvacTopic}:${provider.qvacProviderPublicKey}:${model.key}`;
    if (modelCache.has(cacheKey)) return modelCache.get(cacheKey).modelId;

    const modelId = await loadDelegatedModel({
      modelSrc: model.src,
      topic: provider.qvacTopic,
      providerPublicKey: provider.qvacProviderPublicKey,
      timeoutMs: config.requestTimeoutMs,
    });
    modelCache.set(cacheKey, { modelId });
    return modelId;
  }

  return async function onChat(res, body, isOai = false) {
    if (inFlight) {
      console.log("[chat] Busy — returning placeholder response");
      return sendBusyResponse(res, body, isOai);
    }

    inFlight = true;
    try {
      const wantsStreaming = body.stream !== false;
      const modelKey = body.model || config.defaultModelKey;
      const model = getModel(modelKey);

      const peers = discovery.listPeers();
      const provider = peers.find(
        (p) =>
          p.ledgerAccountId &&
          p.qvacProviderPublicKey &&
          p.qvacTopic &&
          (p.models || []).some((m) => m.key === model.key || m.id === model.id),
      );

      if (!provider) {
        throw new Error(`No providers found for model "${model.key}"`);
      }

      console.log(
        `[chat] selected provider ${provider.peerName} (${provider.peerId.slice(0, 8)}) ledger=${provider.ledgerAccountId.slice(0, 12)}`,
      );

      const messages = (body.messages || []).map((m) => ({ role: m.role, content: m.content }));
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      const prompt = lastUser?.content ?? "";

      const reqId = randomReqId();
      const memo = JSON.stringify({
        model: model.key,
        prompt,
        messages: messages.length,
        reqId,
      });
      const amount = Math.max(1, Math.ceil(pricePerRequest * model.tier));

      const proposal = await ledger.signProposal({
        toAccount: provider.ledgerAccountId,
        amount,
        memo,
      });
      await ledger.ingestSignedEvent(proposal);

      const accepted = waitForAcceptance(discovery, proposal.txId, acceptanceTimeoutMs);
      discovery.broadcastLedgerEvent("transfer-proposal", proposal);
      console.log(
        `[ledger] proposed ${proposal.txId.slice(0, 8)} -> ${provider.ledgerAccountId.slice(0, 12)} amount=${amount}`,
      );

      // acceptance is already ingested by the ledgerAcceptance handler in server.js;
      // calling ingestSignedEvent here again would race against that concurrent append
      const acceptance = await accepted;
      console.log(
        `[ledger] settled ${proposal.txId.slice(0, 8)} balance=${await ledger.balance()}`,
      );

      const modelId = await getOrLoadModel(provider, model);

      const history = truncateHistory(messages, model.contextTokens ?? 1024);
      const promptTokens = estimateTokens(history);
      const response = runCompletion({ modelId, history, stream: true });
      const providerMeta = providerInfo(provider);
      const id = `chatcmpl-${Math.random().toString(36).slice(2)}`;
      const created = Math.floor(Date.now() / 1000);

      if (wantsStreaming) {
        res.writeHead(200, {
          "Content-Type": isOai ? "text/event-stream" : "application/x-ndjson",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        let completionTokens = 0;
        for await (const token of response.tokenStream) {
          completionTokens++;
          if (isOai) {
            res.write(
              `data: ${JSON.stringify({
                id,
                object: "chat.completion.chunk",
                created,
                model: model.key,
                choices: [{ index: 0, delta: { content: token }, finish_reason: null }],
                usage: null,
              })}\n\n`,
            );
          } else {
            res.write(
              `${JSON.stringify({
                model: model.key,
                created_at: new Date().toISOString(),
                message: { role: "assistant", content: token },
                done: false,
              })}\n`,
            );
          }
        }

        const usage = { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens };

        if (isOai) {
          res.write(
            `data: ${JSON.stringify({
              id,
              object: "chat.completion.chunk",
              created,
              model: model.key,
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              usage: null,
            })}\n\n`,
          );
          // Final usage-only chunk (opencode reads usage from here when stream_options.include_usage=true)
          res.write(
            `data: ${JSON.stringify({
              id,
              object: "chat.completion.chunk",
              created,
              model: model.key,
              choices: [],
              usage,
            })}\n\n`,
          );
          res.write("data: [DONE]\n\n");
        } else {
          res.write(
            `${JSON.stringify({
              model: model.key,
              created_at: new Date().toISOString(),
              message: { role: "assistant", content: "" },
              done: true,
              provider: providerMeta,
              tx: { txId: proposal.txId, amount },
              usage,
            })}\n`,
          );
        }
        res.end();
        return;
      }

      let content = "";
      let completionTokens = 0;
      for await (const token of response.tokenStream) {
        content += token;
        completionTokens++;
      }

      const usage = { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens };

      if (isOai) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          id,
          object: "chat.completion",
          created,
          model: model.key,
          choices: [{
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop",
          }],
          usage,
          provider: providerMeta,
          tx: { txId: proposal.txId, amount },
        }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        model: model.key,
        created_at: new Date().toISOString(),
        message: { role: "assistant", content },
        done: true,
        provider: providerMeta,
        tx: { txId: proposal.txId, amount },
      }));
    } catch (err) {
      console.error("[chat] Error:", err?.message ?? err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err?.message ?? String(err) }));
      } else {
        res.end();
      }
    } finally {
      inFlight = false;
    }
  };
}

function sendBusyResponse(res, body, isOai) {
  const wantsStreaming = body.stream !== false;
  const modelKey = body.model || config.defaultModelKey;
  const id = `chatcmpl-${Math.random().toString(36).slice(2)}`;
  const created = Math.floor(Date.now() / 1000);
  const text = "I'm currently processing another request. Please resend your message in a moment.";

  if (wantsStreaming) {
    res.writeHead(200, {
      "Content-Type": isOai ? "text/event-stream" : "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    if (isOai) {
      res.write(
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created,
          model: modelKey,
          choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
        })}\n\n`,
      );
      res.write(
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created,
          model: modelKey,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        })}\n\n`,
      );
      res.write("data: [DONE]\n\n");
    } else {
      res.write(
        `${JSON.stringify({
          model: modelKey,
          created_at: new Date().toISOString(),
          message: { role: "assistant", content: text },
          done: false,
        })}\n`,
      );
      res.write(
        `${JSON.stringify({
          model: modelKey,
          created_at: new Date().toISOString(),
          message: { role: "assistant", content: "" },
          done: true,
        })}\n`,
      );
    }
    res.end();
    return;
  }

  if (isOai) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      id,
      object: "chat.completion",
      created,
      model: modelKey,
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    }));
    return;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    model: modelKey,
    created_at: new Date().toISOString(),
    message: { role: "assistant", content: text },
    done: true,
  }));
}

function waitForAcceptance(discovery, txId, timeoutMs) {
  return new Promise((resolveP, rejectP) => {
    const timer = setTimeout(() => {
      discovery.handlers.ledgerAcceptance =
        discovery.handlers.ledgerAcceptance.filter((h) => h !== handler);
      rejectP(new Error(`Timed out waiting for acceptance of ${txId.slice(0, 8)}`));
    }, timeoutMs);
    const handler = ({ event }) => {
      if (event?.txId !== txId) return;
      clearTimeout(timer);
      discovery.handlers.ledgerAcceptance =
        discovery.handlers.ledgerAcceptance.filter((h) => h !== handler);
      resolveP(event);
    };
    discovery.on("ledgerAcceptance", handler);
  });
}

function randomReqId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function truncateHistory(messages, tokenBudget) {
  const filtered = messages.filter((m) => m.role !== "system");
  let total = filtered.reduce((sum, m) => sum + Math.ceil((m.content || "").length / 4), 0);
  while (filtered.length > 1 && total > tokenBudget) {
    const removed = filtered.shift();
    total -= Math.ceil((removed.content || "").length / 4);
  }
  return filtered;
}

function providerInfo(provider) {
  return {
    peerName: provider.peerName ?? null,
    peerId: provider.peerId ?? null,
    qvacProviderPublicKey: provider.qvacProviderPublicKey ?? null,
    qvacTopic: provider.qvacTopic ?? null,
    ledgerAccountId: provider.ledgerAccountId ?? null,
    models: provider.models ?? [],
    rating: provider.rating ?? null,
    lastSeenAt: provider.lastSeenAt ?? null,
  };
}

function fingerprintMessages(messages) {
  return JSON.stringify(messages.map((m) => ({ role: m.role, content: m.content })));
}

function estimateTokens(messages) {
  return messages.reduce((sum, m) => sum + Math.ceil((m.content || "").length / 4), 0);
}
