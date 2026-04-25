# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

HackUPC 2026 entry: a serverless, peer-to-peer "compute exchange" where peers trade LLM inference time for local credits. A small machine earns credits serving a small model and spends them to run larger prompts on a beefier peer. `plan.md` is the full plan — demo story, milestones, cut lines, open questions. Read it before making scope decisions.

The product surface is a **Pear app that runs an OpenAI/Ollama-compatible HTTP proxy on `127.0.0.1:11434`**. External tools (curl, OpenWebUI, anything that speaks Ollama or OpenAI) talk to the local server as if it were Ollama; the server brokers each request to a peer over the swarm.

## Commands

All scripts run inside the Pear/Bare runtime via `pear run <file>`. Do **not** run them with `node` — they import `bare-*` modules and use Bare-only globals.

- `npm run provider` — start a QVAC provider. Pre-downloads served models, joins QVAC topic, advertises models on the discovery side-channel, prints `PROVIDER_PUBLIC_KEY=<hex>`. `MODELS=key1,key2` to filter (default = all in catalog), `PEER_NAME=alice` to override the swarm display name.
- `npm run server` — start the local HTTP proxy. Joins discovery as a non-provider, exposes `/api/chat`, `/v1/chat/completions`, `/api/peers`, `/api/balance`, `/api/version`. On a chat request, picks a peer that advertises the requested model, calls `loadModel({delegate})`, and streams tokens back in OpenAI SSE or Ollama NDJSON format.
- `npm run cli -- <subcommand>` — Pear-native CLI shell (alternative entry into the same daemon logic). `daemon` subcommand is a near-duplicate of `server.js`.
- `npm run local` — single-process local model load + completion. Validates QVAC + llama.cpp on this machine without networking.
- `npm run delegated` — two-process delegated smoke test. Spawns `provider.js` as a child, parses its public key, then spawns `consumer.js` against it.
- `npm run discovery` — discovery-only smoke test (no QVAC). Spawns two `discovery-peer.js` processes and asserts they see each other.
- `npm run e2e` — full credits-flow test (provider + auto-consumer + ledger symmetry assertion).

Demo flow:
```bash
# Terminal 1 — wait ~30s for "PROVIDER_PUBLIC_KEY=" + discovery to settle
PEER_NAME=alice npm run provider

# Terminal 2 — wait ~30s for "HTTP API Server listening"
PEER_NAME=bob npm run server

# Terminal 3
curl http://127.0.0.1:11434/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"llama-1b","messages":[{"role":"user","content":"Say hi"}]}'
```

First provider boot downloads each model (~773 MB for llama-1b, ~1.2 GB for qwen-1.7b) into `~/.qvac/models/`; subsequent boots are cache-hot.

## Architecture — how the layers fit

The project leans hard on **QVAC SDK (`@qvac/sdk`)**, which owns two things we would otherwise build ourselves: native LLM inference (llama.cpp) and the Hyperswarm delegated-inference wire. Concretely:

- **Provider side:** `startQVACProvider({topic})` joins a Hyperswarm topic, returns a public key, and thereafter handles incoming inference requests. There is **no per-request callback** on the provider.
- **Consumer side:** `loadModel({delegate: {topic, providerPublicKey}})` returns a `modelId` that acts like a local model; `completion({modelId})` returns a `tokenStream` that streams over Hyperswarm transparently.

Because QVAC has no per-request hook on the provider and no `listProviders(topic)` API, we layer three things on top:

1. **A discovery side-channel.** A separate Hyperswarm topic where peers announce their name, models (with tier), QVAC topic, and QVAC provider public key. Consumers also send `creditAck` messages back to providers after a completion. JSON-line framing over Hyperswarm duplex streams. Re-announces every 10s.
2. **A local credit ledger.** `src/core/ledger.js` persists a balance and a log to a local JSON file (`data/<peerName>.ledger.json`). Consumer subtracts on completion; provider trusts the incoming `creditAck` and adds. Pricing: `Math.ceil(tokens * 0.1 * tier)`. No gossip, no consensus — intentionally simplest-possible for the hackathon.
3. **An OpenAI/Ollama HTTP proxy.** `src/server/compute-exchange-api.js` (built on `bare-http1`) translates incoming HTTP chat requests into delegated QVAC calls, streams tokens back as OpenAI SSE or Ollama NDJSON, then debits the ledger and fires a `creditAck`.

**Wrapper pattern:** nothing outside `src/core/qvac.js` imports `@qvac/sdk` directly. Keep it that way — it isolates SDK churn.

**Topic strings live in `src/config.js`**, derived from human-readable names via `sha256(name)` to guarantee the 32-byte length requirement (see below). Same file holds the **model catalog** (key, id, source, tier) — add new models there, not inline in scripts.

## Non-obvious constraints (do not forget)

1. **Hyperswarm topics must be exactly 32 bytes (64 hex chars).** A shorter hex string does not error at `startQVACProvider` — the provider logs "Topic announced" and then the consumer silently times out with `DELEGATE_CONNECTION_FAILED` after 30s. Always derive topics from `sha256(name)` via `config.js`; never hand-write hex.

2. **Provider and consumer cannot share a process.** QVAC's Bare worker is effectively a singleton per process; running `startQVACProvider` and `loadModel({delegate})` together deadlocks at the RPC handshake. QVAC's own `composite.ts` example spawns the provider as a child for the same reason. The Pear app honors this by having `provider.js` and `server.js` as separate `pear run` entries.

3. **Bare does not expose `process` as a global.** Every entry script that uses `process.env`, `process.stdout`, `process.on("SIGINT")`, etc. must `import process from "bare-process"` at the top. Same for `os` — use `import os from "bare-os"`. (`node:os` happens to be shimmed; `process` is not.) Symptom if missing: `Uncaught ReferenceError: process is not defined` on first env-var access.

4. **QVAC needs a generated worker entry to run inside Pear.** In Node, the SDK can dynamically `import(default-worker)` to register plugins. In Pear that fails because native `.bare` addons can't be loaded from `pear://` URLs (the bundle is sandboxed). Fix:
   - `qvac.config.json` lists the plugins you need (we use `@qvac/sdk/llamacpp-completion/plugin`).
   - `npx qvac bundle sdk` (from `@qvac/cli`) generates `qvac/worker.entry.mjs` + `qvac/addons.manifest.json`.
   - Every entry script (`scripts/provider.js`, `scripts/server.js`, …) must `import "../qvac/worker.entry.mjs"` **before** any code that imports from `@qvac/sdk` runs, so plugins are pre-registered. Symptom if missing: `PEAR_WORKER_ENTRY_REQUIRED` thrown on first SDK call.
   - `qvac/worker.bundle.js` (~7.8 MB) is generated by the same command but is an **Expo/RN-only** artifact. Gitignored. Don't commit it.
   - Re-run `npx qvac bundle sdk` if you change `qvac.config.json` or upgrade `@qvac/sdk`.

5. **Hyperswarm DHT bootstrap takes ~10–30s on first `swarm.join().flushed()`.** The server appears to "hang" after `Starting P2P daemon for ...` for that window before printing `[discovery] Joined as ...` and `HTTP API Server listening`. This is normal. On hostile networks (hackathon venue WiFi, home WiFi) it can fail entirely — fall back to phone hotspot. WiFi-class P2P blockage is a real demo-day risk; bring a travel router and consider wiring `swarmRelays` in `qvac.config.json`.

If you see `DELEGATE_CONNECTION_FAILED: Operation timeout after 30000ms` with no other signal: check topic length first, then same-process second, then network.

## Adding or changing things

- **New model:** add an entry to `models` in `src/config.js` with key, id, src (an SDK constant), label, tier. The provider will pre-download and serve it on next start; the server matches by `key` or `id` from the chat request's `model` field.
- **New plugin (e.g. embeddings, OCR):** append to `qvac.config.json#plugins` and re-run `npx qvac bundle sdk`. Then expose it from `src/core/qvac.js` and add a route to `src/server/compute-exchange-api.js`.
- **Server vs daemon duplication:** `scripts/server.js` and the `daemon` command in `cli/commands.js` currently duplicate the entire chat handler. If you touch one, touch the other — or extract the shared logic into `src/server/`.

## What's built vs stubbed

- Built: `src/core/qvac.js` (wrapper), `src/core/ledger.js` (earn/spend/pricing), `src/core/discovery.js` (announce + creditAck side channel), `src/config.js` (model catalog + topics), `src/server/compute-exchange-api.js` (Ollama/OpenAI HTTP routes), provider + server + auto-consumer + CLI entry scripts, local/delegated/discovery/e2e smoke tests, multi-model catalog with tier-aware pricing, cross-machine validated on phone hotspot.
- Not started: signed receipts / fraud prevention, multi-peer load balancing or "best-of-N" routing, real `swarmRelays` keys, mobile (Expo) build, persistence beyond local JSON.

## Reference material

- `plan.md` — source of truth for scope, milestones, cut lines.
- `llms-full.txt` — pasted QVAC docs (~1.2 MB, gitignored). Grep this before asking about SDK behavior.
- `tetherto/qvac` repo, `packages/sdk/examples/delegated-inference/` — canonical consumer/provider/composite examples; our scripts are adapted from these.
- `errors.md` — captured provider/consumer logs from past debugging sessions.
