const statusLabels = {
  ready: "ready",
  pending: "pending",
  blocked: "blocked",
};

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

export function renderTitle(text) {
  return `\n${color("cyan", text)}\n${color("dim", "─".repeat(text.length))}`;
}

export function renderUsage({ commands }) {
  const byName = new Map(commands.map((command) => [command.name, command]));
  const common = ["daemon", "serve", "peers", "balance", "rate", "ratings", "ask"]
    .map((name) => byName.get(name))
    .filter(Boolean);

  const lines = [
    renderBrandHeader(),
    "",
    color("bold", "Run LLeMur with:"),
    "  pear run . <command> [args]",
    "  npm run cli -- <command> [args]",
    "",
    color("bold", "Typical flow:"),
    "  1. Start a provider with `pear run . serve`",
    "  2. Start a local daemon with `pear run . daemon` or `pear run scripts/server.js`",
    "  3. Inspect peers with `pear run . peers`",
    "  4. Send requests or rate the last provider you paid with `pear run . rate 5`",
    "",
    color("bold", "Common commands:"),
  ];

  for (const command of common) {
    const usage = command.usage.padEnd(42, " ");
    lines.push(`  ${usage} ${command.description}`);
  }

  lines.push("", color("bold", "Examples:"));
  lines.push("  pear run . daemon");
  lines.push("  pear run . serve");
  lines.push("  pear run . peers");
  lines.push("  pear run . balance");
  lines.push('  pear run . ask --max-credits 20 "Explain vector databases"');
  lines.push(
    '  pear run . ask --peer <peer-id> --max-credits 20 "Explain vector databases"',
  );
  lines.push("  pear run . rate 5");
  lines.push("  pear run . rate <ledger-account-id> 5");
  lines.push("  pear run . ratings");
  lines.push("  pear run . ratings <ledger-account-id>");

  lines.push("", color("bold", "Notes:"));
  lines.push("  - `rate 5` rates the last peer you successfully paid.");
  lines.push("  - `peers` shows each peer's ledger account id and average rating.");
  lines.push("  - Use `pear run scripts/server.js` if Pear app locking gets in the way of `daemon`.");

  const remaining = commands.filter((command) => !common.includes(command));
  if (remaining.length > 0) {
    lines.push("", color("bold", "Other commands:"));
    for (const command of remaining) {
      const usage = command.usage.padEnd(42, " ");
      lines.push(`  ${usage} ${command.description}`);
    }
  }

  return lines.join("\n");
}

export function renderDaemonStarted({ url, peerScanMs, peerName, peerId, ledgerAccountId }) {
  return [
    renderBrandHeader(),
    "",
    `${statusPill("ready")} ${color("bold", "daemon online")}`,
    "",
    `${color("cyan", "Peer")}       ${peerName ?? "unknown"} ${color("dim", `(${peerId ?? "unknown"})`)}`,
    `${color("cyan", "Ledger")}     ${ledgerAccountId ?? "unknown"}`,
    `${color("cyan", "Local API")}  ${url}`,
    `${color("cyan", "Peer scan")}  ${peerScanMs}ms`,
    "",
    `${color("green", "Ready for")} chat, peers, balance, and ratings`,
    `${color("yellow", "Tip")} start a provider with \`pear run . serve\``,
    color("dim", "Press Ctrl+C to stop."),
  ].join("\n");
}

export function renderProviderStarted({
  peerName,
  peerId,
  ledgerAccountId,
  publicKey,
  topic,
  servedModels,
}) {
  const lines = [
    renderBrandHeader(),
    "",
    `${statusPill("ready")} ${color("bold", "provider online")}`,
    `${color("cyan", "Peer")}        ${color("bold", peerName)} ${color("dim", `(${peerId})`)}`,
    `${color("cyan", "Ledger")}      ${ledgerAccountId ?? "unknown"}`,
    `${color("cyan", "QVAC topic")}  ${topic}`,
    `${color("cyan", "Public key")}  ${publicKey}`,
    "",
    `${color("green", "Serving")} ${servedModels.length} model${servedModels.length === 1 ? "" : "s"}`,
    "",
    color("bold", "Models:"),
  ];

  for (const model of servedModels) {
    lines.push(`  ${color("magenta", "◆")} ${color("bold", model.key)} ${color("dim", `tier ${model.tier}`)}`);
    lines.push(`    ${color("cyan", "price")} ${formatCreditEstimate(model)}`);
    lines.push(`    ${color("cyan", "id")}    ${model.id}`);
  }

  lines.push("", color("dim", "Provider ready. Press Ctrl+C to stop."));
  return lines.join("\n");
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
  const sortedPeers = [...peers].sort((a, b) => {
    const ratingDiff = (b.rating ?? -1) - (a.rating ?? -1);
    if (ratingDiff !== 0) return ratingDiff;
    return (a.peerName ?? "").localeCompare(b.peerName ?? "");
  });

  const lines = [
    renderTitle("Peers"),
    "",
    `${statusPill(planned ? "pending" : "ready")} ${planned ? "waiting" : "live"}`,
    `${color("cyan", "Discovery peer")}  ${peerId}`,
    `${color("cyan", "Scan window")}     ${waitMs}ms`,
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

  if (sortedPeers.length === 0) {
    lines.push("No peers found.");
    lines.push("");
    lines.push("Start a discovery peer with `npm run peer` in another terminal.");
    return lines.join("\n");
  }

  lines.push(`${color("bold", `Found ${sortedPeers.length} peer${sortedPeers.length === 1 ? "" : "s"}:`)}`);

  for (const peer of sortedPeers) {
    const providerKey = peer.qvacProviderPublicKey
      ? peer.qvacProviderPublicKey
      : "none";
    const rating = formatPeerRating(peer);

    lines.push("");
    lines.push(`${color("magenta", "◆")} ${color("bold", peer.peerName ?? "anonymous")} ${color("dim", `(${peer.peerId})`)}`);
    lines.push(`  ${color("cyan", "ledger")}   ${peer.ledgerAccountId ?? "none"}`);
    lines.push(`  ${color("cyan", "provider")} ${providerKey}`);
    lines.push(`  ${color("cyan", "rating")}   ${rating}`);
    lines.push(`  ${color("cyan", "models")}   `);

    if (peer.models?.length) {
      for (const model of peer.models) {
        lines.push(`    ${color("magenta", "•")} ${color("bold", model.key ?? model.id ?? "unknown")}`);
        lines.push(`      ${color("cyan", "tier")}  ${model.tier ?? "unknown"}`);
        lines.push(`      ${color("cyan", "price")} ${formatCreditEstimate(model)}`);
        lines.push(`      ${color("cyan", "id")}    ${model.id ?? "unknown"}`);
      }
    } else {
      lines.push("    - none");
    }

    lines.push(`  ${color("cyan", "seen")}     ${formatTime(peer.lastSeenAt)}`);
  }

  return lines.join("\n");
}

function formatPeerRating(peer) {
  if (peer.rating == null) return "unrated";
  const count = Number.isInteger(peer.ratingCount) ? peer.ratingCount : 0;
  const countLabel = count === 1 ? "rating" : "ratings";
  return `${renderStars(peer.rating)} ${Number(peer.rating).toFixed(2)}/5 ${color("dim", `(${count} ${countLabel})`)}`;
}

export function renderBalance({ balance, log = [] }) {
  const lines = [
    renderTitle("Balance"),
    "",
    `${statusPill("ready")} wallet`,
    `${color("cyan", "Credits")}  ${balance ?? "unknown"}`,
    "",
  ];

  if (log.length === 0) {
    lines.push("No ledger events yet.");
    return lines.join("\n");
  }

  lines.push(color("bold", "Recent events:"));
  for (const event of log.slice(-10).reverse()) {
    const type = event.type ?? "event";
    const credits = event.credits == null ? "unknown credits" : `${event.credits} credits`;
    const model = event.model ? ` model=${event.model}` : "";
    const peer = event.to ?? event.from ?? event.provider ?? "";
    const peerPart = peer ? ` peer=${peer}` : "";
    lines.push(`- ${formatTime(event.at ?? event.createdAt ?? event.time)} ${type}: ${credits}${model}${peerPart}`);
  }

  return lines.join("\n");
}

export function renderRateResult({
  accepted,
  provider,
  score,
  average,
  count,
  error,
  p2p,
  inferredFromLastPayment,
}) {
  const lines = [
    renderTitle("Rate"),
    "",
    `${statusPill(accepted ? "ready" : "blocked")} rating`,
    `${color("cyan", "Provider")}  ${provider ?? "unknown"}`,
    `${color("cyan", "Score")}     ${score != null ? `${renderStars(score)} ${score}/5` : "unknown"}`,
  ];

  if (average != null) lines.push(`${color("cyan", "Average")}   ${renderStars(average)} ${average}/5`);
  if (count != null) lines.push(`${color("cyan", "Count")}     ${count}`);
  if (accepted && inferredFromLastPayment) lines.push(`${color("yellow", "Target")}    last outgoing payment`);

  lines.push("", error ?? p2p?.message ?? "Rating submitted.");
  return lines.join("\n");
}

export function renderRatingsResult({ target, average, count, ratings = [], averages = [] }) {
  const lines = [
    renderTitle("Ratings"),
    "",
    `${statusPill("ready")} ratings`,
  ];

  if (target) {
    lines.push(`${color("cyan", "Target")}   ${target}`);
    lines.push(`${color("cyan", "Average")}  ${average == null ? "unrated" : `${renderStars(average)} ${average}/5`}`);
    lines.push(`${color("cyan", "Count")}    ${count ?? 0}`);
    lines.push("");
    if (ratings.length === 0) {
      lines.push("No ratings yet.");
      return lines.join("\n");
    }

    lines.push(color("bold", "Ratings:"));
    for (const rating of ratings) {
      lines.push(
        `- ${renderStars(rating.score)} ${rating.score}/5 by ${rating.reviewerName} at ${formatTime(rating.createdAt)}`,
      );
    }
    return lines.join("\n");
  }

  if (averages.length === 0) {
    lines.push("", "No ratings yet.");
    return lines.join("\n");
  }

  lines.push("", color("bold", "Average ratings:"));
  for (const row of averages) {
    lines.push(`- ${row.target}: ${renderStars(row.average)} ${row.average}/5 ${color("dim", `(${row.count})`)}`);
  }
  return lines.join("\n");
}

export function renderAskResult({ prompt, model, content, provider, error }) {
  const lines = [
    `${renderAskHeader({ model, status: error ? "blocked" : "ready" })}${
      error ? error : content || "(empty response)"
    }`,
  ];

  const details = renderAskDetails({ prompt, provider });
  if (details) lines.push(details);

  return lines.join("\n");
}

export function renderAskHeader({ model, status = "ready" }) {
  return `${[
    renderTitle("Ask"),
    "",
    `Status: ${statusLabels[status] ?? status}`,
    `Model: ${model ?? "default"}`,
  ].join("\n")}\n\n`;
}

export function renderAskDetails({ prompt, provider }) {
  const lines = [];

  if (provider) {
    lines.push("", "Provider:");
    lines.push(`  ${color("cyan", "machine")}   ${provider.peerName ?? "unknown"}`);
    lines.push(`  ${color("cyan", "peer id")}   ${provider.peerId ?? "unknown"}`);
    lines.push(`  ${color("cyan", "qvac key")}  ${provider.qvacProviderPublicKey ?? "unknown"}`);
    lines.push(`  ${color("cyan", "qvac topic")} ${provider.qvacTopic ?? "unknown"}`);
    if (provider.rating != null) lines.push(`  ${color("cyan", "rating")}    ${renderStars(provider.rating)} ${provider.rating}/5`);
    if (provider.lastSeenAt) lines.push(`  ${color("cyan", "last seen")} ${formatTime(provider.lastSeenAt)}`);

    const models = provider.models ?? [];
    if (models.length > 0) {
      lines.push(`  models: ${models.map(formatProviderModel).join(", ")}`);
    }
  }

  if (prompt) {
    lines.push("", `Prompt: ${prompt}\n`);
  }

  return lines.join("\n");
}

function formatProviderModel(model) {
  const name = model.key ?? model.id ?? "unknown";
  const tier = model.tier == null ? "tier ?" : `tier ${model.tier}`;
  return `${name} (${tier}, ${formatCreditEstimate(model)})`;
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
    renderTitle(color("red", "Command Error")),
    "",
    message,
    "",
    "Run `pear run . help` for available commands.",
  ].join("\n");
}

function renderBrandHeader() {
  const lemur = [
    "                 ,,",
    "                ==",
    "               ==",
    "              ==",
    "             ==",
    "             ==",
    "    ,  ,     ==",
    "    |\\/|   ,-..-,",
    "  ./(_  \\_/      \\",
    "      \\           |",
    "      | \\_,' /^| /",
    "      ( //  /  \\ \\",
    "      || \\ <    \\ )",
    "     _\\|  \\ )   _\\\\",
    "      ~'  _\\|    '~",
    "           '~",
  ].map((line) => color("green", line));

  const title = [
    "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
    "~   _         _                   __  __                      ~",
    "~  FJ        FJ         ____     F  \\/  ]    _    _    _ ___  ~",
    "~ J |       J |        F __ J   J |\\__/| L  J |  | L  J '__ \",~",
    "~ | |       | |       | _____J  | |`--'| |  | |  | |  | |__|-J~",
    "~ F L_____  F L_____  F L___--. F L    J J  F L__J J  F L  `-'~",
    "~J________LJ________LJ\\______/FJ__L    J__LJ\\____,__LJ__L     ~",
    "~|________||________| J______F |__L    J__| J____,__F|__L     ~",
    "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
  ].map((line) => color("green", line));

  const gap = "   ";
  const rows = Math.max(lemur.length, title.length);
  const leftWidth = Math.max(...lemur.map((line) => stripAnsi(line).length));
  const lines = [];

  for (let i = 0; i < rows; i++) {
    const left = lemur[i] ?? "";
    const right = title[i] ?? "";
    const padding = " ".repeat(Math.max(0, leftWidth - stripAnsi(left).length));
    lines.push(`${left}${padding}${gap}${right}`);
  }

  lines.push(color("dim", "peer-to-peer compute market"));
  return lines.join("\n");
}

function statusPill(status) {
  if (status === "ready") return color("green", "[ready]");
  if (status === "blocked") return color("red", "[blocked]");
  return color("yellow", "[pending]");
}

function renderStars(value) {
  const rounded = Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
  const filled = "★".repeat(rounded);
  const empty = "☆".repeat(5 - rounded);
  return `${color("yellow", filled)}${color("dim", empty)}`;
}

function color(name, text) {
  return `${ansi[name] || ""}${text}${ansi.reset}`;
}

function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, "");
}

function formatTime(ts) {
  if (!ts) return "unknown";
  return new Date(ts).toISOString();
}

function formatCreditEstimate(model) {
  if (model.priceCredits != null) return `${model.priceCredits} credits`;
  if (model.estimatedCredits != null) return `${model.estimatedCredits} credits`;
  if (model.minCredits != null && model.maxCredits != null) {
    return `${model.minCredits}-${model.maxCredits} credits`;
  }
  return "unknown price";
}
