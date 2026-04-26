import http from "bare-http1";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 11434;

export async function startComputeExchangeApi({
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  peerScanMs = 1_000,
  onChat,
  onGetPeers,
  onGetBalance,
  onGetModels,
  onRate,
  onGetRatings,
} = {}) {
  const server = http.createServer((req, res) => {
    handleRequest(req, res, {
      peerScanMs,
      onChat,
      onGetPeers,
      onGetBalance,
      onGetModels,
      onRate,
      onGetRatings,
    }).catch((err) => {
      sendJson(res, 500, {
        error: err?.message ?? String(err),
      });
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === "object" ? address.port : port;
  let stopped = false;

  return {
    server,
    host,
    port: actualPort,
    url: `http://${host}:${actualPort}`,
    peerScanMs,
    async stop() {
      if (stopped) return;
      stopped = true;
      await new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}

async function handleRequest(
  req,
  res,
  { peerScanMs, onChat, onGetPeers, onGetBalance, onGetModels, onRate, onGetRatings },
) {
  const url = new URL(req.url, "http://localhost");

  // Add CORS headers for 3rd party apps (like OpenWebUI)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  console.log(`[http] ${req.method} ${url.pathname}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    return sendJson(res, 200, {
      name: "compute-exchange",
      status: "ok",
      message: "Local Compute Exchange API is running.",
    });
  }

  if (req.method === "GET" && url.pathname === "/api/version") {
    return sendJson(res, 200, {
      version: "0.0.1",
      backend: "compute-exchange-p2p",
    });
  }

  if (req.method === "GET" && url.pathname === "/api/tags") {
    return sendJson(res, 200, {
      models: [],
      p2p: placeholder("Model catalog is not wired yet."),
    });
  }

  if (req.method === "GET" && url.pathname === "/api/peers") {
    if (onGetPeers) {
      const payload = await onGetPeers();
      if (Array.isArray(payload)) {
        return sendJson(res, 200, { peers: payload, waitMs: peerScanMs });
      }
      return sendJson(res, 200, {
        peerId: payload?.peerId ?? null,
        peers: payload?.peers ?? [],
        waitMs: payload?.waitMs ?? peerScanMs,
      });
    }
    return sendJson(res, 200, {
      peerId: null,
      waitMs: peerScanMs,
      peers: [],
      p2p: placeholder("Hyperswarm discovery is not wired into the API yet."),
    });
  }

  if (req.method === "GET" && url.pathname === "/api/balance") {
    if (onGetBalance) {
      const { balance, log } = await onGetBalance();
      return sendJson(res, 200, { balance, log });
    }
    return sendJson(res, 200, {
      balance: null,
      log: [],
      p2p: placeholder("Credit storage is not wired yet."),
    });
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    const body = await readJson(req);
    console.log(`[http] /api/chat body=${JSON.stringify(body)}`);
    if (onChat) {
      return onChat(res, body);
    }
    return sendChatPlaceholder(res, body);
  }

  if (req.method === "POST" && url.pathname === "/api/rate") {
    const body = await readJson(req);
    if (onRate) {
      const payload = await onRate(body);
      return sendJson(res, payload?.accepted === false ? 400 : 200, payload);
    }
    return sendJson(res, 501, {
      accepted: false,
      provider: body.provider ?? body.provider_id ?? null,
      score: body.score ?? null,
      p2p: placeholder("Provider ratings are not wired yet."),
    });
  }

  if (req.method === "GET" && url.pathname === "/api/ratings") {
    if (onGetRatings) {
      const target = url.searchParams.get("target");
      return sendJson(res, 200, await onGetRatings({ target }));
    }
    return sendJson(res, 200, {
      target: url.searchParams.get("target"),
      average: null,
      count: 0,
      ratings: [],
      averages: [],
      p2p: placeholder("Provider ratings are not wired yet."),
    });
  }

  if (req.method === "GET" && url.pathname === "/v1/models") {
    const models = onGetModels ? await onGetModels() : [];
    return sendJson(res, 200, {
      object: "list",
      data: models.map((m) => ({
        id: m.key,
        object: "model",
        created: 0,
        owned_by: "p2p",
      })),
    });
  }

  // Also support OpenAI compatibility for wider tool support
  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    const body = await readJson(req);
    console.log(`[http] /v1/chat/completions body=${JSON.stringify(body)}`);
    if (onChat) {
      return onChat(res, body, true); // true = use OpenAI format
    }
    return sendChatPlaceholder(res, body);
  }

  return sendJson(res, 404, {
    error: `No route for ${req.method} ${url.pathname}`,
  });
}

function sendChatPlaceholder(res, body) {
  const payload = {
    model: body.model ?? "unknown",
    created_at: new Date().toISOString(),
    message: {
      role: "assistant",
      content: "",
    },
    done: true,
    error: "QVAC delegated chat is not wired yet.",
    p2p: {
      status: "not_implemented",
      messages: body.messages ?? [],
      options: normalizeP2pOptions(body),
    },
  };

  if (body.stream === false) return sendJson(res, 501, payload);
  return sendJsonLine(res, 501, payload);
}

function normalizeP2pOptions(body) {
  return {
    peer: body.options?.peer ?? body.peer ?? null,
    maxCredits: body.options?.max_credits ?? body.max_credits ?? null,
    strategy: body.options?.strategy ?? body.strategy ?? "cheapest",
  };
}

function placeholder(message) {
  return {
    status: "not_implemented",
    message,
  };
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk.toString();
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json",
  });
  res.end(JSON.stringify(payload, null, 2) + "\n");
}

function sendJsonLine(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/x-ndjson",
  });
  res.end(JSON.stringify(payload) + "\n");
}
