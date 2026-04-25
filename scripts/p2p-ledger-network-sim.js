const path = require('path')

const { LocalLedgerApp } = require('../src/ledger/app')
const { SimulatedLedgerNetwork } = require('../src/ledger/network-simulator')

async function main() {
  const rootDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(process.env.P2P_LEDGER_ROOT || '.p2p-ledger-sim')

  const app = new LocalLedgerApp({ rootDir })
  const network = new SimulatedLedgerNetwork(app, {
    minDelayMs: 60,
    maxDelayMs: 300,
    dropRate: 0.15,
    duplicateRate: 0.1,
    peerSyncIntervalMs: 200
  })

  network.on('submitted', event => {
    console.log(`[submitted] ${event.type}${event.txId ? ` ${event.txId}` : ''}`)
  })

  network.on('dropped', event => {
    console.log(`[dropped] ${event.label} after ${event.delayMs}ms`)
  })

  network.on('duplicated', event => {
    console.log(`[duplicated] ${event.label} after ${event.delayMs}ms`)
  })

  await ensureAccount(app, 'alice')
  await ensureAccount(app, 'bob')
  await ensureAccount(app, 'charlie')

  network.registerPeer('alice')
  network.registerPeer('bob')
  network.registerPeer('charlie')
  network.start()

  await network.submitEvent(await network.run(() => app.buildSignedGrant('alice', 120)))
  await network.submitEvent(await network.run(() => app.buildSignedGrant('bob', 30)))
  await network.submitEvent(await network.run(() => app.buildSignedGrant('charlie', 15)))

  const first = await network.run(() => app.buildSignedTransferProposal('alice', 'bob', 25, 'provider-call'))
  await network.submitEvent(first)

  const second = await network.run(() => app.buildSignedTransferProposal('bob', 'charlie', 10, 'routing-fee'))
  await network.submitEvent(second)

  await network.flush(3)

  const bobPending = await network.run(() => app.pending('bob'))
  if (bobPending[0]) {
    await network.submitEvent(await network.run(() => app.buildSignedTransferAcceptance('bob', bobPending[0].txId)))
  }

  await network.flush(3)

  const charliePending = await network.run(() => app.pending('charlie'))
  if (charliePending[0]) {
    await network.submitEvent(await network.run(() => app.buildSignedTransferAcceptance('charlie', charliePending[0].txId)))
  }

  await network.flush(4)
  await network.stop()

  console.log('')
  console.log('Final balances:')
  for (const row of await app.balances()) {
    console.log(`  ${row.name || row.accountId}: ${row.amount}`)
  }

  console.log('')
  console.log('Settled history:')
  for (const entry of await app.history()) {
    console.log(`  ${entry.key} -> ${JSON.stringify(entry.value)}`)
  }
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
