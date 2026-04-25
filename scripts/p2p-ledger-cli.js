const { LocalLedgerApp } = require('../src/ledger/app')
const { shortId } = require('../src/ledger/protocol')

const app = new LocalLedgerApp()

async function main() {
  const [command, ...args] = process.argv.slice(2)

  if (!command || command === 'help' || command === '--help') {
    printHelp()
    return
  }

  if (command === 'account' && args[0] === 'create') {
    const created = await app.createAccount(args[1])
    console.log(`Created account ${args[1]}`)
    console.log(`Account ID: ${created.accountId}`)
    console.log(`Public key fingerprint: ${shortId(created.accountId)}`)
    return
  }

  if (command === 'faucet') {
    const event = await app.grant(args[0], args[1])
    console.log(`Granted ${args[1]} credits to ${args[0]}`)
    console.log(`Grant ID: ${event.txId}`)
    return
  }

  if (command === 'send') {
    const event = await app.proposeTransfer(args[0], args[1], args[2], args.slice(3).join(' '))
    console.log(`Created transfer proposal ${event.txId}`)
    console.log(`From: ${args[0]}`)
    console.log(`To:   ${args[1]}`)
    console.log(`Amount: ${args[2]}`)
    return
  }

  if (command === 'accept') {
    const event = await app.acceptTransfer(args[0], args[1])
    console.log(`Accepted and recorded transaction ${event.txId}`)
    return
  }

  if (command === 'pending') {
    const pending = await app.pending(args[0])
    if (pending.length === 0) {
      console.log('No pending proposals')
      return
    }

    for (const proposal of pending) {
      console.log(`${proposal.txId} | from=${shortId(proposal.fromAccount)} | amount=${proposal.amount} | memo=${proposal.memo}`)
    }
    return
  }

  if (command === 'balances') {
    const balances = await app.balances()
    if (balances.length === 0) {
      console.log('No settled balances yet')
      return
    }

    for (const row of balances) {
      console.log(`${row.name || shortId(row.accountId)}: ${row.amount}`)
    }
    return
  }

  if (command === 'history') {
    const history = await app.history()
    for (const entry of history) {
      console.log(`${entry.key} -> ${JSON.stringify(entry.value)}`)
    }
    return
  }

  if (command === 'watch') {
    await watchCommand(args[0])
    return
  }

  if (command === 'demo') {
    await demoCommand()
    return
  }

  throw new Error(`Unknown command: ${command}`)
}

function printHelp() {
  console.log('P2P ledger CLI')
  console.log('')
  console.log('Commands:')
  console.log('  node scripts/p2p-ledger-cli.js account create <name>')
  console.log('  node scripts/p2p-ledger-cli.js faucet <name> <amount>')
  console.log('  node scripts/p2p-ledger-cli.js send <from> <to> <amount> [memo]')
  console.log('  node scripts/p2p-ledger-cli.js accept <recipient> <txId>')
  console.log('  node scripts/p2p-ledger-cli.js pending <recipient>')
  console.log('  node scripts/p2p-ledger-cli.js balances')
  console.log('  node scripts/p2p-ledger-cli.js history')
  console.log('  node scripts/p2p-ledger-cli.js watch <name>')
  console.log('  node scripts/p2p-ledger-cli.js demo')
}

async function watchCommand(name) {
  const render = async () => {
    await app.syncPeer(name)
    const balances = await app.balances()
    const row = balances.find(entry => entry.name === name)
    const pending = await app.pending(name)

    console.clear()
    console.log(`Watching ${name}`)
    console.log(`Balance: ${row ? row.amount : 0}`)
    console.log('')
    console.log('Pending proposals:')

    if (pending.length === 0) {
      console.log('  none')
      return
    }

    for (const proposal of pending) {
      console.log(`  ${proposal.txId} | from=${shortId(proposal.fromAccount)} | amount=${proposal.amount}`)
    }
  }

  await render()
  const timer = setInterval(() => {
    render().catch(err => console.error(err))
  }, 2000)

  process.on('SIGINT', async () => {
    clearInterval(timer)
    process.exit(0)
  })
}

async function demoCommand() {
  try {
    await app.createAccount('alice')
  } catch {}

  try {
    await app.createAccount('bob')
  } catch {}

  await app.grant('alice', 100)
  await app.grant('bob', 40)
  const proposal = await app.proposeTransfer('alice', 'bob', 25, 'demo-payment')
  await app.acceptTransfer('bob', proposal.txId)

  const balances = await app.balances()
  for (const row of balances) {
    console.log(`${row.name || shortId(row.accountId)}: ${row.amount}`)
  }

  console.log('')
  const history = await app.history()
  for (const entry of history) {
    console.log(`${entry.key} -> ${JSON.stringify(entry.value)}`)
  }
}

main().catch(err => {
  console.error(err.message || err)
  process.exitCode = 1
})
