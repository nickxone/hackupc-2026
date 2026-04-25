# Reviews Integration

The reviews system lives on a second Autobase and is intentionally much simpler than the payment ledger.

Files:

- `src/reviews/protocol.js`
- `src/reviews/app.js`
- `scripts/review-demo.js`

## What it stores

Each signed review contains:

- `reviewId`
- `txId`
- `targetPublicKey`
- `reviewerPublicKey`
- `stars` from 1 to 5
- `createdAt`
- `signature`

The view stores:

- `review:<reviewId>`
- `user-review:<publicKeyHash>:<reviewId>`
- `reviewer-review:<publicKeyHash>:<reviewId>`

That means reviews are indexed by the reviewed user’s public key.

## App API

`src/reviews/app.js` exports `LocalReviewApp`.

Main methods:

- `buildSignedReview(reviewerName, targetPublicKey, txId, stars)`
- `submitSignedReview(event, { syncNames })`
- `addReview(reviewerName, targetPublicKey, txId, stars)`
- `getReviewsForUser(targetPublicKey)`
- `getAverageStarsForUser(targetPublicKey)`

## Example

```js
const { LocalReviewApp } = require('./src/reviews/app')

const reviews = new LocalReviewApp()
await reviews.addReview('alice', bobPublicKeyPem, txId, 5)
const bobReviews = await reviews.getReviewsForUser(bobPublicKeyPem)
```

## Anti-spam recommendation

Implemented protection:

- only allow one review per completed transfer per reviewer

Current checks:

- the review must reference a settled transfer `txId`
- reviewer must be a participant in that transfer
- target must be the other participant
- reviewer cannot review themselves
- the same reviewer cannot review the same transaction twice

## CLI

Try it yourself with:

```bash
node scripts/reviews-cli.js account create alice
node scripts/reviews-cli.js account create bob
node scripts/reviews-cli.js add alice bob <txId> 5
node scripts/reviews-cli.js list bob
node scripts/reviews-cli.js avg bob
```
