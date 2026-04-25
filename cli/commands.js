import {
  renderAskPlan,
  renderCommandResult,
  renderDaemonStarted,
  renderPeers,
  renderUsage,
} from "./render.js";
import { startComputeExchangeApi } from "../src/server/compute-exchange-api.js";
import { Discovery } from "../src/core/discovery.js";
import { Ledger } from "../src/core/ledger.js";
import { loadDelegatedModel, runCompletion, unload } from "../src/core/qvac.js";
import { config, getModel } from "../src/config.js";
import os from "bare-os";
const { hostname } = os;

const DEFAULT_PEER_SCAN_MS = 3_000;
const ASK_STRATEGIES = new Set(["cheapest", "best", "fastest", "rated"]);

const commandDefinitions = [
  {
    name: "daemon",
    usage: "daemon [--host addr] [--port n]",
    description: "Start the local Compute Exchange API.",
    async run(args) {
      const options = parseDaemonArgs(args);
      
      const peerName = (globalThis.process?.env?.PEER_NAME) || hostname();
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

      await discovery.start();

      const api = await startComputeExchangeApi({
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

            const event = await ledger.spend({
              to: provider.peerName, tokens, credits, model: model.key
            });

            await discovery.sendCreditAck({
              to: provider.peerId, tokens, credits, model: model.key, txId: event.txId, fromName: peerName
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
    usage: "serve",
    description: "Show the provider mode contract.",
    run() {
      return renderCommandResult({
        title: "Serve",
        status: "pending",
        summary: "Provider mode CLI shell is ready, but not connected yet.",
        bullets: [
          "Start the local QVAC provider.",
          "Advertise served models over discovery.",
          "Replicate credit and rating state through Autobase.",
          "Keep running until interrupted.",
        ],
        next: [
          "Wire to `src/core/qvac.js` for provider startup.",
          "Wire to `src/core/discovery.js` for peer announcements.",
          "Wire to future Autobase credit and rating modules.",
        ],
      });
    },
  },
  {
    name: "ask",
    usage: "ask [options] <prompt>",
    description: "Show the prompt request contract.",
    run(args) {
      const { options, prompt } = parseAskArgs(args);
      return renderAskPlan({ prompt, options });
    },
  },
  {
    name: "peers",
    usage: "peers [--wait ms]",
    description: "Show the peer listing contract.",
    run(args) {
      const waitMs = parseWaitMs(args);
      return renderPeers({
        peers: [],
        peerId: null,
        waitMs,
        planned: true,
      });
    },
  },
  {
    name: "balance",
    usage: "balance",
    description: "Show the balance contract.",
    run() {
      return renderCommandResult({
        title: "Balance",
        status: "pending",
        summary: "Balance command contract is defined, but storage is not wired.",
        bullets: [
          "Show current credit balance.",
          "Show recent earn and spend events.",
          "Show pending or unreplicated receipts.",
        ],
        next: [
          "Read local JSON ledger during development.",
          "Switch to Autobase-derived balances for shared state.",
        ],
      });
    },
  },
  {
    name: "rate",
    usage: "rate <provider-id> <1-5>",
    description: "Show the provider rating contract.",
    run(args) {
      const [providerId, scoreRaw] = args;
      const score = Number(scoreRaw);
      const validScore = Number.isInteger(score) && score >= 1 && score <= 5;

      return renderCommandResult({
        title: "Rate",
        status: providerId && validScore ? "pending" : "blocked",
        summary:
          providerId && validScore
            ? `Rating captured: ${providerId} -> ${score}/5`
            : "Usage requires a provider id and an integer score from 1 to 5.",
        bullets: [
          "Validate the provider id.",
          "Attach rating to a completed request when available.",
          "Write a signed rating event.",
          "Update provider reputation from replicated events.",
        ],
        next: [
          "Wire validation to discovery or Autobase provider records.",
          "Persist rating event through Autobase.",
        ],
      });
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

function parseWaitMs(args) {
  const index = args.indexOf("--wait");
  if (index === -1) return DEFAULT_PEER_SCAN_MS;

  const waitMs = Number(args[index + 1]);
  if (!Number.isInteger(waitMs) || waitMs < 0) {
    throw new Error("`peers --wait` expects a non-negative integer in milliseconds");
  }
  return waitMs;
}

function parseAskArgs(args) {
  const options = {
    peer: null,
    model: null,
    maxCredits: null,
    strategy: "cheapest",
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
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown ask option: ${arg}`);
    } else {
      rest.push(arg);
    }
  }

  return { options, prompt: rest.join(" ").trim() };
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
