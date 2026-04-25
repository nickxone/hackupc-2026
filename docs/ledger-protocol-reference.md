# Ledger Protocol Reference

## Modules

- `src/ledger/protocol.js`
- `src/ledger/app.js`
- `src/ledger/network-simulator.js`
- `scripts/p2p-ledger-hyperswarm.js`

## Signed Event Types

### `register-account`

Fields:

- `type`
- `accountId`
- `name`
- `publicKeyPem`
- `writerKey`
- `createdAt`
- `signature`

Signed by:

- account private key

Notes:

- valid registration creates `account:<accountId>`
- valid registration also creates an initial credit entry for that account

### `transfer-proposal`

Fields:

- `type`
- `txId`
- `fromAccount`
- `toAccount`
- `amount`
- `memo`
- `createdAt`
- `senderPublicKeyPem`
- `senderName`
- `senderSignature`

Signed by:

- sender private key

### `transfer-acceptance`

Fields:

- `type`
- `txId`
- `recipientAccount`
- `acceptedAt`
- `recipientPublicKeyPem`
- `recipientName`
- `recipientSignature`

Signed by:

- recipient private key

## Derived View Keys

- `account:<accountId>`
- `proposal:<txId>`
- `acceptance:<txId>`
- `entry:<txId>`
- `status:<txId>`

## Settled Entry Types

### `initial-credit`

Written when a valid `register-account` event is first applied.

Fields:

- `type`
- `txId`
- `toAccount`
- `amount`
- `createdAt`
- `signatures.account`

### `transfer`

Written when both proposal and acceptance exist for the same `txId`.

Fields:

- `type`
- `txId`
- `fromAccount`
- `toAccount`
- `amount`
- `memo`
- `createdAt`
- `acceptedAt`
- `signatures.sender`
- `signatures.recipient`

## Finalized Transfer Rule

A transfer is finalized when:

- `proposal:<txId>` exists
- `acceptance:<txId>` exists
- proposal recipient matches acceptance recipient

Then `entry:<txId>` is written with both signatures attached.

## Balance Rule

Balances are derived by replay:

- `initial-credit` adds to `toAccount`
- `transfer` subtracts from `fromAccount`
- `transfer` adds to `toAccount`

Balances are never the source of truth.

## Important Helpers

From `protocol.js`:

- `createApply()`
- `openLedgerView(...)`
- `createIdentity()`
- `signRegistration(...)`
- `signTransferProposal(...)`
- `signTransferAcceptance(...)`
- `computeBalance(...)`
- `computeAllBalances(...)`
- `findAccountByName(...)`
- `findAccountNameById(...)`
- `listPendingForRecipient(...)`
- `readHistory(...)`
- `shortId(...)`

From `app.js`:

- `createAccount(...)`
- `announceAccount(...)`
- `buildSignedTransferProposal(...)`
- `buildSignedTransferProposalToAccount(...)`
- `buildSignedTransferAcceptance(...)`
- `submitSignedEvent(...)`
- `ingestSignedEvent(...)`
- `proposeTransfer(...)`
- `proposeTransferToAccount(...)`
- `acceptTransfer(...)`
- `pending(...)`
- `balances(...)`
- `history(...)`

## Demo Hyperswarm Notes

The current demo Hyperswarm script uses:

- one topic for store replication
- one topic for signed event gossip

The safest demo command for sending credits is:

- `send-id <toAccountId> <amount> [memo]`

That avoids depending on name discovery timing.
