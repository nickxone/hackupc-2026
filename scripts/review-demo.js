const { LocalReviewApp } = require('../src/reviews/app')
const { LocalLedgerApp } = require('../src/ledger/app')

async function main() {
  const ledgerApp = new LocalLedgerApp()
  const reviewApp = new LocalReviewApp()

  await ensureLedgerAccount(ledgerApp, 'alice')
  await ensureLedgerAccount(ledgerApp, 'bob')

  const bob = ledgerApp.getAccount('bob')
  const txId = await findOrCreateTransfer(ledgerApp, bob.accountId)

  await reviewApp.addReview('alice', bob.publicKeyPem, txId, 5)

  let duplicateBlocked = false
  try {
    await reviewApp.addReview('alice', bob.publicKeyPem, txId, 4)
  } catch (err) {
    duplicateBlocked = /already reviewed/i.test(String(err.message))
  }

  const reviews = await reviewApp.getReviewsForUser(bob.publicKeyPem)
  const average = await reviewApp.getAverageStarsForUser(bob.publicKeyPem)

  console.log(`Reviews for bob: ${reviews.length}`)
  console.log(`Average: ${average}`)
  console.log(`Duplicate blocked: ${duplicateBlocked}`)
  for (const review of reviews) {
    console.log(JSON.stringify({
      reviewId: review.reviewId,
      txId: review.txId,
      stars: review.stars,
      reviewerPublicKey: review.reviewerPublicKey,
      targetPublicKey: review.targetPublicKey
    }))
  }
}

async function ensureLedgerAccount(app, name) {
  try {
    await app.createAccount(name)
  } catch (err) {
    if (!String(err.message).includes('already exists')) throw err
  }
}

async function findOrCreateTransfer(app, bobAccountId) {
  const history = await app.history()
  const existing = history
    .map(entry => entry.value)
    .find(entry => entry.type === 'transfer' && entry.toAccount === bobAccountId)

  if (existing) return existing.txId

  await app.grant('alice', 50)
  const proposal = await app.proposeTransfer('alice', 'bob', 10, 'review-demo')
  await app.acceptTransfer('bob', proposal.txId)
  return proposal.txId
}

main().catch(err => {
  console.error(err.message || err)
  process.exitCode = 1
})
