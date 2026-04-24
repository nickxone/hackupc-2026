# P2P Compute Exchange — HackUPC 2026 Plan

## Brief

Serverless, peer-to-peer platform where users trade LLM inference time for "compute credits." A peer with a small machine earns credits by serving small-model requests, then spends them to run larger-model prompts on more capable peers.

Runtime: Pear. Transport/discovery: Hyperswarm. Local index: Hyperbee. Inference: Ollama (HTTP bridge to `localhost:11434`).

Team: 3 SWEs.

## Demo story (what we're building toward)

3 laptops side-by-side on stage:

- **Laptop A** (small, e.g. Air) — advertises a 3B model, starts with 0 credits.
- **Laptop B** — asks A to run the 3B model several times. A earns credits.
- **Laptop C** — advertises a 21B model. A (now flush with credits) spends them to ask C a hard question. Credits visibly deducted.

Judges see: peer list populate, prompts stream, balances tick live on all three screens.

## Architecture

```
┌───────────────────────── Pear app (per peer) ─────────────────────────┐
│                                                                        │
│  UI (HTML/JS)   ──►   Core (Node/Bare)   ──►   Ollama (localhost)      │
│   - peer list          - hyperswarm             - /api/tags            │
│   - chat               - hyperbee catalog       - /api/generate (stream)│
│   - balance/log        - request router                                │
│                        - credit ledger (local JSON)                    │
└────────────────────────────────────────────────────────────────────────┘
           │ hyperswarm topic "compute-exchange-v1"
           ▼
        other peers (same app)
```

**Credits (simplest possible):** each peer keeps a local JSON file. On a served request, provider adds credits; on a made request, client subtracts. Two independent counters. No gossip, no shared ledger, no receipts. Everyone starts at 100. Cheatable and we don't care — upgrade is a stretch goal.

**Pricing:** flat `credits = ceil(tokens_generated / 10) * model_tier` where tier is 1 for ≤3B, 3 for 7B–13B, 5 for 20B+. Easy to tune.

## Protocol (JSON lines over Hyperswarm duplex stream)

Handshake (on connect, both directions):

```
{"t":"hello","peerId":"<pubkey>","models":[{"name":"llama3.2:3b","tier":1},{"name":"qwen:14b","tier":3}]}
```

Inference:

```
client → {"t":"infer","id":"r1","model":"qwen:14b","prompt":"...","maxTokens":512}
server → {"t":"token","id":"r1","delta":"Hello"}
server → {"t":"token","id":"r1","delta":" world"}
server → {"t":"done","id":"r1","tokens":128,"credits":39}
```

Errors: `{"t":"err","id":"r1","code":"model_not_loaded"}`. Client does not deduct on error.

## File layout

```
/package.json              # pear field + deps (hyperswarm, hyperbee, corestore)
/app.js                    # Pear main entry, wires UI ↔ core
/core/
  swarm.js                 # join topic, manage peer connections
  catalog.js               # hyperbee index of seen peers + models
  protocol.js              # JSON-line framing, request/response
  ollama.js                # thin fetch wrapper around localhost:11434
  ledger.js                # load/save balance + append to log
/ui/                       # use next.js

/config.json               # initial balance, tier pricing, topic name
```

## Milestones

1. **Setup.** Pear scaffold running on all 3 laptops, Ollama installed with a small model pulled everywhere and a large model on the beefy one, shared repo, shared topic name.
2. **Single peer works.** UI loads, talks to local Ollama, streams tokens, reads/writes a local balance file.
3. **Two peers talk.** Hyperswarm discovery, handshake, one peer runs inference for the other over the wire. No credits yet.
4. **Credits live.** Pricing applied, balances update on both ends, earn/spend log visible in UI.
5. **Three-peer demo polished.** A→B→C flow rehearsed, reconnect handling, UI pass, models pre-warmed.

## Cut lines (drop in this order if behind)

1. Hyperbee catalog → in-memory Map of peers. (Loses persistence across restart, nothing else.)
2. Model tier pricing → flat `1 credit per 10 tokens`. (Loses the "heavy model costs more" story — keep if at all possible.)
3. Token streaming UI → wait for full response, then render. (Loses drama, saves fiddly UI work.)
4. Three-peer demo → two-peer demo. (Loses the "earn then spend" arc — painful but survivable.)
5. Custom UI → terminal output on all three laptops. (Last resort.)

## Stretch (only if milestone 5 finishes early)

- **Signed receipts.** Upgrade the credit model: provider signs `{peerId, tokens, timestamp}` per completed request, client stores it. Append-only Hypercore log per peer. Sellable as "trustless ledger" in the pitch.
- **Reputation.** Peer card shows success rate / avg latency from prior interactions.
- **Model auto-pull.** If a peer advertises a model you don't have and you request it, show "pulling…" via Ollama API.

## Risks + mitigations

- **Hackathon wifi blocks Hyperswarm DHT / NAT traversal fails.** Mitigation: bring a travel router, put the 3 demo laptops on a personal network. Test this early — at milestone 3, not at milestone 5.
- **Ollama cold-start lag during demo.** Mitigation: warm every model with a dummy prompt right before demoing.
- **Pear/Bare runtime missing a Node API we assume exists.** Mitigation: spike `swarm.js` inside Pear in the first couple of hours — do not wait until milestone 3 to find out.
- **Streaming tokens over Hyperswarm stalls or reorders.** Mitigation: include `id` on every frame, client buffers per-id; if truly broken, fall back to non-streaming (cut line #3).

## Open questions (decide before milestone 3)

- Topic name — just `compute-exchange-v1` or include a team secret so strangers don't join during demo?
- Does peer identity = Hyperswarm keypair, or a separate display name in `config.json`?
- Max concurrent requests a provider will serve (1 for simplicity, or queue)?
