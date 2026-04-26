# Ratings Usage

This repo now has two Autobase-backed ledgers:

- the credit/payment ledger
- a simpler ratings ledger

The ratings ledger is a proof of concept. Ratings are gossip-based and minimally validated. The main goal is that they replicate across peers and can be queried from the local Pear CLI and daemon API.

## What A Rating Targets

Ratings are attached to a peer's `ledgerAccountId`, not their temporary discovery `peerId`.

That matters because:

- `peerId` changes with a discovery session
- `ledgerAccountId` is tied to the user's ledger identity and is more persistent

When you run `pear run . peers`, each peer entry now includes:

- discovery `peerId`
- `ledger account`
- average `rating`

Use the `ledger account` field when rating someone.

## One-Time Init

Initialize the shared market data before testing:

```bash
npm run ledger:init
```

That creates bootstrap data for:

- the payment ledger
- the ratings ledger

and writes both bootstrap keys into `config/market.json`.

## Running A Simple Demo

Terminal 1:

```bash
PEER_NAME=alice pear run . serve
```

Terminal 2:

```bash
PEER_NAME=bob pear run scripts/server.js
```

At this point:

- Alice is the provider
- Bob is running the local daemon and HTTP API on `127.0.0.1:11434`

## Discovering The Provider

From Bob's machine/terminal:

```bash
pear run . peers
```

You should see something like:

```text
- alice (<peerId>)
  ledger account: <ledgerAccountId>
  qvac provider: <providerPublicKey>
  rating: unrated
```

Copy the `ledger account` value.

## Rating A Provider

Submit a rating through the local daemon:

```bash
pear run . rate <ledger-account-id> 5
```

Example:

```bash
pear run . rate 6b7347b34808... 5
```

What happens:

1. the local daemon creates a `rating` event
2. that event is appended to the ratings Autobase
3. the event is gossiped to connected peers over discovery
4. each peer updates its local ratings view

For convenience, if you accidentally pass a visible `peerId`, the daemon will try to resolve it to the matching `ledgerAccountId`. But the intended input is still the ledger account id.

## Viewing Ratings

To see average ratings for all known targets:

```bash
pear run . ratings
```

To see ratings for one target:

```bash
pear run . ratings <ledger-account-id>
```

Example:

```bash
pear run . ratings 6b7347b34808...
```

## HTTP API

If you want to use the daemon API directly:

### Submit a rating

```bash
curl -X POST http://127.0.0.1:11434/api/rate \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "<ledger-account-id>",
    "score": 5
  }'
```

### List all averages

```bash
curl http://127.0.0.1:11434/api/ratings
```

### Get ratings for one target

```bash
curl "http://127.0.0.1:11434/api/ratings?target=<ledger-account-id>"
```

## Current Data Model

Each rating event stores:

- `target`
- `score` from `1` to `5`
- `reviewerName`
- `createdAt`
- `ratingId`

Average ratings are derived by replaying ratings from the Autobase view, similar to how balances are derived from the payment ledger.

## Current Limitations

This is intentionally lightweight for the demo:

- anyone can rate anyone
- ratings are not tied to completed jobs or payments
- there is no anti-spam protection yet
- reviewer identity is only lightly trusted

So this is good for a hackathon demo, but not yet a production reputation system.
