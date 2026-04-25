# P2P Compute Exchange - HackUPC 2026 Plan

## Brief

Serverless, peer-to-peer platform where users trade LLM inference time for local credits. A peer earns credits by serving QVAC delegated inference, then spends credits by delegating prompts to another provider.

Runtime: Pear/Bare. Inference and delegated transport: QVAC SDK (`@qvac/sdk`). Discovery and credits are layered on top with a small Hyperswarm side channel and local JSON ledgers.

Team: 3 SWEs.

## Current Demo Story

Two-laptop demo that works with the current implementation:

1. Laptop A starts provider mode:

   ```bash
   PEER_NAME=alice pear run . serve
   ```

2. Laptop B starts the local HTTP proxy:

   ```bash
   PEER_NAME=bob pear run scripts/server.js
   ```

3. Laptop B sends an OpenAI or Ollama-compatible chat request to `127.0.0.1:11434`.

4. The server discovers Alice, delegates the prompt through QVAC, streams tokens back to the HTTP client, spends Bob's credits, and attempts to send Alice a `creditAck`.

5. Alice should receive the `creditAck` and earn credits in `data/alice.ledger.json`. The auto-consumer path does this with the discovery peer id; the HTTP server path currently needs a target-id audit.

Three-peer story still fits the architecture, but requires more polish around peer selection, balances, and demo choreography.

## Current Architecture

```
per peer
  provider mode
    scripts/provider.js
    src/server/provider-runtime.js
      -> QVAC provider topic
      -> discovery announce
      -> local ledger earn on creditAck

  consumer/server mode
    scripts/server.js
      -> local HTTP API on 127.0.0.1:11434
      -> discovery peer list
      -> delegated QVAC load/completion
      -> local ledger spend
      -> discovery creditAck

  CLI mode
    cli/index.js
    cli/commands.js
      -> serve, daemon, ask, peers, balance, rate
```

Two topics:
<<<<<<< HEAD

1. **QVAC topic** — used by the SDK. Provider joins via `startQVACProvider({topic})`; consumer references it in `loadModel({delegate})`. The SDK handles the inference wire entirely.
2. **Discovery topic** — our own thin Hyperswarm channel. Each peer announces `{publicKey, peerName, models: [{const, tier}]}` periodically. Each peer also sends `creditAck` messages here after consuming a completion.
=======
>>>>>>> feature/application-integration

1. QVAC topic: used by `startQVACProvider({ topic })` and `loadModel({ delegate })`.
2. Discovery topic: used by our Hyperswarm side channel for `announce` and `creditAck`.

Topics are derived in `src/topics.js` with SHA-256 so they are always valid 32-byte Hyperswarm topics.

## Discovery and Credit Protocol

Discovery uses newline-delimited JSON frames.

Provider announce:

<<<<<<< HEAD
Provider:

```js
const { publicKey } = await startQVACProvider({ topic: SHARED_TOPIC_HEX });
// optional: firewall: { mode: "allow", publicKeys: [...] }
```

Consumer:

```js
const modelId = await loadModel({
  modelSrc: LLAMA_3_2_1B_INST_Q4_0, // or any registry constant
  modelType: "llm",
  delegate: {
    topic: SHARED_TOPIC_HEX,
    providerPublicKey,
    timeout: 15_000,
    fallbackToLocal: false, // we don't want silent local fallback during demo
  },
});

const response = completion({
  modelId,
  history: [{ role: "user", content: prompt }],
  stream: true,
});
for await (const token of response.tokenStream) {
  /* render */
}
const stats = await response.stats; // → tokens for credit math
=======
```json
{"t":"announce","peerName":"alice","models":[{"id":"LLAMA_3_2_1B_INST_Q4_0","key":"llama-1b","tier":1}],"qvacTopic":"<hex>","qvacProviderPublicKey":"<hex>"}
```

Credit acknowledgement:

```json
{"t":"creditAck","to":"<discovery-peer-id>","tokens":128,"credits":13,"model":"llama-1b"}
>>>>>>> feature/application-integration
```

Consumers send the credit acknowledgement after a completion. The provider trusts it and updates its local ledger. This is intentionally trust-based for hackathon scope.

<<<<<<< HEAD
JSON-line frames:

```
{"t":"announce","peerId":"<pubkey>","peerName":"alex-air","models":[{"id":"LLAMA_3_2_1B_INST_Q4_0","tier":1}]}
{"t":"creditAck","from":"<consumerPubkey>","to":"<providerPubkey>","model":"LLAMA_3_2_1B_INST_Q4_0","tokens":128,"credits":13}
```
=======
## Credit Model
>>>>>>> feature/application-integration

- Local ledger path: `data/<peerName>.ledger.json`
- Initial balance: `100`
- Configured price: `ceil(tokens * pricePerTokenPerTier * tier)`
- Current `pricePerTokenPerTier`: `0.1`
- Current model tiers:
  - `llama-1b`: tier `1`
  - `qwen-1.7b`: tier `3`

## Built

- QVAC wrapper in `src/core/qvac.js`
- SHA-256 topic generation in `src/topics.js`
- Model catalog in `src/config.js`
- Provider runtime with pre-download and discovery advertisement
- Discovery side channel with peer tracking, periodic announce, DHT refresh, and `creditAck`
- Local JSON ledger with earn/spend log
- Working HTTP proxy via `pear run scripts/server.js`
- OpenAI-compatible streaming route: `POST /v1/chat/completions`
- Ollama-compatible streaming route: `POST /api/chat`
- Peer and balance routes: `GET /api/peers`, `GET /api/balance`
- Provider CLI path: `pear run . serve`
- CLI peer/balance inspection
- CLI direct delegated ask
- Local, delegated, discovery, auto-consumer, and e2e smoke scripts
- Multi-model provider advertisement

## Partial or Stubbed

- `pear run . daemon` starts the API shell but does not wire delegated chat.
- `pear run . ask` streams delegated output but does not currently spend credits or send `creditAck`.
- `scripts/server.js` spends credits locally but currently passes the provider QVAC public key to `sendCreditAck`; discovery connections are keyed by discovery peer id.
- `/api/tags` returns an empty placeholder catalog.
- `/api/rate` returns `501`; ratings are not stored.
- Provider selection is first matching provider in `scripts/server.js`; CLI has selection scaffolding but no real reputation or latency inputs.
- Credits are unsigned and local only.
- No shared ledger, fraud prevention, load balancing, queueing, or mobile build.

## Near-term Work

1. Unify chat handling between `scripts/server.js` and `cli daemon`.
2. Move duplicated credit formula in `scripts/server.js` to `ledger.priceOf`.
3. Make `cli ask` spend credits and send `creditAck`, or document it as a diagnostic-only path.
4. Wire `/api/tags` to the configured model catalog and discovered provider availability.
5. Fix `scripts/server.js` so `creditAck.to` targets the provider discovery peer id, or change the discovery protocol consistently to use QVAC provider public keys.
6. Add a minimal provider selection policy that respects model, peer id, max credits, and advertised tier.
7. Add route-level tests for `compute-exchange-api.js` without needing live QVAC.

## Demo Cut Lines

Drop in this order if the venue network or timing is bad:

1. Provider ratings.
2. Multi-model demo; serve only `llama-1b`.
3. CLI ask; use HTTP `curl` only.
4. Three-peer earn-then-spend story; show two peers with ledger movement.
5. Live discovery; hardcode provider public key with `scripts/consumer.js`.

## Risks and Mitigations

- QVAC model download is slow on venue WiFi. Pre-download before the demo and avoid changing the model catalog late.
- Hyperswarm DHT/NAT traversal may fail on restrictive networks. Bring a hotspot or controlled router.
- QVAC delegated consumer/provider in one process can deadlock. Keep provider and consumer/server as separate processes.
- Short topics can silently fail later. Always use generated 64-char topics.
- Credit acknowledgement is consumer-driven and cheatable. Accept for hackathon demo; signed receipts are future work.

## Stretch

- Signed credit receipts.
- Append-only shared receipt logs.
- Provider reputation from observed success and latency.
- Load balancing across multiple matching providers.
- Queueing and concurrency limits for providers.
- Real model catalog endpoint compatible with Ollama clients.
- Mobile or desktop UI once the CLI/HTTP path is stable.
