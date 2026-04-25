# P2P Ledger CLI

This is a more realistic local demo for your market idea.

The CLI now sits on top of reusable ledger modules in `src/ledger/`, so the same protocol code can be called from a UI, API server, or future Hyperswarm transport layer.

What it does:

- Creates user accounts as Ed25519 public/private keypairs.
- Stores each private key locally in `.p2p-ledger-demo/accounts/<name>.json`.
- Uses one shared Autobase for everyone.
- Lets senders create signed transfer proposals, but only if their local replayed balance is non-negative and sufficient.
- Lets recipients accept a proposal only if their local replayed view also shows the sender as non-negative and sufficiently funded.
- Finalizes a transfer only when both sides have participated.
- Derives balances by replaying settled ledger entries, not by storing balances.

For this local CLI harness, signed user actions are submitted into the shared base and each peer syncs against it.
That keeps the demo reliable while still modeling the protocol you want to test.

The storage root defaults to:

```bash
.p2p-ledger-demo
```

You can override it with:

```bash
P2P_LEDGER_ROOT=/some/path
```

## Commands

Create accounts:

```bash
node scripts/p2p-ledger-cli.js account create alice
node scripts/p2p-ledger-cli.js account create bob
```

Fund an account from the local faucet:

```bash
node scripts/p2p-ledger-cli.js faucet alice 100
node scripts/p2p-ledger-cli.js faucet bob 40
```

Create a signed transfer proposal:

```bash
node scripts/p2p-ledger-cli.js send alice bob 25 "model payment"
```

See pending proposals for the receiver:

```bash
node scripts/p2p-ledger-cli.js pending bob
```

Accept and finalize:

```bash
node scripts/p2p-ledger-cli.js accept bob <txId>
```

Inspect state:

```bash
node scripts/p2p-ledger-cli.js balances
node scripts/p2p-ledger-cli.js history
```

Quick smoke test:

```bash
node scripts/p2p-ledger-cli.js demo
```

Network simulation:

```bash
npm run ledger:sim
```

## Protocol shape

The shared view stores:

- `account:<accountId>` for registered accounts
- `proposal:<txId>` for signed transfer proposals
- `acceptance:<txId>` for recipient approval
- `entry:<txId>` for settled grant/transfer ledger entries

Settled entries also keep the signatures that authorized them.

`apply()` is idempotent and only processes new messages:

- It verifies signatures.
- It binds an Autobase writer key to an account during registration.
- It stores proposals and acceptances by transaction ID.
- It finalizes a transfer when both proposal and acceptance exist, even if the replayed balance is currently negative.

## Important caveat

This follows your “process new transactions only” rule, which keeps it simple.
Balances are just the replayed sum of settled entries, so they may go negative temporarily until more grants or transfers arrive later.
Locally, though, the CLI refuses to sign new proposals or acceptances when the replayed balance check fails.
