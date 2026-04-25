# Compute Exchange

P2P LLM compute exchange prototype for HackUPC 2026.

- Peers can serve QVAC delegated inference.
- Other peers can discover providers and run prompts against them.
- Credits are tracked locally in JSON ledgers.
- Discovery and payment acknowledgements use a small Hyperswarm side channel.

## Quick Start

- Install dependencies:
  - `npm install`
- Install/bootstrap Pear if `pear` is not on your `PATH`:
  - `npm install -g pear`
  - `pear`
- Run the Pear CLI shell:
  - `pear run . help`
- Show the local Ollama-compatible API contract:
  - `pear run . daemon`
- List providers with selection info:
  - `pear run . peers --wait 5000`
- Ask with an automatic budget-aware provider pick:
  - `pear run . ask --max-credits 20 "Explain vector databases"`
- Ask a specific peer within a budget:
  - `pear run . ask --peer <peer-id> --max-credits 20 "Explain vector databases"`
- Run the same CLI through Node during development:
  - `npm run cli -- help`
- Run a local model smoke test:
  - `npm run local`
- Run a provider:
  - `npm run provider`
- Run a manual consumer with the provider key printed by the provider:
  - `node scripts/consumer.js <provider-public-key> "Your prompt"`
- Run auto-discovery consumer:
  - `npm run auto-consumer -- "Your prompt"`
- Run discovery-only peer test:
  - `npm run discovery`
- Run delegated two-process smoke test:
  - `npm run delegated`

## Repository Map

- `src/config.js`
  - Central runtime configuration.
  - Creates stable 64-char hex topics from names using SHA-256.
  - Defines the default QVAC model, model tier, ledger pricing, and request timeout.

- `src/core/qvac.js`
  - Thin wrapper around `@qvac/sdk`.
  - Starts and stops QVAC providers.
  - Loads local or delegated models.
  - Runs streamed completions.
  - Unloads models and shuts down the SDK.

- `src/core/discovery.js`
  - Hyperswarm side-channel for peer discovery.
  - Joins the shared discovery topic as both client and server.
  - Sends `announce` messages on connect and every 10 seconds.
  - Tracks connected peers and their advertised models.
  - Sends and receives `creditAck` messages for local ledger updates.

- `src/core/ledger.js`
  - Local JSON-backed credit ledger.
  - Creates a starting balance if no ledger exists.
  - Records `earn` and `spend` log entries.
  - Calculates credit price from token count and model tier.

- `cli/index.js`
  - Pear terminal entrypoint.
  - Parses CLI arguments and dispatches commands.
  - Supports both Node-style `process.argv` and Pear/Bare-style `Bare.argv`.

- `cli/commands.js`
  - Defines `serve`, `ask`, `peers`, `balance`, and `rate`.
  - Keeps command behavior separate from terminal rendering.
  - Defines the `daemon` contract for an Ollama-compatible local API.
  - Defines the `peers` contract for provider selection output.
  - Parses `ask` filters for peer, model, budget, and provider strategy.
  - Keeps placeholders for unfinished daemon, provider, prompt, balance, and rating flows.

- `cli/render.js`
  - Shared terminal output formatting.
  - Renders usage, peer selection info, command status, planned behavior, and command errors.

- `scripts/local-test.js`
  - Loads the default model locally.
  - Runs one prompt.
  - Streams tokens to stdout.
  - Prints QVAC completion stats.

- `scripts/provider.js`
  - Starts a QVAC provider on the configured topic.
  - Starts discovery and advertises the served model.
  - Prints the provider public key for manual consumers.
  - Listens for `creditAck` messages and adds earned credits.

- `scripts/consumer.js`
  - Connects to a known provider public key.
  - Loads the default model through QVAC delegation.
  - Runs one prompt and streams the response.
  - Does not use discovery or update credits.

- `scripts/auto-consumer.js`
  - Starts discovery as a non-provider peer.
  - Waits for a provider advertising the default model.
  - Runs a delegated prompt against that provider.
  - Spends credits in the local ledger.
  - Sends `creditAck` back to the provider.

- `scripts/discovery-peer.js`
  - Minimal discovery-only peer.
  - Advertises the default model without starting QVAC provider service.
  - Logs peers seen and peers leaving.
  - Useful for checking Hyperswarm discovery behavior.

- `scripts/discovery-test.js`
  - Spawns two `discovery-peer.js` processes.
  - Waits for each peer to see the other.
  - Exits with pass/fail result.

- `scripts/delegated-test.js`
  - Spawns `provider.js`.
  - Parses `PROVIDER_PUBLIC_KEY` from provider stdout.
  - Runs `consumer.js` against that provider in a separate process.
  - Verifies the delegated inference path.

- `plan.md`
  - Full project plan and demo story.
  - Includes architecture notes, milestones, cut lines, risks, and stretch ideas.

- `CLAUDE.md`
  - Developer guidance for future coding agents.
  - Includes useful operational notes and known QVAC pitfalls.

- `errors.md`
  - Captured provider and consumer logs.
  - Useful for comparing QVAC startup, connection, and shutdown behavior.

- `.gitignore`
  - Ignores editor files, Node artifacts, QVAC/Hyperswarm state, and local ledger data.

## Runtime Flow

- Provider flow:
  - Load local ledger from `data/<peerName>.ledger.json`.
  - Start QVAC provider on `config.qvacTopic`.
  - Start discovery on `config.discoveryTopic`.
  - Announce peer name, model list, QVAC topic, and provider public key.
  - Receive `creditAck` messages and add earned credits.

- Manual consumer flow:
  - Receive provider public key from command line.
  - Load model through `loadDelegatedModel`.
  - Stream completion output.
  - Print QVAC stats.

- Auto consumer flow:
  - Load local ledger.
  - Join discovery topic.
  - Pick a peer advertising the default model and QVAC public key.
  - Run delegated inference.
  - Estimate tokens from QVAC stats or streamed token count.
  - Spend credits locally.
  - Send `creditAck` to the provider.

## Discovery Protocol

- Frames are newline-delimited JSON.
- `announce`
  - Sent on connection and periodically.
  - Contains peer display name, advertised models, QVAC topic, and QVAC provider public key.
- `creditAck`
  - Sent by consumers after a delegated completion.
  - Contains target peer id, token count, credit amount, and model id.
  - Only processed by the addressed provider.

## Credit Model

- Ledger state is local only.
- Default starting balance: `100`.
- Price formula:
  - `ceil(tokens * pricePerTokenPerTier * tier)`
- Current default pricing:
  - `pricePerTokenPerTier = 0.1`
  - default model tier = `1`

## Important Notes

- Hyperswarm topics must be exactly 32 bytes.
  - Use topics from `src/config.js`.
  - Do not hand-write short hex topics.
- Provider and delegated consumer should run in separate Node processes.
  - `scripts/delegated-test.js` handles this by spawning the provider child process.
- Credits are trust-based.
  - The provider trusts `creditAck` messages from the consumer.
  - There is no shared ledger, signing, consensus, or fraud prevention yet.
- First local model load can download a large QVAC model cache.
- If `pear run . serve` prints `command not found`, Pear is not installed or not on `PATH`.
- If Node commands report WSL/runtime errors, install Linux Node inside WSL instead of using the Windows Node/npm shim.
