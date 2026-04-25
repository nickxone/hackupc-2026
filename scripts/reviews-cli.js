const { LocalLedgerApp } = require('../src/ledger/app')
const { LocalReviewApp } = require('../src/reviews/app')

const ledgerApp = new LocalLedgerApp()
const reviewApp = new LocalReviewApp()

async function main() {
  const [command, ...args] = process.argv.slice(2)

  if (!command || command === 'help' || command === '--help') {
    printHelp()
    return
  }

  if (command === 'account' && args[0] === 'create') {
    const account = await reviewApp.createAccount(args[1])
    console.log(`Ready account ${args[1]}`)
    console.log(`Public key:`)
    console.log(account.publicKeyPem.trim())
    return
  }

  if (command === 'add') {
    const [reviewerName, targetName, txId, rawStars] = args
    const target = reviewApp.getAccount(targetName)
    const review = await reviewApp.addReview(reviewerName, target.publicKeyPem, txId, Number.parseInt(rawStars, 10))
    console.log(`Recorded review ${review.reviewId}`)
    console.log(`Transaction: ${review.txId}`)
    return
  }

  if (command === 'list') {
    const target = reviewApp.getAccount(args[0])
    const reviews = await reviewApp.getReviewsForUser(target.publicKeyPem)
    if (reviews.length === 0) {
      console.log('No reviews')
      return
    }

    for (const review of reviews) {
      console.log(`${review.reviewId} | tx=${review.txId} | stars=${review.stars}`)
    }
    return
  }

  if (command === 'avg') {
    const target = reviewApp.getAccount(args[0])
    const average = await reviewApp.getAverageStarsForUser(target.publicKeyPem)
    console.log(average == null ? 'No reviews' : average)
    return
  }

  throw new Error(`Unknown command: ${command}`)
}

function printHelp() {
  console.log('Reviews CLI')
  console.log('')
  console.log('Commands:')
  console.log('  node scripts/reviews-cli.js account create <name>')
  console.log('  node scripts/reviews-cli.js add <reviewer> <target> <txId> <stars>')
  console.log('  node scripts/reviews-cli.js list <target>')
  console.log('  node scripts/reviews-cli.js avg <target>')
}

main().catch(err => {
  console.error(err.message || err)
  process.exitCode = 1
})
