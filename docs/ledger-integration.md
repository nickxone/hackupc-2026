# Ledger Integration Guide

This document explains how the ledger works, what the main modules do, and how to integrate it into another part of the app without having to read all of the source first.

## Goal

The ledger is designed around these ideas:

- the source of truth is an append-only event log
- every meaningful ledger action is signed
- `apply()` only processes signed actions
- balances are derived by replaying settled entries
- local clients can refuse to sign transactions when their own replayed balance check fails
- the shared ledger stays deterministic and idempotent

That makes it a good fit for eventual-consistency P2P systems like Autobase + Hyperswarm.

## File Map

- `src/ledger/protocol.js`
  The protocol rules: signing, verification, `apply()`, replay helpers, and payload shapes.
- `src/ledger/app.js`
  A reusable local app wrapper around the protocol. This is the main integration surface for your team.
- `src/ledger/network-simulator.js`
  A fake network that simulates delayed and imperfect peer sync.
- `scripts/p2p-ledger-cli.js`
  Thin CLI wrapper around `LocalLedgerApp`.
- `scripts/p2p-ledger-network-sim.js`
  Example scenario runner using the network simulator.

## Architecture

There are three layers:

1. Protocol layer
   `src/ledger/protocol.js`
   This defines what a valid ledger action looks like and how the Autobase view is updated.

2. App layer
   `src/ledger/app.js`
   This wraps storage, account loading, Autobase setup, signing decisions, syncing, and helper methods like `balances()` or `pending()`.

3. Transport / orchestration layer
   `src/ledger/network-simulator.js`
   This is where you plug in “how signed events move around.”
   Right now it simulates a network.
   Later this can be replaced by Hyperswarm, WebSockets, HTTP, or another transport.

## Data Model

The derived view stores a few key prefixes:

- `account:<accountId>`
  Registered account metadata.
- `proposal:<txId>`
  A signed transfer proposal from sender to recipient.
- `acceptance:<txId>`
  A signed recipient acceptance for that proposal.
- `entry:<txId>`
  A settled ledger entry.
  This is what counts for balances.
- `status:<txId>`
  Finalization marker.

Only `entry:*` affects balances.

## Event Types

There are four signed event types:

### 1. `register-account`

Used to bind an account public key to:

- `accountId`
- display name
- a writer key

Signed by the account private key.

### 2. `grant`

Used to mint / allocate credits to an account.

Signed by the authority private key.

### 3. `transfer-proposal`

Created by the sender.
Contains:

- `txId`
- `fromAccount`
- `toAccount`
- `amount`
- `memo`
- `createdAt`
- `senderSignature`

### 4. `transfer-acceptance`

Created by the recipient.
Contains:

- `txId`
- `recipientAccount`
- `acceptedAt`
- `recipientSignature`

When both proposal and acceptance exist for the same `txId`, the protocol finalizes a settled `entry:<txId>`.

## Signing Model

All actions are signed before submission.

Helpers live in [src/ledger/protocol.js](/home/faruk/VSCode/hackupc_2026/qvac-test/hackupc-2026/src/ledger/protocol.js:136):

- `createIdentity()`
- `signRegistration(...)`
- `signGrant(...)`
- `signTransferProposal(...)`
- `signTransferAcceptance(...)`

Verification also lives in the protocol module and is used inside `apply()`.

Important consequence:

- unsigned actions are ignored
- malformed signed actions are ignored
- duplicate signed actions are harmless because the view is keyed by `txId` and checks for existing records

## How `apply()` Works

`createApply()` is defined at [src/ledger/protocol.js](/home/faruk/VSCode/hackupc_2026/qvac-test/hackupc-2026/src/ledger/protocol.js:11).

High-level behavior:

1. Read each incoming Autobase node.
2. Check `value.type`.
3. Verify the signature for that event type.
4. Store normalized view records.
5. If proposal and acceptance now both exist, finalize a settled transfer entry.

Important design choice:

- `apply()` only processes signed transactions.
- it does not compute or store balances directly.
- balances are always replayed from settled `entry:*` items.

This keeps the state easy to reason about and easier to port to a real network.

## Finalized Transfer Shape

A settled transfer entry looks like:

```json
{
  "type": "transfer",
  "txId": "some-id",
  "fromAccount": "sender-account-id",
  "toAccount": "recipient-account-id",
  "amount": 25,
  "memo": "provider-call",
  "createdAt": "2026-04-25T14:36:26.486Z",
  "acceptedAt": "2026-04-25T14:36:34.674Z",
  "signatures": {
    "sender": "...",
    "recipient": "..."
  }
}
```

That means downstream code can trust that every settled transfer has both signatures attached.

## Balance Model

Balances are derived, not stored.

Helpers:

- `computeBalance(view, accountId)`
- `computeAllBalances(view)`

These are in [src/ledger/protocol.js](/home/faruk/VSCode/hackupc_2026/qvac-test/hackupc-2026/src/ledger/protocol.js:206).

Replay rules:

- `grant` adds to `toAccount`
- `transfer` subtracts from `fromAccount`
- `transfer` adds to `toAccount`

This means a balance can be recomputed at any time from settled history.

## Local Signing Rules

The local app wrapper adds extra checks before signing.

These checks are in [src/ledger/app.js](/home/faruk/VSCode/hackupc_2026/qvac-test/hackupc-2026/src/ledger/app.js:76) and [src/ledger/app.js](/home/faruk/VSCode/hackupc_2026/qvac-test/hackupc-2026/src/ledger/app.js:104).

Current rule:

- sender refuses to sign if replayed balance is negative
- sender refuses to sign if replayed balance is less than transfer amount
- recipient refuses to sign acceptance under the same conditions from their local replayed view

This is a client-side signing policy.
It is intentionally separate from `apply()`.

Why this matters:

- local clients can be strict
- the shared ledger logic stays simple and deterministic
- later you can change signing policy without rewriting the ledger storage model

## Main Integration Surface

Most teammates should integrate through `LocalLedgerApp` from [src/ledger/app.js](/home/faruk/VSCode/hackupc_2026/qvac-test/hackupc-2026/src/ledger/app.js:10).

### Best methods for app integration

- `createAccount(name)`
- `buildSignedGrant(name, amount)`
- `buildSignedTransferProposal(fromName, toName, amount, memo)`
- `buildSignedTransferAcceptance(name, txId)`
- `submitSignedEvent(event, { syncNames })`
- `pending(name)`
- `balances()`
- `history()`
- `syncPeer(name)`

### Recommended usage pattern

If you are building a UI or API:

1. Use `buildSignedTransferProposal(...)` when a user presses “Send”.
2. Send that signed payload through your transport layer.
3. On receipt, call `submitSignedEvent(...)`.
4. For recipients, read `pending(name)`.
5. When the recipient approves, call `buildSignedTransferAcceptance(...)`.
6. Send that signed acceptance through the transport layer.
7. Submit it with `submitSignedEvent(...)`.
8. Use `balances()` or `history()` to render state.

## Example Integration

### Create an account

```js
const { LocalLedgerApp } = require('./src/ledger/app')

const app = new LocalLedgerApp()
const account = await app.createAccount('alice')
console.log(account)
```

### Build and submit a signed proposal

```js
const proposal = await app.buildSignedTransferProposal('alice', 'bob', 25, 'model payment')

// In a real app, send this over the network
await app.submitSignedEvent(proposal, { syncNames: ['alice', 'bob'] })
```

### Build and submit a signed acceptance

```js
const acceptance = await app.buildSignedTransferAcceptance('bob', proposal.txId)

// In a real app, send this over the network
await app.submitSignedEvent(acceptance, { syncNames: ['bob', 'alice'] })
```

### Read balances

```js
const balances = await app.balances()
console.log(balances)
```

## How to Replace the Current “Authority Relay”

Right now `LocalLedgerApp` uses a local authority/base store as the shared place where signed events are appended.

That is good for:

- local testing
- CLI use
- team integration before real networking

In a real P2P app, the part you would replace is mostly submission + sync orchestration, not protocol logic.

The protocol module can stay mostly unchanged.

What would change:

- instead of `submitSignedEvent(...)` appending locally and syncing peers, your transport receives signed events from the network
- each peer appends received signed events into its own Autobase instance
- peer replication is done with Hyperswarm instead of the local sync helper

So the important takeaway is:

- `protocol.js` is the portable part
- `app.js` is the convenience wrapper
- transport is the swappable part

## Network Simulator

The simulator is in [src/ledger/network-simulator.js](/home/faruk/VSCode/hackupc_2026/qvac-test/hackupc-2026/src/ledger/network-simulator.js:1).

It simulates:

- random sync delay
- jitter
- dropped sync attempts
- duplicate deliveries
- periodic peer update attempts

Important design detail:

- signed event creation is reliable
- signed event submission is reliable
- the flaky part is peer sync / gossip timing

That makes it much more useful for app integration than randomly losing user actions.

Run it with:

```bash
npm run ledger:sim
```

Or:

```bash
node scripts/p2p-ledger-network-sim.js /tmp/my-sim
```

## Suggested Team Integration Strategy

If different teammates are working on different pieces, I’d recommend:

### Frontend / API team

- call `LocalLedgerApp` methods directly for now
- use `buildSignedTransferProposal` and `buildSignedTransferAcceptance`
- treat the returned objects as your transport payloads

### Networking team

- keep the payload format from `protocol.js`
- replace the local submit/sync flow with Hyperswarm delivery
- keep the same signed event objects

### Ledger / state team

- keep `protocol.js` as the canonical definition of validity
- extend `apply()` with new signed event types if needed

## Common Extension Ideas

This structure should make these additions straightforward:

- invoices / payment requests
- escrow events
- receipts for prompt completion
- multi-hop settlement
- dispute or cancellation events
- per-provider pricing metadata
- transaction expiration

The safest way to extend the system is:

1. define a new signed event type
2. verify it in `apply()`
3. store a normalized record in the view
4. derive any higher-level state from replay

## Caveats

- Balances are replayed from settled entries, so they are only as current as the logs a peer has seen.
- Local signing checks are not a global consensus rule.
- The current code is good for a prototype and team integration, not a final production ledger.
- Concurrent spending and stronger conflict resolution will still need more thought if you go beyond hackathon scope.

## Quick Commands

CLI demo:

```bash
npm run ledger:cli -- demo
```

Manual CLI:

```bash
node scripts/p2p-ledger-cli.js account create alice
node scripts/p2p-ledger-cli.js account create bob
node scripts/p2p-ledger-cli.js faucet alice 100
node scripts/p2p-ledger-cli.js send alice bob 25 "model payment"
node scripts/p2p-ledger-cli.js pending bob
node scripts/p2p-ledger-cli.js accept bob <txId>
node scripts/p2p-ledger-cli.js balances
```

Network simulation:

```bash
npm run ledger:sim
```
