import {
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
      const { config, getModel } = await import("../src/config.js");
      const { default: os } = await import("bare-os");
      const { hostname } = os;
      
      const peerName = process.env?.PEER_NAME || hostname();
      const ledger = new Ledger(`data/${peerName}.ledger.json`);
      await ledger.load();

      const discovery = new Discovery({
        topicHex: config.discoveryTopic,
        peerName,
        models: [], // Daemon is a consumer by default
        qvacTopic: config.qvacTopic,
      });

      discovery.on("creditAck", async (ack) => {
        await ledger.earn(ack);
      });

      let api;
      let shutdownQvac = null;
      setupDaemonCleanup({
        getApi: () => api,
        discovery,
        getShutdown: () => shutdownQvac,
        process,
      });

      await discovery.start();

      api = await startComputeExchangeApi({
        ...options,
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

            await import("../qvac/worker.entry.mjs");
            const {
              loadDelegatedModel,
              runCompletion,
              shutdown,
              unload,
            } = await import("../src/core/qvac.js");
            shutdownQvac = shutdown;

            const modelId = await loadDelegatedModel({
              modelSrc: model.src,
              topic: provider.qvacTopic,
              providerPublicKey: provider.qvacProviderPublicKey,
              timeoutMs: config.requestTimeoutMs
            });

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

            if (isOai) {
              res.write(`data: ${JSON.stringify({
                id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: model.key,
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
              })}\n\n`);
              res.write("data: [DONE]\n\n");
            } else {
              const chunk = {
                model: model.key, created_at: new Date().toISOString(), message: { role: "assistant", content: "" }, done: true
              };
              res.write(`${JSON.stringify(chunk)}\n`);
            }
            res.end();

            const stats = await response.stats;
            const tokens = stats?.usage?.total_tokens || totalTokens;
            const credits = Math.ceil(tokens / 10) * model.tier;

            await ledger.spend({
              to: provider.qvacProviderPublicKey, tokens, credits, model: model.key
            });

            await discovery.sendCreditAck({
              to: provider.qvacProviderPublicKey, tokens, credits, model: model.key
            });
            
            await unload({ modelId });
          } catch (err) {
            if (!res.headersSent) {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: err.message }));
            } else {
              res.end();
            }
          }
        }
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
    description: "Send a prompt through the local daemon.",
    async run(args) {
      const { options, prompt } = parseAskArgs(args);
      if (!prompt) return renderAskPlan({ prompt, options });

      const response = await requestJsonLines({
        apiUrl: options.apiUrl,
        method: "POST",
        path: "/api/chat",
        body: {
          model: options.model ?? undefined,
          messages: [{ role: "user", content: prompt }],
          stream: true,
          options: {
            peer: options.peer,
            max_credits: options.maxCredits,
            strategy: options.strategy,
          },
        },
      });

      const content = response.lines
        .map((line) => line.message?.content ?? line.response ?? "")
        .join("");
      const last = response.lines.at(-1) ?? response.json;

      return renderAskResult({
        prompt,
        model: last?.model ?? options.model,
        content,
        error: response.ok ? last?.error : response.error,
      });
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

function setupDaemonCleanup({ getApi, discovery, getShutdown, process }) {
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
    const shutdown = getShutdown?.();
    if (shutdown) {
      await runCleanupStep("QVAC SDK", () => shutdown(), errors);
    }

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
