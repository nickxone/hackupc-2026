### Provider:
  ❯ node scripts/provider.js
  Starting provider on topic 8e32e857f492...
  [sdk:server] 🐻 Hello from Bare
  [sdk:server] Parsed RPC configuration from arguments
  [sdk:server] Running in desktop mode, connecting to IPC socket:
  /var/folders/27/g0wgmg0d6432ybxcsnzmmr540000gn/T/qvac-worker-46574-modkdw68-3acc.sock
  [sdk:server] Connecting to IPC socket at
  /var/folders/27/g0wgmg0d6432ybxcsnzmmr540000gn/T/qvac-worker-46574-modkdw68-3acc.sock
  [sdk:server] Bare worker started and listening for RPC requests
  [sdk:server] Connected to IPC server
  [sdk:client] ℹ️ No config file found, using SDK defaults
  [sdk:client] 📱 Runtime context: { runtime: 'node', platform: 'darwin' }
  [sdk:client] ✅ Initialization complete
  [sdk:server] 🎲 No seed provided, generating random seed (provider will have random identity)
  [sdk:server] 🌐 Joining topic as server...
  [sdk:server] ✅ Topic announced:
  8e32e857f492791f1431a1c258cd8d4b6b4dcbb47ad8884817001f544a6df5e6
  [sdk:server] 🎯 Ready to accept connections on topic: 8e32e857f492791f...
  PROVIDER_PUBLIC_KEY=f4894375f9afef9c93f5575f1b5f99940f71e5ca0f4f2531f332dfd2fb12addc

  On the other machine, run:
    node scripts/consumer.js f4894375f9afef9c93f5575f1b5f99940f71e5ca0f4f2531f332dfd2fb12addc

  Provider ready. Press Ctrl+C to stop.
  [sdk:server] 📡 New connection established from: bfb14d90b1fbc72b...
  [sdk:server] Loading from registry: unsloth/Llama-3.2-1B-Instruct-GGUF/blob/b69aef112e9f895e6f9
  8d7ae0949f72ff09aa401/Llama-3.2-1B-Instruct-Q4_0.gguf
  [sdk:server] ✅ Model cached with correct size:
  /Users/aleksandrustic/.qvac/models/f2bade0bc5cd4a8c_Llama-3.2-1B-Instruct-Q4_0.gguf
  [sdk:server] ✅ Model already cached and validated:
  /Users/aleksandrustic/.qvac/models/f2bade0bc5cd4a8c_Llama-3.2-1B-Instruct-Q4_0.gguf
  [sdk:server] ✅ Using cached model:
  /Users/aleksandrustic/.qvac/models/f2bade0bc5cd4a8c_Llama-3.2-1B-Instruct-Q4_0.gguf
  [sdk:server] Loaded Model to
  /Users/aleksandrustic/.qvac/models/f2bade0bc5cd4a8c_Llama-3.2-1B-Instruct-Q4_0.gguf
  [sdk:server] llamacpp-completion: Loading model 31b329c97909457e...
  parse: load the model metadata from disk file.
  initFromConfig: load the model from disk file and apply lora adapter, if any.
  common_init_from_model_and_params: added <|end_of_text|> logit bias = -inf
  common_init_from_model_and_params: added <|eom_id|> logit bias = -inf
  common_init_from_model_and_params: added <|eot_id|> logit bias = -inf
  common_init_from_model_and_params: setting dry_penalty_last_n to ctx_size = 1024
  [sdk:server] llamacpp-completion model 31b329c97909457e loaded
  [sdk:server] Local model registered: 31b329c97909457e (LLAMA_3_2_1B_INST_Q4_0) ->
  /Users/aleksandrustic/.qvac/models/f2bade0bc5cd4a8c_Llama-3.2-1B-Instruct-Q4_0.gguf
  [sdk:server] Model 31b329c97909457e unloaded
  [sdk:server] ❌ Connection error for peer bfb14d90b1fbc72b: Error: connection reset by peer
  {code: 'ECONNRESET' }


### Consumer:
  node scripts/consumer.js f4894375f9afef9c93f5575f1b5f99940f71e5ca0f4f2531f332dfd2fb12addc
  Consumer → topic 8e32e857f492..., provider f4894375f9af...
  [sdk:client] Model type "llm" is an alias and will be deprecated. Use "llamacpp-completion"
  instead.
  [sdk:server] 🐻 Hello from Bare
  [sdk:server] Parsed RPC configuration from arguments
  [sdk:server] Running in desktop mode, connecting to IPC socket:
  /tmp/qvac-worker-68860-modm8hzz-2a1a.sock
  [sdk:server] Connecting to IPC socket at /tmp/qvac-worker-68860-modm8hzz-2a1a.sock
  [sdk:server] Bare worker started and listening for RPC requests
  [sdk:client] ℹ️ No config file found, using SDK defaults
  [sdk:client] 📱 Runtime context: { runtime: 'node', platform: 'linux' }
  [sdk:server] Connected to IPC server
  [sdk:client] ✅ Initialization complete
  [sdk:server] 📤 Sending delegated loadModel request to provider:
  f4894375f9afef9c93f5575f1b5f99940f71e5ca0f4f2531f332dfd2fb12addc, timeout: 30000ms
  [sdk:server] 🎲 No seed provided, generating random seed (provider will have random identity)
  [sdk:server] 🔗 Establishing RPC connection to topic:
  8e32e857f492791f1431a1c258cd8d4b6b4dcbb47ad8884817001f544a6df5e6, peer:
  f4894375f9afef9c93f5575f1b5f99940f71e5ca0f4f2531f332dfd2fb12addc, timeout: 30000ms
  [sdk:server] 🍺 New peer connection established:
  f4894375f9afef9c93f5575f1b5f99940f71e5ca0f4f2531f332dfd2fb12addc
    download: 100.0%   [sdk:server] Delegated model registered: 31b329c97909457e -> topic:
  8e32e857f492791f1431a1c258cd8d4b6b4dcbb47ad8884817001f544a6df5e6, provider:
  f4894375f9afef9c93f5575f1b5f99940f71e5ca0f4f2531f332dfd2fb12addc, timeout: 30000ms
  [sdk:server] ✅ Delegated model registered: 31b329c97909457e -> provider:
  f4894375f9afef9c93f5575f1b5f99940f71e5ca0f4f2531f332dfd2fb12addc

    tokensPerSecond: 143.33949162260302,
    cacheTokens: 0,
    backendDevice: 'gpu'
  }
  [sdk:server] Sending delegated unload for model 31b329c97909457e to provider:
  f4894375f9afef9c93f5575f1b5f99940f71e5ca0f4f2531f332dfd2fb12addc
  [sdk:server] Delegated model 31b329c97909457e unloaded on provider
  [sdk:client] 🧹 No models or providers active, automatically closing RPC connection...
  [sdk:client] 🧹 Closing RPC client
  [sdk:client] 🐻🔫 Killing bare worker process
  [sdk:client] 🔌 Closing IPC server
  [sdk:server] 🐻 Bare worker shutdown signal received, cleaning up...
  [sdk:server] 🧹 Cancelling 0 active downloads
  [sdk:server] Unloaded 0 models
  [sdk:server] ✅ Flush completed for topic:
  8e32e857f492791f1431a1c258cd8d4b6b4dcbb47ad8884817001f544a6df5e6
  [sdk:server] ✅ Cleanup completed successfully
  free(): double free detected in tcache 2