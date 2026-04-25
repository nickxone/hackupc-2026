const crypto = require('crypto')
const path = require('path')

const { LocalReviewApp } = require('../src/reviews/app')

async function main() {
  const rootDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve('/tmp/p2p-review-protection-test')

  const fakeLedger = {
    async getSettledEntry(txId) {
      if (txId !== 'tx-ok') return null

      return {
        type: 'transfer',
        txId,
        fromAccount: this.aliceId,
        toAccount: this.bobId
      }
    },
    aliceId: null,
    bobId: null
  }

  const app = new LocalReviewApp({ rootDir, ledgerApp: fakeLedger })
  const alice = await app.createAccount('alice')
  const bob = await app.createAccount('bob')

  fakeLedger.aliceId = publicKeyId(alice.publicKeyPem)
  fakeLedger.bobId = publicKeyId(bob.publicKeyPem)

  const created = await app.addReview('alice', bob.publicKeyPem, 'tx-ok', 5)

  let duplicateBlocked = false
  try {
    await app.addReview('alice', bob.publicKeyPem, 'tx-ok', 4)
  } catch (err) {
    duplicateBlocked = /already reviewed/i.test(String(err.message))
  }

  let missingTxBlocked = false
  try {
    await app.addReview('alice', bob.publicKeyPem, 'tx-missing', 5)
  } catch (err) {
    missingTxBlocked = /no settled transfer found/i.test(String(err.message))
  }

  const reviews = await app.getReviewsForUser(bob.publicKeyPem)
  const average = await app.getAverageStarsForUser(bob.publicKeyPem)

  console.log(`Created review: ${created.reviewId}`)
  console.log(`Review count: ${reviews.length}`)
  console.log(`Average: ${average}`)
  console.log(`Duplicate blocked: ${duplicateBlocked}`)
  console.log(`Missing tx blocked: ${missingTxBlocked}`)
}

function publicKeyId(publicKeyPem) {
  return crypto.createHash('sha256').update(publicKeyPem).digest('hex')
}

main().catch(err => {
  console.error(err.message || err)
  process.exitCode = 1
})
