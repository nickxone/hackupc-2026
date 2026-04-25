# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

HackUPC 2026 entry: a serverless, peer-to-peer "compute exchange" where peers trade LLM inference time for local credits. A small machine earns credits serving a small model and spends them to run larger prompts on a beefier peer. `plan.md` is the full plan — demo story, milestones, cut lines, open questions. Read it before making scope decisions.

## Commands

- `npm run local` — load a model locally and run a single completion. Validates QVAC + native llama.cpp on this machine.
- `npm run delegated` — runs the full two-process delegated inference loop: spawns `scripts/provider.js` as a child, parses its public key from stdout, then spawns `scripts/consumer.js` against it. This is our core-primitive smoke test.
- `node scripts/provider.js [topic-hex]` — run a standalone provider (e.g. on another machine). Prints `PROVIDER_PUBLIC_KEY=<hex>`.
- `node scripts/consumer.js <provider-pubkey> [prompt]` — run a standalone consumer against a known provider. Override the topic with `QVAC_TOPIC=<hex>` if needed.

First run of `local` downloads a ~773 MB model to QVAC's cache; subsequent runs use it.

## Architecture — how the layers fit

The project leans hard on **QVAC SDK (`@qvac/sdk`)**, which owns two things we would otherwise build ourselves: native LLM inference (llama.cpp) and the Hyperswarm delegated-inference wire. Concretely:

- **Provider side:** `startQVACProvider({topic})` joins a Hyperswarm topic, returns a public key, and thereafter handles incoming inference requests. There is **no per-request callback** on the provider.
- **Consumer side:** `loadModel({delegate: {topic, providerPublicKey}})` returns a `modelId` that acts like a local model; `completion({modelId})` returns a `tokenStream` that streams over Hyperswarm transparently.

Because QVAC has no per-request hook on the provider and no `listProviders(topic)` API, we layer two things on top:

1. **A discovery side-channel.** A separate Hyperswarm topic where peers announce their name, models, QVAC topic, and QVAC provider public key. Consumers also send `creditAck` messages back to providers after a completion.
2. **A local credit ledger.** `src/core/ledger.js` persists a balance and a log to a local JSON file. Consumer subtracts on completion; provider trusts the incoming `creditAck` and adds. No gossip, no consensus — intentionally simplest-possible for the hackathon.

**Wrapper pattern:** nothing outside `src/core/qvac.js` imports `@qvac/sdk` directly. Keep it that way — it isolates SDK churn and keeps the rest of the app portable across runtimes (Node today, Pear/Bare later).

**Topic strings live in `src/config.js`**, derived from human-readable names via `sha256(name)` to guarantee the 32-byte length requirement (see below).

## Non-obvious constraints (both learned the hard way — do not forget)

1. **Hyperswarm topics must be exactly 32 bytes (64 hex chars).** A shorter hex string does not error at `startQVACProvider` — the provider logs "Topic announced" and then the consumer silently times out with `DELEGATE_CONNECTION_FAILED` after 30s. Always derive topics from `sha256(name)` via `config.js`; never hand-write hex.

2. **Provider and consumer cannot share a process.** QVAC's Bare worker is effectively a singleton per Node process; running `startQVACProvider` and `loadModel({delegate})` together deadlocks at the RPC handshake. QVAC's own `composite.ts` example spawns the provider as a child for this reason. Our `scripts/delegated-test.js` does the same. When we build the Pear app, the provider will need to live in a forked worker.

If you see `DELEGATE_CONNECTION_FAILED: Operation timeout after 30000ms` with no other signal, check topic length first and same-process second.

## What's built vs stubbed

- Built: `src/core/qvac.js` (wrapper), `src/core/ledger.js` (local JSON persistence, earn/spend/pricing), `src/core/discovery.js` (Hyperswarm announce + creditAck side channel), `src/config.js`, provider/consumer scripts, local/delegated/discovery smoke tests.
- Not started: Pear app shell, Next.js UI, multi-peer orchestration, running on a second physical machine.

## Reference material

- `plan.md` — source of truth for scope, milestones, cut lines.
- `llms-full.txt` — pasted QVAC docs (~1.2 MB, gitignored). Grep this before asking about SDK behavior.
- `tetherto/qvac` repo, `packages/sdk/examples/delegated-inference/` — canonical consumer/provider/composite examples; our scripts are adapted from these.
