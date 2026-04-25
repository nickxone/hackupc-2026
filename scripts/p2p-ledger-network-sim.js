const path = require('path')

const { LocalLedgerApp } = require('../src/ledger/app')
const { SimulatedLedgerNetwork } = require('../src/ledger/network-simulator')

async function main() {
  const rootDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(process.env.P2P_LEDGER_ROOT || '.p2p-ledger-demo')

  const app = new LocalLedgerApp({ rootDir })
  const network = new SimulatedLedgerNetwork(app, {
    minDelayMs: 40,
    maxDelayMs: 140,
    dropRate: 0.05,
    duplicateRate: 0.02,
    peerSyncIntervalMs: 200
  })

  network.on('submitted', event => {
    console.log(`[submitted] ${event.from} ${event.type}${event.txId ? ` ${event.txId}` : ''}`)
  })

  network.on('dropped', event => {
    console.log(`[dropped] ${event.label} after ${event.delayMs}ms`)
  })

  network.on('duplicated', event => {
    console.log(`[duplicated] ${event.label} after ${event.delayMs}ms`)
  })

  await ensureAccount(app, 'alice')
  await ensureAccount(app, 'bob')
  await network.open()
  await network.registerPeer('alice')
  await network.registerPeer('bob')
  network.start()

  const first = await network.run(() => network.buildSignedTransferProposal('alice', 'bob', 25, 'provider-call'))
  await network.submitEvent('alice', first)

  await network.flush(3)

  const bobPending = await network.run(() => network.pending('bob'))
  if (bobPending[0]) {
    await network.submitEvent('bob', await network.run(() => network.buildSignedTransferAcceptance('bob', bobPending[0].txId)))
  }

  await network.flush(4)

  console.log('')
  console.log('Final balances:')
  for (const row of await network.balances()) {
    console.log(`  ${row.name || row.accountId}: ${row.amount}`)
  }

  console.log('')
  console.log('Settled history:')
  for (const entry of await network.history()) {
    console.log(`  ${entry.key} -> ${JSON.stringify(entry.value)}`)
  }

  await network.stop()
}

async function ensureAccount(app, name) {
  try {
    await app.createAccount(name)
  } catch (err) {
    if (!String(err.message).includes('already exists')) throw err
  }
}

main().catch(err => {
  console.error(err.message || err)
  process.exitCode = 1
})
