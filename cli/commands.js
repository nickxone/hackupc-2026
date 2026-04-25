import {
  renderAskPlan,
  renderCommandResult,
  renderDaemonPlan,
  renderPeers,
  renderUsage,
} from "./render.js";

const DEFAULT_PEER_SCAN_MS = 3_000;
const ASK_STRATEGIES = new Set(["cheapest", "best", "fastest", "rated"]);

const commandDefinitions = [
  {
    name: "daemon",
    usage: "daemon [--host addr] [--port n]",
    description: "Show the local Ollama-compatible API contract.",
    run(args) {
      const options = parseDaemonArgs(args);
      return renderDaemonPlan({ options });
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

  return {
    output: await command.run(args),
    exitCode: 0,
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
