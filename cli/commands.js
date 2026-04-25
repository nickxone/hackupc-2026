import {
  renderAskDetails,
  renderAskHeader,
  renderAskResult,
  renderAskPlan,
  renderBalance,
  renderCommandResult,
  renderDaemonStarted,
  renderPeers,
  renderProviderStarted,
  renderRateResult,
  renderUsage,
} from "./render.js";

const DEFAULT_PEER_SCAN_MS = 3_000;
const DEFAULT_API_URL = "http://127.0.0.1:11434";
const ASK_STRATEGIES = new Set(["cheapest", "best", "fastest", "rated"]);

const commandDefinitions = [
  {
    name: "daemon",
    usage: "daemon [--host addr] [--port n]",
    description: "Start the local Compute Exchange API.",
    async run(args) {
      const options = parseDaemonArgs(args);
      const { default: process } = await import("bare-process");
      const { startComputeExchangeApi } = await import("../src/server/compute-exchange-api.js");
      const { Discovery } = await import("../src/core/discovery.js");
      const { Ledger } = await import("../src/core/ledger.js");
      const { discoveryTopic, qvacTopic } = await import("../src/topics.js");
      const { default: os } = await import("bare-os");
      const { hostname } = os;

      const peerName = process.env?.PEER_NAME || hostname();
      const ledger = new Ledger(`data/${peerName}.ledger.json`);
      await ledger.load();

      const discovery = new Discovery({
        topicHex: discoveryTopic,
        peerName,
        models: [], // Daemon is a consumer by default
        qvacTopic,
      });

      discovery.on("creditAck", async (ack) => {
        await ledger.earn(ack);
      });

      let api;
      setupDaemonCleanup({
        getApi: () => api,
        discovery,
        process,
      });

      await discovery.start();

      api = await startComputeExchangeApi({
        ...options,
        onGetPeers: async () => discovery.listPeers(),
        onGetBalance: async () => ({ balance: ledger.balance(), log: ledger.state.log }),
      });
      return {
        output: renderDaemonStarted(api),
        keepAlive: true,
      };
    },
  },
  {
    name: "serve",
    usage: "serve [--models keys] [--peer-name name] [--topic hex] [--skip-download]",
    description: "Start provider mode and advertise served models.",
    async run(args) {
      await import("../qvac/worker.entry.mjs");
      const { default: process } = await import("bare-process");
      const { config } = await import("../src/config.js");
      const { default: os } = await import("bare-os");
      const { startProviderRuntime } = await import("../src/server/provider-runtime.js");
      const options = parseServeArgs(args, {
        defaultTopic: config.qvacTopic,
        defaultPeerName: process.env.PEER_NAME || os.hostname(),
        defaultModelKeys: Object.keys(config.models).join(","),
        env: process.env,
      });
      const provider = await startProviderRuntime({
        topic: options.topic,
        peerName: options.peerName,
        modelKeys: options.modelKeys,
        predownload: options.predownload,
      });

      setupProviderCleanup({ provider, process });

      return {
        output: renderProviderStarted(provider),
        keepAlive: true,
      };
    },
  },
  {
    name: "ask",
    usage: "ask [options] <prompt>",
    description: "Send a prompt to a discovered provider.",
    async run(args) {
      const { options, prompt } = parseAskArgs(args);
      if (!prompt) return renderAskPlan({ prompt, options });

      await import("../qvac/worker.entry.mjs");
      const { default: process } = await import("bare-process");
      const { config, getModel } = await import("../src/config.js");
      const {
        loadDelegatedModel,
        runCompletion,
        unload,
        shutdown,
      } = await import("../src/core/qvac.js");

      const stdout = process.stdout;
      const model = getModel(options.model ?? config.defaultModelKey);
      const peersPayload = await requestJson({ apiUrl: options.apiUrl, path: "/api/peers" });
      const provider = selectProvider({
        peers: peersPayload.peers ?? [],
        model,
        options,
      });

      if (!provider) {
        return renderAskResult({
          prompt,
          model: model.key,
          error: `No providers found for model "${model.key}".`,
        });
      }

      let content = "";
      let streamedHeader = false;
      let modelId = null;

      const streamHeader = () => {
        if (streamedHeader) return;
        stdout.write(renderAskHeader({ model: model.key }));
        streamedHeader = true;
      };

      try {
        modelId = await loadDelegatedModel({
          modelSrc: model.src,
          topic: provider.qvacTopic,
          providerPublicKey: provider.qvacProviderPublicKey,
          timeoutMs: config.requestTimeoutMs,
        });

        const response = runCompletion({
          modelId,
          history: [{ role: "user", content: prompt }],
          stream: true,
        });

        streamHeader();
        for await (const token of response.tokenStream) {
          content += token;
          stdout.write(token);
        }
        if (response.stats?.catch) await response.stats.catch(() => null);

        if (!content) stdout.write("(empty response)");
        const details = renderAskDetails({
          prompt,
          provider: providerInfo(provider),
        });
        if (details) stdout.write(`\n${details}`);
        stdout.write("\n");

        return {
          output: "",
          streamed: true,
        };
      } catch (err) {
        if (streamedHeader) stdout.write("\n");
        return renderAskResult({
          prompt,
          model: model.key,
          content,
          provider: providerInfo(provider),
          error: err?.message ?? String(err),
        });
      } finally {
        if (modelId) {
          await unload({ modelId }).catch(() => {});
        }
        await shutdown().catch(() => {});
      }
    },
  },
  {
    name: "peers",
    usage: "peers [--wait ms] [--api-url url]",
    description: "List peers from the local daemon.",
    async run(args) {
      const { waitMs, apiUrl } = parsePeersArgs(args);
      const payload = await requestJson({ apiUrl, path: "/api/peers" });
      return renderPeers({
        peers: payload.peers ?? [],
        peerId: payload.peerId ?? null,
        waitMs: payload.waitMs ?? waitMs,
      });
    },
  },
  {
    name: "balance",
    usage: "balance [--api-url url]",
    description: "Show daemon ledger balance.",
    async run(args) {
      const { apiUrl } = parseApiOnlyArgs(args, "balance");
      const payload = await requestJson({ apiUrl, path: "/api/balance" });
      return renderBalance(payload);
    },
  },
  {
    name: "rate",
    usage: "rate [--api-url url] <provider-id> <1-5>",
    description: "Rate a provider through the local daemon.",
    async run(args) {
      const { apiUrl, rest } = parseApiOnlyArgs(args, "rate");
      const [providerId, scoreRaw] = rest;
      const score = Number(scoreRaw);
      const validScore = Number.isInteger(score) && score >= 1 && score <= 5;

      if (!providerId || !validScore) {
        return renderRateResult({
          accepted: false,
          provider: providerId,
          score: Number.isFinite(score) ? score : null,
          error: "Usage requires a provider id and an integer score from 1 to 5.",
        });
      }

      const payload = await requestJson({
        apiUrl,
        method: "POST",
        path: "/api/rate",
        body: { provider: providerId, score },
        allowError: true,
      });

      return renderRateResult(payload);
    },
  },
];

const aliases = new Map([
  ["help", "help"],
  ["--help", "help"],
  ["-h", "help"],
]);

const commands = new Map(commandDefinitions.map((command) => [command.name, command]));

export function getCommands() {
  return commandDefinitions;
}

export async function runCommand(argv) {
  const [rawName = "help", ...args] = argv;
  const name = aliases.get(rawName) ?? rawName;

  if (name === "help") {
    return {
      output: renderUsage({ commands: commandDefinitions }),
      exitCode: 0,
    };
  }

  const command = commands.get(name);
  if (!command) {
    return {
      output: renderUsage({ commands: commandDefinitions }),
      error: `Unknown command: ${rawName}`,
      exitCode: 1,
    };
  }

  const result = await command.run(args);
  if (typeof result === "string") return { output: result, exitCode: 0 };

  return {
    output: result.output,
    exitCode: result.exitCode ?? 0,
    keepAlive: result.keepAlive ?? false,
    streamed: result.streamed ?? false,
  };
}

function parsePeersArgs(args) {
  const options = {
    waitMs: DEFAULT_PEER_SCAN_MS,
    apiUrl: DEFAULT_API_URL,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--wait") {
      options.waitMs = readIntegerOption(args, ++i, "--wait");
    } else if (arg === "--api-url") {
      options.apiUrl = readOptionValue(args, ++i, "--api-url");
    } else {
      throw new Error(`Unknown peers option: ${arg}`);
    }
  }

  return options;
}

function parseAskArgs(args) {
  const options = {
    peer: null,
    model: null,
    maxCredits: null,
    strategy: "cheapest",
    apiUrl: DEFAULT_API_URL,
  };
  const rest = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--peer") {
      options.peer = readOptionValue(args, ++i, "--peer");
    } else if (arg === "--model") {
      options.model = readOptionValue(args, ++i, "--model");
    } else if (arg === "--max-credits") {
      const value = Number(readOptionValue(args, ++i, "--max-credits"));
      if (!Number.isFinite(value) || value < 0) {
        throw new Error("`ask --max-credits` expects a non-negative number");
      }
      options.maxCredits = value;
    } else if (arg === "--strategy") {
      const value = readOptionValue(args, ++i, "--strategy");
      if (!ASK_STRATEGIES.has(value)) {
        throw new Error(
          "`ask --strategy` expects cheapest, best, fastest, or rated",
        );
      }
      options.strategy = value;
    } else if (arg === "--api-url") {
      options.apiUrl = readOptionValue(args, ++i, "--api-url");
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown ask option: ${arg}`);
    } else {
      rest.push(arg);
    }
  }

  return { options, prompt: rest.join(" ").trim() };
}

function parseApiOnlyArgs(args, commandName) {
  const options = {
    apiUrl: DEFAULT_API_URL,
    rest: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--api-url") {
      options.apiUrl = readOptionValue(args, ++i, "--api-url");
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown ${commandName} option: ${arg}`);
    } else {
      options.rest.push(arg);
    }
  }

  return options;
}

function parseDaemonArgs(args) {
  const options = {
    host: "127.0.0.1",
    port: 11434,
    peerScanMs: 1_000,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--host") {
      options.host = readOptionValue(args, ++i, "--host");
    } else if (arg === "--port") {
      options.port = readIntegerOption(args, ++i, "--port");
    } else if (arg === "--peer-scan-ms") {
      options.peerScanMs = readIntegerOption(args, ++i, "--peer-scan-ms");
    } else {
      throw new Error(`Unknown daemon option: ${arg}`);
    }
  }

  return options;
}

function parseServeArgs(args, { defaultTopic, defaultPeerName, defaultModelKeys, env = {} }) {
  const options = {
    topic: env.QVAC_TOPIC || defaultTopic,
    peerName: env.PEER_NAME || defaultPeerName,
    modelKeys: (env.MODELS || defaultModelKeys)
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean),
    predownload: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--topic") {
      options.topic = readOptionValue(args, ++i, "--topic");
    } else if (arg === "--peer-name") {
      options.peerName = readOptionValue(args, ++i, "--peer-name");
    } else if (arg === "--models") {
      options.modelKeys = readOptionValue(args, ++i, "--models")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean);
    } else if (arg === "--skip-download") {
      options.predownload = false;
    } else {
      throw new Error(`Unknown serve option: ${arg}`);
    }
  }

  return options;
}

function readOptionValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} expects a value`);
  }
  return value;
}

function readIntegerOption(args, index, flag) {
  const value = Number(readOptionValue(args, index, flag));
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${flag} expects a non-negative integer`);
  }
  return value;
}

async function requestJson({
  apiUrl = DEFAULT_API_URL,
  method = "GET",
  path,
  body,
  allowError = false,
}) {
  const response = await requestText({ apiUrl, method, path, body });
  const payload = parseJson(response.text, path);
  if (!allowError && response.statusCode >= 400) {
    throw new Error(payload.error ?? `HTTP ${response.statusCode} from ${path}`);
  }
  return payload;
}

async function requestJsonLines({ apiUrl = DEFAULT_API_URL, method = "GET", path, body }) {
  const response = await requestText({ apiUrl, method, path, body });
  const text = response.text.trim();
  const lines = text
    ? text.split(/\r?\n/).filter(Boolean).map((line) => parseJson(line, path))
    : [];

  if (response.statusCode >= 400) {
    const last = lines.at(-1);
    return {
      ok: false,
      lines,
      error: last?.error ?? `HTTP ${response.statusCode} from ${path}`,
    };
  }

  return { ok: true, lines };
}

async function requestJsonLinesStream({
  apiUrl = DEFAULT_API_URL,
  method = "GET",
  path,
  body,
  onLine,
}) {
  const response = await requestStream({
    apiUrl,
    method,
    path,
    body,
    onText(text, response, flush = false) {
      parseJsonLinesChunk({
        text,
        path,
        response,
        onLine,
        flush,
      });
    },
  });

  if (response.statusCode >= 400) {
    const last = response.lines.at(-1);
    return {
      ok: false,
      lines: response.lines,
      error: last?.error ?? `HTTP ${response.statusCode} from ${path}`,
    };
  }

  return { ok: true, lines: response.lines };
}

async function requestStream({ apiUrl, method, path, body, onText }) {
  const { default: http } = await import("bare-http1");
  const url = new URL(path, apiUrl);
  const payload = body == null ? null : JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const state = {
      statusCode: 0,
      buffer: "",
      lines: [],
    };
    const req = http.request(
      {
        method,
        hostname: url.hostname,
        host: url.hostname,
        port: Number(url.port || 80),
        path: `${url.pathname}${url.search}`,
        headers: payload
          ? {
              "content-type": "application/json",
              "content-length": String(payload.length),
            }
          : undefined,
      },
      (res) => {
        state.statusCode = res.statusCode ?? 0;
        res.on("data", (chunk) => {
          try {
            onText(chunk.toString(), state);
          } catch (err) {
            reject(err);
          }
        });
        res.on("end", () => {
          try {
            onText("\n", state, true);
            resolve(state);
          } catch (err) {
            reject(err);
          }
        });
      },
    );

    req.on("error", (err) => {
      reject(new Error(`Unable to reach daemon at ${apiUrl}: ${err.message}`));
    });

    if (payload) req.write(payload);
    req.end();
  });
}

function parseJsonLinesChunk({ text, path, response, onLine, flush = false }) {
  response.buffer += text;
  const parts = response.buffer.split(/\r?\n/);
  response.buffer = flush ? "" : parts.pop() ?? "";

  for (const part of parts) {
    const lineText = part.trim();
    if (!lineText) continue;
    const line = parseJson(lineText, path);
    response.lines.push(line);
    if (response.statusCode < 400) onLine(line);
  }
}

async function requestText({ apiUrl, method, path, body }) {
  const { default: http } = await import("bare-http1");
  const url = new URL(path, apiUrl);
  const payload = body == null ? null : JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method,
        hostname: url.hostname,
        host: url.hostname,
        port: Number(url.port || 80),
        path: `${url.pathname}${url.search}`,
        headers: payload
          ? {
              "content-type": "application/json",
              "content-length": String(payload.length),
            }
          : undefined,
      },
      (res) => {
        let text = "";
        res.on("data", (chunk) => {
          text += chunk.toString();
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode ?? 0, text });
        });
      },
    );

    req.on("error", (err) => {
      reject(new Error(`Unable to reach daemon at ${apiUrl}: ${err.message}`));
    });

    if (payload) req.write(payload);
    req.end();
  });
}

function parseJson(text, path) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid JSON response from ${path}: ${err.message}`);
  }
}

function selectProvider({ peers, model, options }) {
  const eligible = peers.filter((peer) => {
    if (!peer.qvacProviderPublicKey || !peer.qvacTopic) return false;
    if (options.peer && !matchesPeer(peer, options.peer)) return false;
    return peer.models?.some((m) => m.key === model.key || m.id === model.id);
  });

  if (eligible.length === 0) return null;

  if (options.strategy === "rated") {
    return [...eligible].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];
  }

  if (options.strategy === "fastest") {
    return [...eligible].sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0))[0];
  }

  return eligible[0];
}

function matchesPeer(peer, requestedPeer) {
  return [
    peer.peerId,
    peer.qvacProviderPublicKey,
    peer.peerName,
  ].some((value) => value && value.startsWith(requestedPeer));
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

function setupDaemonCleanup({ getApi, discovery, process }) {
  let cleaningUp = false;

  const cleanup = async (signal) => {
    if (cleaningUp) {
      process.exit(1);
      return;
    }

    cleaningUp = true;
    console.log(`\nReceived ${signal}; shutting down daemon...`);

    const errors = [];
    await runCleanupStep("HTTP API", () => getApi()?.stop?.(), errors);
    await runCleanupStep("discovery", () => discovery.stop(), errors);

    if (errors.length > 0) {
      for (const err of errors) {
        console.error(`[daemon] Cleanup failed for ${err.label}: ${err.message}`);
      }
      process.exit(1);
      return;
    }

    process.exit(signal === "SIGINT" ? 130 : 143);
  };

  process.on("SIGINT", () => cleanup("SIGINT"));
  process.on("SIGTERM", () => cleanup("SIGTERM"));
}

function setupProviderCleanup({ provider, process }) {
  let cleaningUp = false;

  const cleanup = async (signal) => {
    if (cleaningUp) {
      process.exit(1);
      return;
    }

    cleaningUp = true;
    console.log(`\nReceived ${signal}; shutting down provider...`);

    try {
      await provider.stop();
    } catch (err) {
      console.error(`[serve] Cleanup failed: ${err?.message ?? String(err)}`);
      process.exit(1);
      return;
    }

    process.exit(signal === "SIGINT" ? 130 : 143);
  };

  process.on("SIGINT", () => cleanup("SIGINT"));
  process.on("SIGTERM", () => cleanup("SIGTERM"));
}

async function runCleanupStep(label, step, errors) {
  try {
    await step();
  } catch (err) {
    errors.push({ label, message: err?.message ?? String(err) });
  }
}
