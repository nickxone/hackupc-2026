import {
  renderAskDetails,
  renderAskHeader,
  renderAskResult,
  renderAskPlan,
  renderBalance,
  renderBrandHeader,
  renderCommandResult,
  renderDaemonStarted,
  renderPeers,
  renderProviderStarted,
  renderRateResult,
  renderRatingsResult,
  renderUsage,
} from "./render.js";

const DEFAULT_PEER_SCAN_MS = 3_000;
const DEFAULT_API_URL = "http://127.0.0.1:11434";

const commandDefinitions = [
  {
    name: "daemon",
    usage: "daemon [--host addr] [--port n] [--debug]",
    description: "Start the local Compute Exchange API.",
    async run(args) {
      const options = parseDaemonArgs(args);
      const { default: process } = await import("bare-process");
      if (!options.debug) silenceSdkConsoleLogs();

      console.log(renderBrandHeader());
      console.log("");
      const stopLoading = options.debug ? null : startLoadingAnimation("Starting daemon", process);
      let api;
      let discovery;
      let ledger;
      let ratings;
      let peerName;
      try {
      await import("../qvac/worker.entry.mjs");
      const { resolve } = await import("bare-path");
      const { startComputeExchangeApi } = await import("../src/server/compute-exchange-api.js");
      const { Discovery } = await import("../src/core/discovery.js");
      const { LedgerNode } = await import("../src/ledger/node.js");
      const { RatingsNode } = await import("../src/ratings/node.js");
      const { createChatHandler, createModelsHandler } = await import("../src/server/chat-handler.js");
      const { config } = await import("../src/config.js");
      const { default: os } = await import("bare-os");
      const { hostname } = os;

      peerName = (process.env?.PEER_NAME || hostname()).replace(/[^a-z0-9_-]/gi, "-");
      ledger = new LedgerNode({
        rootDir: resolve(`data/${peerName}/ledger`),
        name: peerName,
      });
      await ledger.ready();
      const ledgerRegistration = await ledger.announceAccount();
      ledger.startBackgroundUpdates();

      ratings = new RatingsNode({
        rootDir: resolve(`data/${peerName}/ratings`),
        name: peerName,
      });
      await ratings.ready();
      ratings.startBackgroundUpdates();

      discovery = new Discovery({
        topicHex: config.discoveryTopic,
        peerName,
        models: [],
        qvacTopic: config.qvacTopic,
        ledgerAccountId: ledger.accountId,
        ledgerRegistration,
      });

      discovery.on("announce", async (peer) => {
        const summary = peer.ledgerAccountId
          ? await ratings.summaryFor(peer.ledgerAccountId)
          : { average: null, count: 0 };
        console.log(formatDiscoveredPeerSummary(peer, summary));
      });

      discovery.on("ledgerRegister", async ({ event }) => {
        try {
          await ledger.ingestSignedEvent(event);
        } catch (err) {
          console.warn(`[ledger] failed to ingest registration: ${err?.message ?? err}`);
        }
      });

      discovery.on("ledgerProposal", async ({ event }) => {
        try {
          await ledger.ingestSignedEvent(event);
        } catch (err) {
          console.warn(`[ledger] failed to ingest proposal: ${err?.message ?? err}`);
        }
      });

      discovery.on("ledgerAcceptance", async ({ event }) => {
        try {
          await ledger.ingestSignedEvent(event);
        } catch (err) {
          console.warn(`[ledger] failed to ingest acceptance: ${err?.message ?? err}`);
        }
      });

      discovery.on("rating", async ({ event }) => {
        try {
          await ratings.ingestEvent(event);
        } catch (err) {
          console.warn(`[ratings] failed to ingest rating: ${err?.message ?? err}`);
        }
      });

      setupDaemonCleanup({
        getApi: () => api,
        discovery,
        ledger,
        ratings,
        process,
      });

      await discovery.start();

      api = await startComputeExchangeApi({
        ...options,
        onGetModels: createModelsHandler({ discovery }),
        onGetPeers: async () => ({
          peerId: discovery.myPeerId(),
          peers: await enrichPeersWithRatings(discovery.listPeers(), ratings),
        }),
        onGetBalance: async () => {
          const wallet = await ledger.localMachineBalance(resolve("data"));
          return {
            accountId: ledger.accountId,
            accounts: wallet.accounts,
            balance: wallet.balance,
            log: await ledger.accountHistory(wallet.accounts.map((account) => account.accountId)),
          };
        },
        onRate: async ({ provider, provider_id: providerIdAlt, score }) => {
          const requested = String(provider ?? providerIdAlt ?? "").trim();
          const fallback = requested ? null : await ledger.lastRecipientAccount();
          const target = requested
            ? resolveRatingTarget(discovery.listPeers(), requested)
            : fallback?.toAccount ?? null;
          if (!target) {
            return {
              accepted: false,
              error: "No rating target provided and no previous outgoing payment was found.",
            };
          }

          const event = await ratings.createRating({ target, score: Number(score) });
          discovery.broadcastRatingEvent(event);

          const values = await ratings.ratingsFor(target);
          return {
            accepted: true,
            provider: target,
            score: event.score,
            average: await ratings.averageFor(target),
            count: values.length,
            rating: event,
            inferredFromLastPayment: !requested,
          };
        },
        onGetRatings: async ({ target }) => {
          if (target) {
            const values = await ratings.ratingsFor(target);
            return {
              target,
              average: await ratings.averageFor(target),
              count: values.length,
              ratings: values,
            };
          }
          return { averages: await ratings.allAverages() };
        },
        onChat: createChatHandler({
          ledger,
          discovery,
          pricing: config.ledger,
        }),
      });
      } finally {
        if (stopLoading) stopLoading();
      }
      return {
        output: renderDaemonStarted({
          ...api,
          peerName,
          peerId: discovery.myPeerId(),
          ledgerAccountId: ledger.accountId,
          includeHeader: false,
        }),
        keepAlive: true,
      };
    },
  },
  {
    name: "serve",
    usage: "serve [--models keys] [--peer-name name] [--topic hex] [--skip-download] [--debug]",
    description: "Start provider mode and advertise served models.",
    async run(args) {
      const { default: process } = await import("bare-process");
      const { config } = await import("../src/config.js");
      const { default: os } = await import("bare-os");
      const startupLogBuffer = [];
      let liveLogs = false;
      const bufferedLog = (...parts) => {
        const line = parts.map((part) => String(part)).join(" ");
        if (liveLogs) console.log(line);
        else startupLogBuffer.push(line);
      };
      const bufferedError = (...parts) => {
        const line = parts.map((part) => String(part)).join(" ");
        if (liveLogs) console.error(line);
        else startupLogBuffer.push(line);
      };
      const options = parseServeArgs(args, {
        defaultTopic: config.qvacTopic,
        defaultPeerName: os.hostname().replace(/[^a-z0-9_-]/gi, "-"),
        defaultModelKeys: Object.keys(config.models).join(","),
        env: process.env,
      });
      liveLogs = options.debug;
      if (!options.debug) silenceSdkConsoleLogs();

      console.log(renderBrandHeader());
      console.log("");
      const stopLoading = options.debug ? null : startLoadingAnimation("Starting provider", process);
      let provider;
      try {
        await import("../qvac/worker.entry.mjs");
        const { startProviderRuntime } = await import("../src/server/provider-runtime.js");
        provider = await startProviderRuntime({
          topic: options.topic,
          peerName: options.peerName,
          modelKeys: options.modelKeys,
          predownload: options.predownload,
          log: bufferedLog,
          error: bufferedError,
        });
      } finally {
        if (stopLoading) stopLoading();
      }
      liveLogs = true;

      setupProviderCleanup({ provider, process });

      return {
        output: renderProviderStarted({ ...provider, includeHeader: false }),
        keepAlive: true,
      };
    },
  },
  {
    name: "ask",
    usage: "ask [--model key] [--api-url url] <prompt>",
    description: "Send a prompt to a discovered provider.",
    async run(args) {
      const { options, prompt } = parseAskArgs(args);
      if (!prompt) return renderAskPlan({ prompt, options });

      const { default: process } = await import("bare-process");
      const { config, getModel } = await import("../src/config.js");

      const stdout = process.stdout;
      const model = getModel(options.model ?? config.defaultModelKey);
      let content = "";
      let streamedHeader = false;
      let provider = null;

      const streamHeader = () => {
        if (streamedHeader) return;
        stdout.write(renderAskHeader({ model: model.key }));
        streamedHeader = true;
      };

      try {
        streamHeader();

        const response = await requestJsonLinesStream({
          apiUrl: options.apiUrl,
          method: "POST",
          path: "/api/chat",
          body: {
            model: model.key,
            stream: true,
            messages: [{ role: "user", content: prompt }],
          },
          onLine(line) {
            if (line.error) throw new Error(line.error);
            if (line.provider) provider = providerInfo(line.provider);
            const token = line.message?.content ?? line.response ?? "";
            if (!line.done && token) {
              content += token;
              stdout.write(token);
            }
          },
        });

        if (!response.ok) {
          throw new Error(response.error);
        }

        if (!content) stdout.write("(empty response)");
        const details = renderAskDetails({
          prompt,
          provider,
        });
        if (details) stdout.write(`\n${details}`);
        stdout.write("\n");

        return {
          output: "",
          streamed: true,
        };
      } catch (err) {
        if (streamedHeader && content) {
          stdout.write(`\n${c("red", "Error")} ${err?.message ?? String(err)}\n`);
          return {
            output: "",
            streamed: true,
            exitCode: 1,
          };
        }
        if (streamedHeader) stdout.write("\n");
        return renderAskResult({
          prompt,
          model: model.key,
          content,
          provider,
          error: err?.message ?? String(err),
        });
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
    usage: "rate [--api-url url] [ledger-account-id] <1-5>",
    description: "Rate a provider through the local daemon.",
    async run(args) {
      const { apiUrl, rest } = parseApiOnlyArgs(args, "rate");
      const [first, second] = rest;
      const hasExplicitProvider = rest.length >= 2;
      const providerId = hasExplicitProvider ? first : null;
      const score = Number(hasExplicitProvider ? second : first);
      const validScore = Number.isInteger(score) && score >= 1 && score <= 5;

      if (!validScore) {
        return renderRateResult({
          accepted: false,
          provider: providerId,
          score: Number.isFinite(score) ? score : null,
          error: "Usage requires `rate <1-5>` or `rate <ledger-account-id> <1-5>`.",
        });
      }

      const payload = await requestJson({
        apiUrl,
        method: "POST",
        path: "/api/rate",
        body: providerId ? { provider: providerId, score } : { score },
        allowError: true,
      });

      return renderRateResult(payload);
    },
  },
  {
    name: "ratings",
    usage: "ratings [--api-url url] [ledger-account-id]",
    description: "Show average ratings or all rated peers.",
    async run(args) {
      const { apiUrl, rest } = parseApiOnlyArgs(args, "ratings");
      const target = rest[0] ?? null;
      const suffix = target ? `?target=${encodeURIComponent(target)}` : "";
      const payload = await requestJson({ apiUrl, path: `/api/ratings${suffix}` });
      return renderRatingsResult(payload);
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
    model: null,
    apiUrl: DEFAULT_API_URL,
  };
  const rest = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--model") {
      options.model = readOptionValue(args, ++i, "--model");
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
    debug: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--host") {
      options.host = readOptionValue(args, ++i, "--host");
    } else if (arg === "--port") {
      options.port = readIntegerOption(args, ++i, "--port");
    } else if (arg === "--peer-scan-ms") {
      options.peerScanMs = readIntegerOption(args, ++i, "--peer-scan-ms");
    } else if (arg === "--debug") {
      options.debug = true;
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
    debug: false,
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
    } else if (arg === "--debug") {
      options.debug = true;
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

function providerInfo(provider) {
  if (!provider) return null;
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

async function enrichPeersWithRatings(peers, ratings) {
  return Promise.all(
    peers.map(async (peer) => {
      const summary = peer.ledgerAccountId
        ? await ratings.summaryFor(peer.ledgerAccountId)
        : { average: null, count: 0 };

      return {
        ...peer,
        rating: summary.average,
        ratingCount: summary.count,
      };
    }),
  );
}

function resolveRatingTarget(peers, requested) {
  if (!requested) return null;

  const byLedger = peers.find((peer) => peer.ledgerAccountId === requested);
  if (byLedger?.ledgerAccountId) return byLedger.ledgerAccountId;

  const byPeer = peers.find((peer) => peer.peerId === requested);
  if (byPeer?.ledgerAccountId) return byPeer.ledgerAccountId;

  return requested;
}

function setupDaemonCleanup({ getApi, discovery, ledger, ratings, process }) {
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
    await runCleanupStep("ratings", () => ratings?.close?.(), errors);
    await runCleanupStep("ledger", () => ledger?.close?.(), errors);

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

function silenceSdkConsoleLogs() {
  const methods = ["log", "info", "warn", "error", "debug"];
  const original = {};

  for (const method of methods) {
    const current = console[method];
    if (typeof current !== "function") continue;
    original[method] = current;
    console[method] = (...parts) => {
      const line = parts.map((part) => String(part)).join(" ");
      if (line.startsWith("[sdk:client]") || line.startsWith("[sdk:server]")) return;
      return original[method].apply(console, parts);
    };
  }
}

function startLoadingAnimation(label, process) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let index = 0;
  let active = true;
  let lastLength = 0;
  const startedAt = Date.now();

  const write = (text) => {
    const stdout = process?.stdout ?? globalThis.process?.stdout;
    if (stdout && typeof stdout.write === "function") {
      stdout.write(text);
    }
  };

  const render = () => {
    if (!active) return;
    const frame = c("magenta", frames[index % frames.length]);
    const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    const dotCount = (Math.floor(index / 4) % 4) + 1;
    const dots = c("green", ".".repeat(dotCount).padEnd(4, " "));
    const line = `${frame} ${c("bold", label)} ${dots} ${c("dim", `${elapsed}s`)}`;
    const padding = lastLength > line.length ? " ".repeat(lastLength - line.length) : "";
    write(`\r${line}${padding}`);
    lastLength = line.length;
    index += 1;
  };

  render();
  const interval = setInterval(render, 90);

  return () => {
    if (!active) return;
    active = false;
    clearInterval(interval);
    write(`\r${" ".repeat(lastLength)}\r`);
  };
}

function formatDiscoveredPeerSummary(peer, ratingSummary = { average: null, count: 0 }) {
  const models = peer.models || [];
  const rating = ratingSummary.average == null
    ? `${c("dim", "unrated")}`
    : `${renderSummaryStars(ratingSummary.average)} ${Number(ratingSummary.average).toFixed(2)}/5 ${c("dim", `(${ratingSummary.count} ${ratingSummary.count === 1 ? "rating" : "ratings"})`)}`;
  const lines = [
    `${c("magenta", "◆")} ${c("bold", peer.peerName ?? "anonymous")} ${c("dim", `(${peer.peerId?.slice(0, 12) ?? "unknown"})`)}`,
    `  ${label("ledger")}   ${peer.ledgerAccountId ?? "none"}`,
    `  ${label("rating")}   ${rating}`,
    `  ${label("provider")} ${peer.qvacProviderPublicKey ? c("green", "yes") : c("dim", "no")}`,
    `  ${label("models")}   `,
  ];

  if (models.length === 0) {
    lines.push(`    ${c("dim", "none")}`);
  } else {
    for (const model of models) {
      lines.push(`    ${c("magenta", "•")} ${c("bold", model.key ?? model.id ?? "unknown")}`);
      lines.push(`      ${label("tier")}  ${model.tier ?? "unknown"}`);
      lines.push(`      ${label("price")} ${formatSummaryCreditEstimate(model)}`);
    }
  }

  return lines.join("\n");
}

function renderSummaryStars(value) {
  const rounded = Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
  return `${c("yellow", "★".repeat(rounded))}${c("dim", "☆".repeat(5 - rounded))}`;
}

function formatSummaryCreditEstimate(model) {
  if (model.priceCredits != null) return `${model.priceCredits} credits`;
  if (model.estimatedCredits != null) return `${model.estimatedCredits} credits`;
  if (model.minCredits != null && model.maxCredits != null) {
    return `${model.minCredits}-${model.maxCredits} credits`;
  }
  return "unknown price";
}

function label(text) {
  return c("cyan", text);
}

function c(name, text) {
  const ansi = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    magenta: "\x1b[35m",
  };
  return `${ansi[name] || ""}${text}${ansi.reset}`;
}

async function runCleanupStep(label, step, errors) {
  try {
    await step();
  } catch (err) {
    errors.push({ label, message: err?.message ?? String(err) });
  }
}
