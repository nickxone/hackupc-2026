# Hyperswarm Credit Transfer Merge Guide

This document is for merging the ledger prototype into the main branch, where the Hyperswarm transport is already stable.

The goal is not to copy this demo repo exactly. The goal is to lift the useful ledger pieces into the real networking stack so peers can send credits to each other.

## What To Port

Port these parts from this branch:

- `src/ledger/protocol.js`
- the account/session logic from `src/ledger/app.js`
- the transaction flow from `scripts/p2p-ledger-hyperswarm.js`
- the bootstrap/init flow from `scripts/init-ledger-db.js`

Do not treat the current script as the final architecture. It is a demo harness.

## Core Ledger Model

The important model is:

- each account is an Ed25519 keypair
- the public key deterministically defines the `accountId`
- all meaningful actions are signed before they enter the ledger
- balances are not stored directly
- balances are replayed from settled entries in the Autobase view

There are three signed event types that matter:

1. `register-account`
2. `transfer-proposal`
3. `transfer-acceptance`

A transfer only becomes real when:

- the sender signs a proposal
- the recipient signs an acceptance
- `apply()` sees both and writes `entry:<txId>`

That settled entry is what affects balances.

## Database Initialization

Before any peer can join the shared ledger, the market needs one bootstrap key.

In this branch that is created with:

```bash
npm run ledger:init
```

The reference implementation is:

- `scripts/init-ledger-db.js`

What that init step does:

1. creates a fresh Autobase with `bootstrap = null`
2. reads the resulting Autobase key
3. writes that key into:
   - the local root's `bootstrap.json`
   - `config/market.json` as `ledgerBootstrapKey`

That `ledgerBootstrapKey` is the identity of the market.

If two peers are not using the same bootstrap key, they are not on the same ledger.

### What Claude should preserve

The important rule is not the exact CLI command. The important rule is:

- initialize the shared market once
- persist the resulting bootstrap key
- make every joining peer open Autobase with that exact same key

### How this should look on main

Main probably should not literally keep `npm run ledger:init` as the user-facing workflow.

Instead, Claude should move the same idea into main's existing bootstrap flow, such as:

- room creation
- market creation
- invite creation
- app config provisioning

The clean shape is:

1. market creator initializes the ledger once
2. the app stores the resulting `ledgerBootstrapKey`
3. that key is shared through the app's normal onboarding or invite flow
4. all peers use that key when opening their ledger base

So Claude should treat `scripts/init-ledger-db.js` as the reference for how the first market key is created, not necessarily as the final UX.

## What `protocol.js` Does

`src/ledger/protocol.js` is the main thing Claude should read first.

Important responsibilities:

- create identities
- sign registrations
- sign transfer proposals
- sign transfer acceptances
- verify all signed payloads inside `apply()`
- finalize a transfer once both signatures exist
- replay balances from `entry:*`

Important helper functions:

- `createIdentity()`
- `signRegistration(...)`
- `signTransferProposal(...)`
- `signTransferAcceptance(...)`
- `computeBalance(...)`
- `computeAllBalances(...)`
- `listPendingForRecipient(...)`
- `readHistory(...)`

## Current Demo Transport

Right now `scripts/p2p-ledger-hyperswarm.js` uses two swarm topics:

1. the Autobase replication topic
2. a second signed-event gossip topic

Why the second topic exists:

- plain store replication alone was not enough for a fast hackathon demo
- the gossip topic pushes signed ledger events directly between peers
- that makes separate computers work reliably for the demo

The gossip channel sends JSON lines for:

- signed `register-account`
- signed `transfer-proposal`
- signed `transfer-acceptance`

When a peer receives one, it calls:

- `session.ingestSignedEvent(event)`

That appends the signed event locally and lets Autobase apply it.

## What To Keep In Main

Keep this behavior:

- signed proposal from sender
- signed acceptance from recipient
- replayed balances
- pending proposals derived from view state
- account IDs based on public keys
- Hyperswarm replication for the peer store

Also keep the idea of a signed-event transport path.

That path can stay as:

- a second Hyperswarm topic, or
- an existing application message channel in main, if one already exists

If main already has peer messaging over Hyperswarm, Claude should use that instead of copying this exact second-swarm implementation.

## What Is Demo-Only

These pieces are intentionally hackathon-grade:

- periodic re-announcement of account registration
- `send-id <accountId> ...` as the safest demo path
- some local rebroadcast helpers in `app.js`
- extra resilience logic to make separate demo peers see each other quickly

Claude should treat those as fallback/demo behavior, not as sacred architecture.

## Recommended Main-Branch Integration Shape

If main already has a stable Hyperswarm layer, the clean merge shape is:

1. Keep one ledger module responsible for signing, verifying, and replay.
2. Keep one local account store per device.
3. Open one Autobase/Corestore-backed ledger per peer.
4. Replicate the store on Hyperswarm connection.
5. Send signed ledger events over the app's existing peer messaging layer.
6. On receipt of a signed event, append it locally.
7. Periodically call `base.update()` or do it after incoming messages / replication activity.

In code terms, the main branch likely wants something like:

```js
swarm.on('connection', conn => {
  store.replicate(conn)
})
```

and separately:

```js
peerMessaging.on('ledger-event', async event => {
  await ledger.ingestSignedEvent(event)
})
```

That split is the cleanest mental model:

- replication syncs underlying Autobase/Corestore state
- app messages move signed ledger intents quickly

## Suggested Interface For Main

Claude should probably expose a small ledger service API, not the raw demo session object.

Suggested interface:

- `createOrLoadAccount(name)`
- `getAccountId()`
- `announceAccount()`
- `createTransferProposal({ toAccountId, amount, memo })`
- `acceptTransfer(txId)`
- `ingestSignedEvent(event)`
- `getPendingTransfers()`
- `getBalances()`
- `getHistory()`

That keeps the transport layer separate from ledger rules.

## Sending Credits Flow

Recommended user flow in main:

1. Sender selects recipient.
2. Sender client resolves recipient `accountId`.
3. Sender builds signed `transfer-proposal`.
4. Sender broadcasts that signed event.
5. Recipient sees proposal in `pending`.
6. Recipient approves and signs `transfer-acceptance`.
7. Recipient broadcasts that signed event.
8. Both peers eventually derive the same settled `entry:<txId>`.

## Recipient Resolution

For the demo, `send-id` is the most reliable command because it bypasses name discovery timing.

For main, Claude should ideally use:

- a stable peer identity map already present in the app, or
- a durable profile/account discovery layer

If main already knows how to map a peer to a public key, use that and do not depend on demo-style name gossip.

## Security Notes

The important trust boundaries are:

- only the account owner has the private key
- sender signs the proposal
- recipient signs the acceptance
- `apply()` verifies signatures before writing view state

Unsigned or malformed events should be ignored.

## Files Claude Should Read

Suggested read order for Claude:

1. `src/ledger/protocol.js`
2. `src/ledger/app.js`
3. `scripts/p2p-ledger-hyperswarm.js`

That order matters because:

- `protocol.js` defines the truth
- `app.js` defines the reusable local integration surface
- `p2p-ledger-hyperswarm.js` shows the demo transport glue

## Practical Merge Advice

When merging into main, Claude should:

- preserve the protocol/data model
- adapt transport to main's existing stable Hyperswarm layer
- prefer main's existing peer identity/discovery systems over demo shortcuts
- keep `send-id` or an equivalent fallback during the hackathon if name resolution is not ready

## Current Demo Proof

This branch was tested with two separate long-lived `p2p-ledger-hyperswarm.js` processes.

Successful tested flow:

- Alice and Bob joined the same swarm topic
- Alice sent credits using `send-id <bobAccountId> 25 hello`
- Bob saw the pending transfer
- Bob accepted it
- both peers showed:
  - `alice: 75`
  - `bob: 125`

That is the behavior Claude should preserve while moving the implementation into main.
