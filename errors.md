# Errors and Debugging Notes

Historical logs and notes from getting QVAC delegated inference working in this repo.

## Current Invocation Notes

Prefer Pear entrypoints:

```bash
pear run . serve
pear run scripts/server.js
pear run . help
pear run scripts/local-test.js
pear run scripts/delegated-test.js
pear run scripts/discovery-test.js
pear run scripts/e2e-test.js
```

Some older logs below show direct `node scripts/...` usage. The current application entrypoints import Bare modules and generated QVAC worker assets, so Pear entrypoints are the expected path.

## Known Failure Modes

### Short or invalid topic

Symptom:

- Provider appears to announce a topic.
- Consumer eventually fails with `DELEGATE_CONNECTION_FAILED` or an operation timeout.

Cause:

- Hyperswarm topics must be exactly 32 bytes, represented as 64 hex chars.

Fix:

- Use `config.qvacTopic` and `config.discoveryTopic` from `src/config.js`.
- Do not hand-write short topic strings.

### Provider and consumer in the same process

Symptom:

- Delegated load hangs or deadlocks around the RPC handshake.

Cause:

- QVAC's Bare worker/RPC path behaves like a process singleton for this delegated provider/consumer flow.

Fix:

- Run provider and consumer/server as separate processes.
- Use `pear run . serve` plus `pear run scripts/server.js`, or the smoke scripts that spawn separate children.

### Missing generated worker entry

Symptom:

- QVAC throws `PEAR_WORKER_ENTRY_REQUIRED` on the first SDK call.

Cause:

- Pear cannot dynamically load the default worker and native addons from inside the bundle.

Fix:

- Keep `import "../qvac/worker.entry.mjs"` before QVAC SDK use in entry scripts.
- Re-run `npx qvac bundle sdk` after changing `qvac.config.json` or upgrading `@qvac/sdk`.

### Missing Bare globals

Symptom:

- `ReferenceError: process is not defined`

Cause:

- Bare does not expose Node globals in the same way as Node.

Fix:

- Use `import process from "bare-process"`.
- Use `import os from "bare-os"` for hostname.

### DHT bootstrap delay or failure

Symptom:

- Startup appears to hang around discovery join or provider lookup.
- Peers do not appear on venue/home WiFi.

Cause:

- Hyperswarm DHT bootstrap and NAT traversal can take 10-30 seconds or fail on restrictive networks.

Fix:

- Wait before assuming failure.
- Test on a phone hotspot or controlled router.
- Keep direct known-provider scripts available as a fallback.

## Historical Successful Provider Log

This log came from an earlier direct-Node experiment and is kept for behavior comparison.

```text
Starting provider on topic 8e32e857f492...
[sdk:server] Hello from Bare
[sdk:client] Initialization complete
[sdk:server] Joining topic as server...
[sdk:server] Topic announced:
8e32e857f492791f1431a1c258cd8d4b6b4dcbb47ad8884817001f544a6df5e6
[sdk:server] Ready to accept connections on topic: 8e32e857f492791f...
PROVIDER_PUBLIC_KEY=f4894375f9afef9c93f5575f1b5f99940f71e5ca0f4f2531f332dfd2fb12addc
[sdk:server] New connection established from: bfb14d90b1fbc72b...
[sdk:server] Loading from registry: unsloth/Llama-3.2-1B-Instruct-GGUF/...
[sdk:server] Model cached with correct size
[sdk:server] llamacpp-completion model 31b329c97909457e loaded
[sdk:server] Model 31b329c97909457e unloaded
```

## Historical Successful Consumer Log

```text
Consumer -> topic 8e32e857f492..., provider f4894375f9af...
[sdk:client] Initialization complete
[sdk:server] Sending delegated loadModel request to provider: f4894375...
[sdk:server] Establishing RPC connection to topic: 8e32e857..., peer: f4894375...
[sdk:server] New peer connection established: f4894375...
download: 100.0%
[sdk:server] Delegated model registered: 31b329c97909457e -> provider: f4894375...
tokensPerSecond: 143.33949162260302
backendDevice: 'gpu'
[sdk:server] Delegated model 31b329c97909457e unloaded on provider
```

## Historical Shutdown Issue

Observed after delegated consumer shutdown:

```text
free(): double free detected in tcache 2
```

This appeared after the delegated model unloaded and the Bare worker was closing. Treat it as a native/QVAC shutdown issue unless it starts happening before successful completion. The current scripts still explicitly unload models and call QVAC `close()` where appropriate.
