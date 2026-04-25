# Ledger Protocol Reference

## Modules

- `src/ledger/protocol.js`
- `src/ledger/app.js`
- `src/ledger/network-simulator.js`

## Signed event types

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

### `grant`

Fields:

- `type`
- `txId`
- `toAccount`
- `amount`
- `createdAt`
- `authoritySignature`

Signed by:

- authority private key

### `transfer-proposal`

Fields:

- `type`
- `txId`
- `fromAccount`
- `toAccount`
- `amount`
- `memo`
- `createdAt`
- `senderSignature`

Signed by:

- sender private key

### `transfer-acceptance`

Fields:

- `type`
- `txId`
- `recipientAccount`
- `acceptedAt`
- `recipientSignature`

Signed by:

- recipient private key

## Derived view keys

- `account:<accountId>`
- `proposal:<txId>`
- `acceptance:<txId>`
- `entry:<txId>`
- `status:<txId>`

## Finalized transfer rule

A transfer is finalized when:

- `proposal:<txId>` exists
- `acceptance:<txId>` exists
- proposal recipient matches acceptance recipient

Then `entry:<txId>` is written with both signatures attached.

## Important helpers

From `protocol.js`:

- `createApply(...)`
- `openLedgerView(...)`
- `createIdentity()`
- `signRegistration(...)`
- `signGrant(...)`
- `signTransferProposal(...)`
- `signTransferAcceptance(...)`
- `computeBalance(...)`
- `computeAllBalances(...)`
- `listPendingForRecipient(...)`

From `app.js`:

- `createAccount(...)`
- `buildSignedGrant(...)`
- `buildSignedTransferProposal(...)`
- `buildSignedTransferAcceptance(...)`
- `submitSignedEvent(...)`
- `grant(...)`
- `proposeTransfer(...)`
- `acceptTransfer(...)`
- `pending(...)`
- `balances(...)`
- `history(...)`
- `syncPeer(...)`
