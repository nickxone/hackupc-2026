const statusLabels = {
  ready: "ready",
  pending: "pending",
  blocked: "blocked",
};

export function renderTitle(text) {
  return `\n${text}\n${"=".repeat(text.length)}`;
}

export function renderUsage({ commands }) {
  const lines = [
    renderTitle("Compute Exchange CLI"),
    "",
    "Usage:",
    "  pear run . <command> [args]",
    "  npm run cli -- <command> [args]",
    "",
    "Commands:",
  ];

  for (const command of commands) {
    const usage = command.usage.padEnd(28, " ");
    lines.push(`  ${usage} ${command.description}`);
  }

  lines.push("", "Examples:");
  lines.push("  pear run . daemon");
  lines.push("  pear run . serve");
  lines.push('  pear run . ask --max-credits 20 "Explain vector databases"');
  lines.push(
    '  pear run . ask --peer <peer-id> --max-credits 20 "Explain vector databases"',
  );
  lines.push("  pear run . peers");
  lines.push("  pear run . balance");
  lines.push("  pear run . rate <provider-id> 5");

  return lines.join("\n");
}

export function renderDaemonStarted({ url, peerScanMs }) {
  return [
    renderTitle("Daemon"),
    "",
    "Status: ready",
    "",
    `Local API: ${url}`,
    `Peer scan window: ${peerScanMs}ms`,
    "",
    "Compatibility routes:",
    "- GET  /api/version",
    "- GET  /api/tags",
    "- POST /api/generate",
    "- POST /api/chat",
    "",
    "Compute Exchange routes:",
    "- GET  /api/peers",
    "- GET  /api/balance",
    "- POST /api/rate",
    "",
    "Generation, discovery, credits, and ratings currently return placeholder responses.",
    "Press Ctrl+C to stop.",
  ].join("\n");
}

export function renderCommandResult({
  title,
  status = "pending",
  summary,
  bullets = [],
  next = [],
}) {
  const lines = [
    renderTitle(title),
    "",
    `Status: ${statusLabels[status] ?? status}`,
  ];

  if (summary) {
    lines.push("", summary);
  }

  if (bullets.length > 0) {
    lines.push("", "Planned behavior:");
    for (const bullet of bullets) lines.push(`- ${bullet}`);
  }

  if (next.length > 0) {
    lines.push("", "Next integration points:");
    for (const item of next) lines.push(`- ${item}`);
  }

  return lines.join("\n");
}

export function renderPeers({ peers, peerId, waitMs, planned = false }) {
  const lines = [
    renderTitle("Peers"),
    "",
    `Status: ${planned ? "pending" : "ready"}`,
    `Discovery peer: ${shortId(peerId)}`,
    `Scan window: ${waitMs}ms`,
    "",
  ];

  if (planned) {
    lines.push("Peer listing contract is defined, but discovery is not wired here.");
    lines.push("");
    lines.push("Planned output fields:");
    lines.push("- peer id and display name");
    lines.push("- QVAC provider public key");
    lines.push("- advertised models and tiers");
    lines.push("- estimated credit cost");
    lines.push("- rating and last-seen time");
    return lines.join("\n");
  }

  if (peers.length === 0) {
    lines.push("No peers found.");
    lines.push("");
    lines.push("Start a discovery peer with `npm run peer` in another terminal.");
    return lines.join("\n");
  }

  lines.push(`Found ${peers.length} peer${peers.length === 1 ? "" : "s"}:`);

  for (const peer of peers) {
    const providerKey = peer.qvacProviderPublicKey
      ? shortId(peer.qvacProviderPublicKey)
      : "none";
    const rating = peer.rating ?? "unrated";

    lines.push("");
    lines.push(`- ${peer.peerName ?? "anonymous"} (${shortId(peer.peerId)})`);
    lines.push(`  qvac provider: ${providerKey}`);
    lines.push(`  rating: ${rating}`);
    lines.push("  models:");

    if (peer.models?.length) {
      for (const model of peer.models) {
        lines.push(
          `    - ${model.id} tier=${model.tier} est=${formatCreditEstimate(model)}`,
        );
      }
    } else {
      lines.push("    - none");
    }

    lines.push(`  last seen: ${formatTime(peer.lastSeenAt)}`);
  }

  return lines.join("\n");
}

export function renderAskPlan({ prompt, options }) {
  const selection = options.peer
    ? `manual peer ${options.peer}`
    : `${options.strategy} eligible peer`;
  const budget = options.maxCredits == null
    ? "none"
    : `${options.maxCredits} credits`;

  return renderCommandResult({
    title: "Ask",
    status: prompt ? "pending" : "blocked",
    summary: prompt
      ? `Prompt captured: "${prompt}"`
      : "Missing prompt. Pass text after `ask`.",
    bullets: [
      `Selection: ${selection}`,
      `Budget limit: ${budget}`,
      `Model filter: ${options.model ?? "any advertised model"}`,
      "Find a provider matching the selection and budget.",
      "Delegate the prompt through QVAC.",
      "Stream the model response to the terminal.",
      "Write a signed credit receipt after completion.",
    ],
    next: [
      "Use discovery peer data to filter by `--peer`, `--model`, and `--max-credits`.",
      "Estimate final cost before dispatching the request.",
      "Wire inference to `loadDelegatedModel` and `runCompletion`.",
      "Persist credit receipt through Autobase.",
    ],
  });
}

export function renderError(message) {
  return [
    renderTitle("Command Error"),
    "",
    message,
    "",
    "Run `pear run . help` for available commands.",
  ].join("\n");
}

function shortId(value) {
  if (!value) return "unknown";
  return value.length <= 12 ? value : `${value.slice(0, 12)}...`;
}

function formatTime(ts) {
  if (!ts) return "unknown";
  return new Date(ts).toISOString();
}

function formatCreditEstimate(model) {
  if (model.estimatedCredits != null) return `${model.estimatedCredits} credits`;
  if (model.minCredits != null && model.maxCredits != null) {
    return `${model.minCredits}-${model.maxCredits} credits`;
  }
  if (model.tier != null) return `tier ${model.tier} pricing`;
  return "unknown";
}
