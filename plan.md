# P2P Compute Exchange — HackUPC 2026 Plan

## Brief

Serverless, peer-to-peer platform where users trade LLM inference time for "compute credits." A peer with a small machine earns credits by serving small-model requests, then spends them to run larger-model prompts on more capable peers.

Runtime: Pear. Inference + P2P transport: **QVAC SDK** (`@qvac/sdk`) — its **delegated inference** primitive (`startQVACProvider` / `loadModel({delegate})`) handles the Hyperswarm wiring, model registry, and token streaming for us. Discovery of providers + credit accounting layered on top via a small Hyperswarm side channel.

Team: 3 SWEs.

## Demo story (what we're building toward)

3 laptops side-by-side on stage:

- **Laptop A** (small, e.g. Air) — runs a QVAC provider for a small model (e.g. `LLAMA_3_2_1B_INST_Q4_0`), starts with 0 credits.
- **Laptop B** — asks A to run inference several times. A earns credits.
- **Laptop C** — runs a QVAC provider for a heavier model. A (now flush with credits) delegates a hard prompt to C. Credits visibly deducted.

Judges see: peer list populate, prompts stream, balances tick live on all three screens.

## Architecture

```
┌──────────────────────── Pear app (per peer) ─────────────────────────┐
│                                                                       │
│  UI (Next.js)   ──►   App glue   ──►   QVAC SDK                       │
│   - peer list           - routes        - startQVACProvider(topic)    │
│   - chat                  UI to         - loadModel({delegate:{...}}) │
│   - balance/log           SDK +         - completion() → tokenStream  │
│                           ledger                                      │
│                         - ledger                                      │
│                         - discovery (hyperswarm side channel)         │
└───────────────────────────────────────────────────────────────────────┘
       │                              │
       │ QVAC topic                   │ discovery topic (our own)
       │ "compute-exchange-v1"        │ "compute-exchange-discovery-v1"
       ▼                              ▼
   QVAC delegated inference       capability announce + credit acks
   (Hyperswarm under the hood)
```

Two topics:

1. **QVAC topic** — used by the SDK. Provider joins via `startQVACProvider({topic})`; consumer references it in `loadModel({delegate})`. The SDK handles the inference wire entirely.
2. **Discovery topic** — our own thin Hyperswarm channel. Each peer announces `{publicKey, peerName, models: [{const, tier}]}` periodically. Each peer also sends `creditAck` messages here after consuming a completion.

**Why a side channel for discovery:** QVAC consumer needs the provider's `publicKey` up-front. There is no `listProviders(topic)` API. So peers announce themselves on the discovery topic; the UI peer list is built from those announcements.

**Why a side channel for credit acks:** `startQVACProvider` has no per-request callback, so the provider can't directly observe what it served. After each completion, the consumer publishes `{toPubkey, fromPubkey, model, tokens, credits}` on the discovery topic. The provider listens for messages addressed to it and updates its ledger. (Trust-based, matches the "simplest possible credits" decision.)

**Credits (simplest possible):** each peer keeps a local JSON file. On `completion()` finishing, the consumer subtracts and emits a credit ack; the provider receives the ack and adds. No global ledger. Everyone starts at 100. Cheatable, fine for hackathon.

**Pricing:** flat `credits = ceil(tokens / 10) * model_tier` where tier is 1 for ≤3B, 3 for 7B–13B, 5 for 20B+. Easy to tune.

## QVAC API touch points (cheat sheet)

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
```

## Discovery + credit-ack protocol (our own, on the discovery topic)

JSON-line frames:

```
{"t":"announce","peerId":"<pubkey>","peerName":"alex-air","models":[{"id":"LLAMA_3_2_1B_INST_Q4_0","tier":1}]}
{"t":"creditAck","from":"<consumerPubkey>","to":"<providerPubkey>","model":"LLAMA_3_2_1B_INST_Q4_0","tokens":128,"credits":13}
```

Announce is sent on connect and every ~10s. Ledger updates on receipt of `creditAck` matching our own pubkey.

## File layout

```
/package.json              # pear field + deps (@qvac/sdk, hyperswarm)
/app.js                    # Pear main entry, wires UI ↔ SDK ↔ ledger
/core/
  qvac.js                  # thin wrappers: startProvider, loadDelegated, runCompletion
  discovery.js             # hyperswarm side channel: announce + creditAck
  ledger.js                # load/save balance + append to log
/ui/                       # use next.js
/config.json               # initial balance, tier pricing, topic names, our model list
```

(Dropped from the previous plan: `core/swarm.js`, `core/catalog.js`, `core/protocol.js`, `core/ollama.js` — all subsumed by QVAC.)

## Milestones

1. **Setup.** Pear scaffold running on all 3 laptops, `@qvac/sdk` installed, small model pulled via QVAC on every laptop, large model on the beefy one. Shared repo, shared topic constants.
2. **Single peer works.** UI loads. Local-only `loadModel` + `completion` streams tokens into the chat UI. Ledger reads/writes a local balance file.
3. **Two peers, delegated inference.** Provider script on one laptop publishes its pubkey; consumer on the other hardcodes it and runs `loadModel({delegate})` + `completion()`. Tokens stream cross-machine. No discovery yet, no credits yet.
4. **Discovery + credits.** Discovery side channel works: peer list populates from `announce` messages. After each completion, consumer emits `creditAck`; provider updates its ledger. UI shows balance and earn/spend log.
5. **Three-peer demo polished.** A→B→C flow rehearsed, model pre-warmed, UI pass, fallbackToLocal disabled so failures are visible.

## Cut lines (drop in this order if behind)

1. Tier pricing → flat `1 credit per 10 tokens`. (Loses the "heavy model costs more" story — keep if at all possible.)
2. Discovery topic announce/list → hardcode each peer's pubkey in `config.json` for the demo. (Loses the "peers find each other" story but the rest still works.)
3. Token streaming UI → wait for full response, then render. (Saves fiddly UI work.)
4. Three-peer demo → two-peer demo. (Loses the "earn then spend" arc — painful but survivable.)
5. Custom UI → terminal output on all three laptops. (Last resort.)

## Stretch (only if milestone 5 finishes early)

- **Signed credit acks.** Provider verifies an ed25519 signature on every `creditAck`, append-only Hypercore log per peer. Sellable as "trustless ledger" in the pitch.
- **Reputation.** Peer card shows success rate / avg latency from prior delegations.
- **Auto-tier.** Each peer benchmarks itself at startup (tokens/sec on a probe prompt) and advertises a tier automatically instead of hardcoding.
- **Firewall demo.** Use `startQVACProvider({firewall: {mode: "allow", publicKeys: [...]}})` to show a peer accepting only allow-listed consumers — sells the "you control your machine" angle.

## Risks + mitigations

- **QVAC delegated inference is new — API surface or behavior surprises.** Mitigation: do milestone 3 (cross-machine delegation) within the first ~6 hours, before building anything else on top. If the SDK has sharp edges, we want to know immediately, not at milestone 4.
- **Hackathon wifi blocks Hyperswarm DHT / NAT traversal fails.** Mitigation: bring a travel router and put the 3 demo laptops on a personal network. QVAC docs mention `swarmRelays` config — keep that as a backup option. Test connectivity at milestone 3, not at milestone 5.
- **QVAC model download is slow on hackathon wifi.** Mitigation: pre-pull every model we plan to use during setup (milestone 1), before the venue's network gets congested.
- **Provider doesn't see served requests, so credit ack is consumer-driven and trust-based.** Mitigation: accept it for the hackathon, mention "signed acks" as the obvious upgrade in the pitch.
- **`fallbackToLocal: true` would silently mask delegation failures during the demo.** Mitigation: hard-set `fallbackToLocal: false` for the demo build; surface errors loudly in the UI.

## Open questions (decide before milestone 3)

- Topic names — `compute-exchange-v1` / `compute-exchange-discovery-v1` plain, or include a team secret so strangers don't join during demo?
- Peer identity — display name from `config.json` mapped to QVAC pubkey, or just show truncated pubkey?
- Multiple models per provider — does a single `startQVACProvider(topic)` call serve any model the consumer requests, or do we need one provider instance per model? (Verify in milestone 3.)
- Max concurrent inferences a provider will accept (1 for simplicity, or queue)?
