const path = require('path')
const readline = require('readline')
const crypto = require('crypto')

const Hyperswarm = require('hyperswarm')
const b4a = require('b4a')

const { LocalLedgerApp } = require('../src/ledger/app')
const protocol = require('../src/ledger/protocol')

async function main() {
  const name = process.argv[2]
  const rootDir = process.argv[3]
    ? path.resolve(process.argv[3])
    : path.resolve(process.env.P2P_LEDGER_ROOT || `.p2p-ledger-${name || 'swarm'}`)

  if (!name) {
    printUsage()
    process.exitCode = 1
    return
  }

  const app = new LocalLedgerApp({ rootDir })
  const session = await app.openSession({ name, backgroundUpdates: true })
  await ensureAccount(session, name)
  const initialAnnouncement = await session.announceAccount(name)

  const peerNode = session.getPeer(name)
  const bootstrap = app.loadBootstrap()
  const topic = b4a.from(bootstrap.key, 'hex')
  const eventsTopic = crypto.createHash('sha256').update(`${bootstrap.key}:events`).digest()
  const swarm = new Hyperswarm()
  const eventSwarm = new Hyperswarm()
  const eventConnections = new Set()
  const announceTimer = setInterval(() => {
    session.announceAccount(name)
      .then(event => broadcastEvent(eventConnections, event))
      .catch(() => {})
  }, 3000)

  swarm.on('connection', conn => {
    console.log('[swarm] connected')
    app.replicateNode(peerNode, conn)
    conn.on('error', err => {
      console.error(`[conn error] ${err.message || err}`)
    })
  })

  eventSwarm.on('connection', conn => {
    console.log('[events] connected')
    eventConnections.add(conn)
    sendEvent(conn, initialAnnouncement)

    let buffer = ''
    conn.on('data', chunk => {
      buffer += chunk.toString()

      while (true) {
        const newlineIndex = buffer.indexOf('\n')
        if (newlineIndex === -1) break

        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (!line) continue

        try {
          const event = JSON.parse(line)
          session.ingestSignedEvent(event).catch(() => {})
        } catch {
        }
      }
    })

    conn.on('close', () => {
      eventConnections.delete(conn)
    })

    conn.on('error', err => {
      console.error(`[event conn error] ${err.message || err}`)
    })
  })

  const discovery = swarm.join(topic, { server: true, client: true })
  const eventDiscovery = eventSwarm.join(eventsTopic, { server: true, client: true })
  await discovery.flushed()
  await eventDiscovery.flushed()

  console.log(`Joined ledger swarm as ${name}`)
  console.log(`Root: ${rootDir}`)
  console.log(`Topic: ${bootstrap.key}`)
  console.log('Type `help` for commands.')

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${name}> `
  })

  rl.prompt()

  rl.on('line', async line => {
    const input = line.trim()
    if (!input) {
      rl.prompt()
      return
    }

    try {
      const shouldExit = await handleCommand({
        session,
        name,
        input,
        eventConnections
      })

      if (shouldExit) {
        rl.close()
        return
      }
    } catch (err) {
      console.error(err.message || err)
    }

    rl.prompt()
  })

  rl.on('close', async () => {
    clearInterval(announceTimer)
    await swarm.destroy().catch(() => {})
    await eventSwarm.destroy().catch(() => {})
    await session.close().catch(() => {})
    process.exit(0)
  })

  process.on('SIGINT', () => rl.close())
}

async function handleCommand({ session, name, input, eventConnections }) {
  const peerNode = session.getPeer(name)
  const [command, ...args] = input.split(' ')

  if (command === 'help') {
    printHelp()
    return false
  }

  if (command === 'quit' || command === 'exit') {
    return true
  }

  if (command === 'send') {
    const toName = args[0]
    const amount = Number.parseInt(args[1], 10)
    const memo = args.slice(2).join(' ')
    if (!toName || !Number.isInteger(amount) || amount <= 0) {
      throw new Error('Usage: send <to> <amount> [memo]')
    }

    const event = await session.proposeTransfer(name, toName, amount, memo)
    broadcastEvent(eventConnections, event)
    console.log(`Created transfer proposal ${event.txId}`)
    return false
  }

  if (command === 'send-id') {
    const toAccountId = args[0]
    const amount = Number.parseInt(args[1], 10)
    const memo = args.slice(2).join(' ')
    if (!toAccountId || !Number.isInteger(amount) || amount <= 0) {
      throw new Error('Usage: send-id <toAccountId> <amount> [memo]')
    }

    const event = await session.proposeTransferToAccount(name, toAccountId, amount, memo)
    broadcastEvent(eventConnections, event)
    console.log(`Created transfer proposal ${event.txId}`)
    return false
  }

  if (command === 'pending') {
    const pending = await session.pending(name)
    if (pending.length === 0) {
      console.log('No pending proposals')
    } else {
      for (const proposal of pending) {
        console.log(`${proposal.txId} | from=${protocol.shortId(proposal.fromAccount)} | amount=${proposal.amount} | memo=${proposal.memo}`)
      }
    }
    return false
  }

  if (command === 'accept') {
    const txId = args[0]
    if (!txId) throw new Error('Usage: accept <txId>')

    const event = await session.acceptTransfer(name, txId)
    broadcastEvent(eventConnections, event)
    console.log(`Accepted ${event.txId}`)
    return false
  }

  if (command === 'balances') {
    const balances = await session.balances()
    for (const row of balances) {
      console.log(`${row.name || protocol.shortId(row.accountId)}: ${row.amount}`)
    }
    return false
  }

  if (command === 'history') {
    const history = await session.history()
    for (const entry of history) {
      console.log(`${entry.key} -> ${JSON.stringify(entry.value)}`)
    }
    return false
  }

  if (command === 'whoami') {
    console.log(`Name: ${name}`)
    console.log(`Account ID: ${peerNode.account.accountId}`)
    return false
  }

  throw new Error(`Unknown command: ${command}`)
}

async function ensureAccount(session, name) {
  try {
    await session.createAccount(name)
  } catch (err) {
    if (!String(err.message).includes('already exists')) throw err
  }
}

function printUsage() {
  console.log('Usage: node scripts/p2p-ledger-hyperswarm.js <name> [rootDir]')
}

function printHelp() {
  console.log('Commands:')
  console.log('  help')
  console.log('  whoami')
  console.log('  send <to> <amount> [memo]')
  console.log('  send-id <toAccountId> <amount> [memo]')
  console.log('  pending')
  console.log('  accept <txId>')
  console.log('  balances')
  console.log('  history')
  console.log('  quit')
}

function broadcastEvent(connections, event) {
  for (const conn of connections) {
    sendEvent(conn, event)
  }
}

function sendEvent(conn, event) {
  try {
    conn.write(`${JSON.stringify(event)}\n`)
  } catch {
  }
}

main().catch(err => {
  console.error(err.message || err)
  process.exitCode = 1
})
