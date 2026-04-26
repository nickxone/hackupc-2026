# Compute Exchange

Peer-to-peer LLM compute marketplace prototype for HackUPC 2026.

Providers expose QVAC-backed models over a shared topic, consumers discover them over Hyperswarm, and a local HTTP daemon offers Ollama-compatible and OpenAI-compatible chat endpoints. Payments and reputation are tracked with Hypercore/Autobase-backed ledger and ratings data, not a centralized server.

## What This Project Currently Does

- Starts a provider that serves one or more local QVAC models.
- Starts a local daemon on `127.0.0.1:11434`.
- Discovers peers over Hyperswarm.
- Delegates chat completions to a discovered provider.
- Creates signed transfer proposals and waits for signed acceptances before inference.
- Stores balances, transaction history, and ratings in local Hypercore-backed data directories.
- Exposes compatibility routes for tools that speak Ollama or OpenAI chat APIs.

## Main Entry Points

The current supported flows are:

- `pear run . serve` or `npm run provider`
  Starts provider mode, joins discovery, announces served models, accepts incoming ledger transfer proposals, and serves QVAC inference.
- `pear run . daemon` or `npm run server`
  Starts the local HTTP daemon with peer discovery, chat delegation, ledger access, and ratings APIs.
- `pear run . ask --model llama-1b "Hello"`
  Sends a prompt through the local daemon to a discovered provider.

## Quick Start

Install dependencies:

```bash
npm install
```

Install or bootstrap Pear if needed:

```bash
npm install -D pear
pear run pear://runtime
```

Start a provider in one terminal:

```bash
PEER_NAME=alice pear run . serve
```

Start the local daemon in another terminal:

```bash
PEER_NAME=bob pear run . daemon
```

Send an OpenAI-compatible request:

```bash
curl -X POST http://127.0.0.1:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-1b",
    "messages": [{"role": "user", "content": "Say hello in 5 words."}],
    "stream": false
  }'
```

Send an Ollama-compatible request:

```bash
curl -X POST http://127.0.0.1:11434/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-1b",
    "messages": [{"role": "user", "content": "Say hello in 5 words."}],
    "stream": false
  }'
```

List discovered peers:

```bash
pear run . peers
```

Check balances:

```bash
pear run . balance
```

Rate the last paid provider or a specific ledger account:

```bash
pear run . rate 5
pear run . rate <ledger-account-id> 5
```

## CLI Commands

Supported CLI commands in `pear run .`:

- `daemon`
- `serve`
- `ask`
- `peers`
- `balance`
- `rate`
- `ratings`
- `help`

Examples:

```bash
pear run . serve --models llama-1b,qwen-1.7b
pear run . daemon --port 11434
pear run . ask --model qwen-1.7b "Summarize peer-to-peer inference."
pear run . ratings
```

## HTTP API

The daemon exposes these routes:

- `GET /` health check
- `GET /api/version` daemon version info
- `GET /api/peers` discovered peers plus local peer id
- `GET /api/balance` wallet/accounts/history view
- `GET /api/ratings` ratings summary or ratings for one target
- `POST /api/rate` submit a 1-5 rating
- `GET /api/tags` placeholder Ollama tags route
- `GET /v1/models` OpenAI-style model list
- `POST /api/chat` Ollama-style chat
- `POST /v1/chat/completions` OpenAI-style chat

`/api/chat` streams NDJSON by default. `/v1/chat/completions` streams SSE by default.

## Models

Configured in `src/config.js`:

- `llama-1b`: `Llama 3.2 1B (Q4)`, tier `1`
- `qwen-1.7b`: `Qwen 3 1.7B (Q4)`, tier `3`

Providers serve all configured models by default. Limit them with:

```bash
MODELS=llama-1b pear run . serve
pear run . serve --models llama-1b
```

## Discovery, Payments, and Ratings

- Peer discovery happens over a dedicated Hyperswarm topic.
- Providers announce `peerName`, served models, `qvacTopic`, provider public key, and `ledgerAccountId`.
- Consumers create signed transfer proposals before inference.
- Providers sign transfer acceptances when the proposal targets their account.
- Ratings are separate signed events broadcast over discovery.
- Market defaults live in `config/market.json`.

Current default pricing from `config/market.json`:

- Initial credits: `100`
- Tier 1 price: `1`
- Tier 2 price: `5`
- Tier 3 price: `10`

## Data Layout

Runtime data is stored under `data/`:

- `data/<peerName>/ledger` for ledger state
- `data/<peerName>/ratings` for ratings state

Bootstrap keys for shared market state are configured in `config/market.json`.

## Project Map

- `cli/` Pear CLI commands and terminal rendering
- `src/server/provider-runtime.js` provider startup and ledger acceptance flow
- `src/server/chat-handler.js` delegated chat flow used by the daemon
- `src/server/compute-exchange-api.js` HTTP compatibility layer
- `src/core/qvac.js` QVAC wrapper utilities
- `src/core/discovery.js` Hyperswarm peer discovery and event transport
- `src/ledger/` Hypercore-backed ledger protocol and node logic
- `src/ratings/` ratings protocol and node logic
- `scripts/provider.js` standalone provider script
- `scripts/server.js` standalone daemon script
- `scripts/init-ledger.js` bootstrap ledger and ratings stores

## Notes and Caveats

- Run the app through Pear for the main flows. The QVAC entrypoints depend on Pear/Bare-compatible runtime behavior.
- First provider startup may download model assets into `~/.qvac/models/`.
- Discovery can take a few seconds depending on network conditions.
- `qvac/worker.entry.mjs` must be loaded before QVAC SDK usage.
- Some scripts in `scripts/` still reflect earlier prototype flows based on JSON ledgers and `creditAck`. Treat `serve`, `daemon`, the CLI, and the server/provider runtime under `src/server/` as the current implementation.
