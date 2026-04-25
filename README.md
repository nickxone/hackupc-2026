# Compute Exchange

P2P LLM compute exchange prototype for HackUPC 2026.

Peers advertise QVAC-backed model capacity over Hyperswarm, consumers discover providers, and a local HTTP proxy exposes OpenAI/Ollama-compatible chat routes. Credits are tracked in local JSON ledgers and are intended to reconcile with trust-based `creditAck` messages on a discovery side channel.

## Quick Start

Install dependencies:

```bash
npm install
```

Install/bootstrap Pear if `pear` is not on your `PATH`:

```bash
npm install -D pear
pear run pear://runtime
```

Start a provider in one terminal:

```bash
PEER_NAME=alice pear run . serve
```

Start the HTTP proxy in another terminal:

```bash
PEER_NAME=bob pear run scripts/server.js
```

Send an OpenAI-compatible chat request:

```bash
curl -X POST http://127.0.0.1:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"llama-1b","messages":[{"role":"user","content":"Say hello in 5 words."}]}'
```

Or send an Ollama-compatible chat request:

```bash
curl -X POST http://127.0.0.1:11434/api/chat \
  -H "Content-Type: application/json" \
  -d '{"model":"llama-1b","messages":[{"role":"user","content":"Say hello in 5 words."}]}'
```

Useful CLI commands:

```bash
pear run . serve --models llama-1b
pear run . peers
pear run . balance
pear run . ask --model llama-1b "Explain P2P inference"
pear run . help
```

Smoke tests and scripts:

```bash
pear run scripts/local-test.js
pear run scripts/delegated-test.js
pear run scripts/discovery-test.js
pear run scripts/auto-consumer.js
pear run scripts/e2e-test.js
```

## Runtime Model

- `pear run . serve` starts QVAC provider mode, pre-downloads served models, joins the QVAC topic, joins discovery, advertises model keys/tiers, and earns credits from matching `creditAck` messages.
- `pear run scripts/server.js` starts the real local chat proxy on `127.0.0.1:11434`. It joins discovery as a consumer, chooses a provider for the requested model, delegates the request through QVAC, streams the response, spends credits locally, and attempts to send a `creditAck`.
- `pear run . daemon` starts the generic HTTP API shell, but does not currently wire delegated chat. Use `pear run scripts/server.js` for the working chat bridge.
- `pear run . ask` queries `/api/peers`, selects a matching provider, and delegates directly from the CLI. It streams output, but currently does not debit the ledger or send a credit acknowledgement.

## Repository Map

- `src/config.js` defines the QVAC/discovery topics, model catalog, default model, ledger config, and request timeout.
- `src/topics.js` derives 64-char hex topics from human-readable names with SHA-256.
- `src/ledger-config.js` contains the initial balance and per-token tier pricing.
- `src/core/qvac.js` is the only wrapper around `@qvac/sdk`.
- `src/core/discovery.js` implements the Hyperswarm JSON-lines discovery and `creditAck` channel.
- `src/core/ledger.js` persists local balances and earn/spend logs under `data/<peerName>.ledger.json`.
- `src/server/provider-runtime.js` owns provider startup, pre-download, discovery, ledger earn handling, and shutdown.
- `src/server/compute-exchange-api.js` owns the HTTP API routes and compatibility response shapes.
- `scripts/provider.js` starts provider mode.
- `scripts/server.js` starts the working HTTP proxy and delegated chat flow.
- `scripts/consumer.js` delegates to a known QVAC provider public key without discovery or credits.
- `scripts/auto-consumer.js` discovers a provider, runs one prompt, spends credits, and sends `creditAck`.
- `scripts/local-test.js`, `scripts/delegated-test.js`, `scripts/discovery-test.js`, and `scripts/e2e-test.js` are smoke tests.
- `cli/index.js`, `cli/commands.js`, and `cli/render.js` implement the Pear-native CLI.
- `qvac/worker.entry.mjs` and `qvac/addons.manifest.json` are generated QVAC worker assets required by Pear.

## Models

Configured models live in `src/config.js`:

- `llama-1b`: `LLAMA_3_2_1B_INST_Q4_0`, tier `1`
- `qwen-1.7b`: `QWEN3_1_7B_INST_Q4`, tier `3`

Providers serve all configured models by default. Limit the set with either:

```bash
MODELS=llama-1b pear run . serve
pear run . serve --models llama-1b,qwen-1.7b
```

## HTTP Routes

Implemented by `startComputeExchangeApi`:

- `GET /` returns API status.
- `GET /api/version` returns version metadata.
- `GET /api/peers` returns discovered peers when `onGetPeers` is wired.
- `GET /api/balance` returns local ledger state when `onGetBalance` is wired.
- `POST /api/chat` streams Ollama-style NDJSON when `onChat` is wired.
- `POST /v1/chat/completions` streams OpenAI-style SSE when `onChat` is wired.

Current placeholders:

- `GET /api/tags` returns an empty model list placeholder.
- `POST /api/generate` returns a not-implemented response.
- `POST /api/rate` returns `501`; provider ratings are not persisted.

## Discovery Protocol

Discovery frames are newline-delimited JSON over a separate Hyperswarm topic.

`announce` frames are sent on connection and every 10 seconds:

```json
{"t":"announce","peerName":"alice","models":[{"id":"LLAMA_3_2_1B_INST_Q4_0","key":"llama-1b","tier":1}],"qvacTopic":"<hex>","qvacProviderPublicKey":"<hex>"}
```

`creditAck` frames are sent by consumers after delegated completions:

```json
{"t":"creditAck","to":"<discovery-peer-id>","tokens":128,"credits":13,"model":"llama-1b"}
```

Only a peer whose discovery id matches `to` processes the acknowledgement.

## Credit Model

- Ledger files are local only.
- New ledgers start at `100` credits.
- Pricing is `ceil(tokens * pricePerTokenPerTier * tier)`.
- Current `pricePerTokenPerTier` is `0.1`.
- The working HTTP server currently computes credits as `ceil(tokens / 10) * tier`, which is equivalent to the current config.
- Credit acknowledgements are trust-based; there is no shared ledger, signing, consensus, or fraud prevention.
- `auto-consumer.js` sends `creditAck` to the provider discovery peer id. `scripts/server.js` currently passes the provider QVAC public key, so provider-side earning through the HTTP path should be audited before demoing ledger symmetry.

## Important Notes

- Run app entrypoints through Pear (`pear run . ...` or `pear run scripts/<entry>.js`). Scripts import Bare modules and generated QVAC worker assets.
- Hyperswarm topics must be exactly 32 bytes, represented as 64 hex chars. Use `src/topics.js` and `src/config.js`.
- Provider and consumer should run in separate processes. QVAC delegated provider and delegated consumer paths can deadlock when combined in one process.
- Every QVAC entrypoint must import `qvac/worker.entry.mjs` before SDK use. Re-run `npx qvac bundle sdk` after changing `qvac.config.json` or upgrading `@qvac/sdk`.
- First provider boot can download large model files into `~/.qvac/models/`.
- DHT discovery can take 10-30 seconds and may fail on restrictive WiFi. A hotspot or controlled network is useful for demos.
