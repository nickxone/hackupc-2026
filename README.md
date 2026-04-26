<h1 align="center">LLeMur</h1>

<p align="center"><strong>Peer-to-peer LLM compute for hackathon demos.</strong></p>

<div align="center">

```text
                 ,,   ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
                ==    ~   _         _                   __  __                      ~
               ==     ~  FJ        FJ         ____     F  \/  ]    _    _    _ ___  ~
              ==      ~ J |       J |        F __ J   J |\__/| L  J |  | L  J '__ ",~
             ==       ~ | |       | |       | _____J  | |`--'| |  | |  | |  | |__|-J~
             ==       ~ F L_____  F L_____  F L___--. F L    J J  F L__J J  F L  `-'~
    ,  ,     ==       ~J________LJ________LJ\______/FJ__L    J__LJ\____,__LJ__L     ~
    |\/|   ,-..-,     ~|________||________| J______F |__L    J__| J____,__F|__L     ~
  ./(_  \_/      \    ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      \           |
      | \_,' /^| /
      ( //  /  \ \
      || \ <    \ )
     _\|  \ )   _\\
      ~'  _\|    '~
           '~
```

<p><em>peer-to-peer compute market</em></p>

</div>

LLeMur turns laptops into a small local compute market. One terminal can serve QVAC-backed models, another terminal runs a local daemon, and clients talk to that daemon through a Pear CLI, an Ollama-style endpoint, or an OpenAI-compatible endpoint that works with tools like OpenCode.

Under the hood, peers discover each other with Hyperswarm, inference runs through QVAC, and credits/ratings are recorded as signed Hypercore/Autobase events.

## Demo Flow

Install dependencies:

```bash
npm install
```

Start a provider in one terminal:

```bash
pear run . serve
```

Start the local daemon in another terminal:

```bash
pear run . daemon
```

Ask through the daemon:

```bash
pear run . ask "Explain vector databases"
pear run . ask --model qwen-1.7b "Give me a one paragraph pitch for LLeMur"
```

Inspect the market:

```bash
pear run . peers
pear run . balance
pear run . ratings
```

Rate the last provider you paid:

```bash
pear run . rate 5
```

Current limitation: `serve` and `daemon` both default to the machine hostname for their local ledger/ratings storage. On one laptop, they cannot safely run simultaneously with the same default peer name because both processes try to open the same Corestore files. For local all-in-one demos, set different peer names manually:

```bash
PEER_NAME=llemur-provider pear run . serve
PEER_NAME=llemur-daemon pear run . daemon
```

## Pear CLI

Run commands with:

```bash
pear run . <command> [args]
```

Main commands:

```bash
pear run . serve [--models keys] [--peer-name name] [--topic hex] [--skip-download] [--debug]
pear run . daemon [--host addr] [--port n] [--debug]
pear run . ask [--model key] [--api-url url] <prompt>
pear run . peers [--wait ms] [--api-url url]
pear run . balance [--api-url url]
pear run . rate [--api-url url] [ledger-account-id] <1-5>
pear run . ratings [--api-url url] [ledger-account-id]
```

Provider mode serves all configured models by default:

```bash
pear run . serve
pear run . serve --models llama-1b
pear run . serve --models llama-1b,qwen-1.7b
```

Daemon mode starts the local HTTP API on `127.0.0.1:11434` by default:

```bash
pear run . daemon
pear run . daemon --port 11435
```

Use `--debug` on `serve` or `daemon` to show SDK logs. Without `--debug`, startup uses a quiet loading animation.

## OpenCode Integration

LLeMur exposes an OpenAI-compatible API at:

```text
http://127.0.0.1:11434/v1
```

OpenCode supports custom OpenAI-compatible providers through `@ai-sdk/openai-compatible` and `provider.*.options.baseURL`. See the OpenCode provider docs: https://opencode.ai/docs/providers

Create `opencode.json` in your project root:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "llemur/qwen-1.7b",
  "provider": {
    "llemur": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LLeMur Local P2P",
      "options": {
        "baseURL": "http://127.0.0.1:11434/v1",
        "apiKey": "llemur-local"
      },
      "models": {
        "llama-1b": {
          "name": "LLeMur Llama 3.2 1B"
        },
        "qwen-1.7b": {
          "name": "LLeMur Qwen 3 1.7B"
        }
      }
    }
  }
}
```

Then start LLeMur. On separate laptops, each side can use the default hostname-backed peer name:

```bash
pear run . serve
pear run . daemon
```

On one laptop, use distinct peer names:

```bash
PEER_NAME=llemur-provider pear run . serve
PEER_NAME=llemur-daemon pear run . daemon
```

OpenCode can now use:

```text
llemur/llama-1b
llemur/qwen-1.7b
```

For a quick endpoint check before opening OpenCode:

```bash
curl http://127.0.0.1:11434/v1/models
```

## HTTP API

The daemon exposes both project APIs and compatibility APIs.

Health and discovery:

```text
GET  /
GET  /api/version
GET  /api/peers
GET  /api/balance
```

Ratings:

```text
GET  /api/ratings
GET  /api/ratings?target=<ledger-account-id>
POST /api/rate
```

Ollama-style chat:

```text
POST /api/chat
```

Example:

```bash
curl -N http://127.0.0.1:11434/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-1b",
    "messages": [
      { "role": "user", "content": "Say hello in five words." }
    ]
  }'
```

OpenAI-compatible:

```text
GET  /v1/models
POST /v1/chat/completions
```

Non-streaming example:

```bash
curl http://127.0.0.1:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen-1.7b",
    "stream": false,
    "messages": [
      { "role": "user", "content": "What is peer-to-peer inference?" }
    ]
  }'
```

Streaming example:

```bash
curl -N http://127.0.0.1:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-1b",
    "stream": true,
    "messages": [
      { "role": "user", "content": "Explain LLeMur in one sentence." }
    ]
  }'
```

`/api/chat` streams newline-delimited JSON by default. `/v1/chat/completions` streams Server-Sent Events by default.

## Models

Configured in `src/config.js`:

```text
llama-1b   Llama 3.2 1B Instruct Q4   tier 1   1 credit
qwen-1.7b  Qwen 3 1.7B Q4             tier 3   10 credits
```

The provider pre-downloads model assets unless `--skip-download` is passed. Assets are cached under `~/.qvac/models`.

## Credits And Ratings

The daemon chat handler is the source of truth for paid inference:

1. The daemon discovers providers.
2. It selects a provider that advertises the requested model.
3. It signs a transfer proposal for the model tier price.
4. The provider signs an acceptance.
5. The daemon performs delegated inference through QVAC.
6. Ratings can be submitted after payment.

Balances are computed from signed ledger events. `pear run . balance` shows the machine wallet total across local accounts and recent local ledger events.

Market defaults live in `config/market.json`:

```text
initialCredits: 100
tier 1: 1 credit
tier 2: 5 credits
tier 3: 10 credits
```

## Data Layout

Runtime state is local:

```text
data/<peerName>/ledger/account.json
data/<peerName>/ledger/peer/
data/<peerName>/ratings/
```

Shared ledger and ratings bootstrap keys are stored in:

```text
config/market.json
```

## Project Map

```text
cli/commands.js                  Pear CLI command handlers
cli/render.js                    Terminal output
src/server/provider-runtime.js   Provider startup, discovery, ledger acceptance
src/server/chat-handler.js       Paid delegated chat flow
src/server/compute-exchange-api.js HTTP/Ollama/OpenAI API layer
src/core/qvac.js                 QVAC wrapper helpers
src/core/discovery.js            Hyperswarm peer discovery and event transport
src/ledger/                      Hypercore/Autobase ledger protocol
src/ratings/                     Signed provider ratings
qvac/worker.entry.mjs            QVAC worker bundle entry
```

## Hackathon Notes

- Use Pear for the main demo path.
- Current version caveat: `serve` and `daemon` cannot run simultaneously on the same machine with the same default hostname-backed peer storage. Use different `PEER_NAME`s for same-laptop demos.
- First startup may take time while QVAC downloads model files.
- Discovery can take a few seconds.
- If a model gets stuck after config changes, restart both `serve` and `daemon`.
- `pear run . ask` calls the daemon HTTP chat API, so it exercises the same ledger path as OpenCode and curl.
