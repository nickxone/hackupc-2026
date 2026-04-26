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

export function createChatHandler({ ledger, discovery, pricing, acceptanceTimeoutMs = 15_000 }) {
  // resolves when the current in-flight request finishes (null when idle)
  let inFlightDone = null;
  const modelCache = new Map();
  // fingerprint → { content, model, usage, id, created, at }
  const responseCache = new Map();
  // fingerprint → Promise<cacheEntry>  (in-flight dedup)
  const pendingRequests = new Map();
  const RESPONSE_TTL_MS = 60_000;

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
    const fingerprint = fingerprintMessages(body.messages || []);

    // Return cached response if the same prompt was answered recently
    const cached = responseCache.get(fingerprint);
    if (cached && Date.now() - cached.at < RESPONSE_TTL_MS) {
      console.log("[chat] Cache hit — replaying cached response");
      return sendCachedResponse(res, cached, body, isOai);
    }

    // If the same prompt is currently in-flight, wait for it then replay
    const pending = pendingRequests.get(fingerprint);
    if (pending) {
      console.log("[chat] Duplicate request — waiting for in-flight result");
      try {
        const entry = await pending;
        return sendCachedResponse(res, entry, body, isOai);
      } catch (err) {
        console.error("[chat] In-flight request failed:", err?.message ?? err);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err?.message ?? String(err) }));
        } else {
          res.end();
        }
        return;
      }
    }

    if (inFlightDone) {
      console.log("[chat] Busy — waiting for in-flight request to finish");
      await inFlightDone;
      // After the in-flight request completes, check whether its result covers this request
      const nowCached = responseCache.get(fingerprint);
      if (nowCached && Date.now() - nowCached.at < RESPONSE_TTL_MS) {
        console.log("[chat] Cache hit after wait — replaying cached response");
        return sendCachedResponse(res, nowCached, body, isOai);
      }
      // Different prompt; fall through and process it now
    }

    // Register a pending promise so duplicate requests can await this result
    let resolvePending, rejectPending;
    pendingRequests.set(
      fingerprint,
      new Promise((res, rej) => { resolvePending = res; rejectPending = rej; }),
    );

    let resolveInflight;
    inFlightDone = new Promise(r => { resolveInflight = r; });
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
      const amount = typeof pricing?.getPriceForTier === "function"
        ? pricing.getPriceForTier(model.tier)
        : Math.max(1, Math.ceil((pricing?.pricePerRequest ?? 1) * model.tier));

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

      let fullContent = "";

      if (wantsStreaming) {
        res.writeHead(200, {
          "Content-Type": isOai ? "text/event-stream" : "application/x-ndjson",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        let completionTokens = 0;
        for await (const token of response.tokenStream) {
          fullContent += token;
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

        const entry = { content: fullContent, model: model.key, usage, id, created, at: Date.now() };
        responseCache.set(fingerprint, entry);
        resolvePending(entry);
        return;
      }

      let completionTokens = 0;
      for await (const token of response.tokenStream) {
        fullContent += token;
        completionTokens++;
      }

      const usage = { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens };

      const entry = { content: fullContent, model: model.key, usage, id, created, at: Date.now() };
      responseCache.set(fingerprint, entry);
      resolvePending(entry);

      if (isOai) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          id,
          object: "chat.completion",
          created,
          model: model.key,
          choices: [{
            index: 0,
            message: { role: "assistant", content: fullContent },
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
        message: { role: "assistant", content: fullContent },
        done: true,
        provider: providerMeta,
        tx: { txId: proposal.txId, amount },
      }));
    } catch (err) {
      rejectPending(err);
      console.error("[chat] Error:", err?.message ?? err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err?.message ?? String(err) }));
      } else {
        res.end();
      }
    } finally {
      pendingRequests.delete(fingerprint);
      inFlightDone = null;
      resolveInflight();
    }
  };
}

function sendCachedResponse(res, entry, body, isOai) {
  const wantsStreaming = body.stream !== false;
  const { content, model, usage, id, created } = entry;

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
          model,
          choices: [{ index: 0, delta: { content }, finish_reason: null }],
          usage: null,
        })}\n\n`,
      );
      res.write(
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: null,
        })}\n\n`,
      );
      res.write(
        `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [], usage })}\n\n`,
      );
      res.write("data: [DONE]\n\n");
    } else {
      res.write(
        `${JSON.stringify({ model, created_at: new Date().toISOString(), message: { role: "assistant", content }, done: false })}\n`,
      );
      res.write(
        `${JSON.stringify({ model, created_at: new Date().toISOString(), message: { role: "assistant", content: "" }, done: true, usage })}\n`,
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
      model,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage,
    }));
    return;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    model,
    created_at: new Date().toISOString(),
    message: { role: "assistant", content },
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
