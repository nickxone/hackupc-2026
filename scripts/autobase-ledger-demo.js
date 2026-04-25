const path = require('path')
const os = require('os')

const Corestore = require('corestore')
const Autobase = require('autobase')
const b4a = require('b4a')

const storageRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(os.tmpdir(), `autobase-ledger-demo-${Date.now()}`)

async function main() {
  const aliceStore = new Corestore(path.join(storageRoot, 'alice'))
  const bobStore = new Corestore(path.join(storageRoot, 'bob'))

  const alice = new Autobase(aliceStore, null, {
    open,
    apply,
    valueEncoding: 'json'
  })

  await alice.ready()

  const bob = new Autobase(bobStore, alice.key, {
    open,
    apply,
    valueEncoding: 'json'
  })

  await bob.ready()

  const aliceReplication = aliceStore.replicate(true)
  const bobReplication = bobStore.replicate(false)
  aliceReplication.pipe(bobReplication).pipe(aliceReplication)

  console.log(`Storage: ${storageRoot}`)
  console.log(`Base key: ${alice.key.toString('hex')}`)
  console.log(`Alice writer key: ${alice.local.key.toString('hex')}`)
  console.log(`Bob writer key:   ${bob.local.key.toString('hex')}`)
  console.log('')

  await alice.append({
    type: 'add-writer',
    writer: bob.local.key.toString('hex'),
    name: 'bob'
  })

  await sync([alice, bob])

  await alice.append({
    type: 'grant',
    account: 'alice',
    amount: 100,
    note: 'Initial hackathon credits'
  })

  await alice.append({
    type: 'grant',
    account: 'bob',
    amount: 40,
    note: 'Initial provider credits'
  })

  await sync([alice, bob])

  await bob.append({
    type: 'transfer',
    from: 'bob',
    to: 'alice',
    amount: 15,
    note: 'Bob pays Alice for one prompt'
  })

  await bob.append({
    type: 'transfer',
    from: 'alice',
    to: 'bob',
    amount: 8,
    note: 'Alice pays Bob for model usage'
  })

  await sync([alice, bob])

  console.log('Ledger entries from Alice view:')
  await printLedger(alice.view)
  console.log('')

  console.log('Ledger entries from Bob view:')
  await printLedger(bob.view)
  console.log('')

  console.log('Computed balances from Alice view:')
  await printBalances(await computeBalances(alice.view))
  console.log('')

  console.log('Computed balances from Bob view:')
  await printBalances(await computeBalances(bob.view))
}

function open(store) {
  return store.get('ledger-log', { valueEncoding: 'json' })
}

async function apply(nodes, view, host) {
  const balances = await computeBalances(view)

  for (const node of nodes) {
    if (!node || node.value == null) continue

    const value = node.value

    if (value.type === 'add-writer') {
      await host.addWriter(b4a.from(value.writer, 'hex'), { indexer: true })
      continue
    }

    if (value.type === 'grant') {
      assertAccount(value.account)
      assertAmount(value.amount)

      balances.set(value.account, (balances.get(value.account) || 0) + value.amount)

      await view.append({
        type: 'grant',
        account: value.account,
        amount: value.amount,
        note: value.note || '',
        by: node.from.key.toString('hex')
      })
      continue
    }

    if (value.type === 'transfer') {
      assertAccount(value.from)
      assertAccount(value.to)
      assertAmount(value.amount)

      const fromBalance = balances.get(value.from) || 0
      if (fromBalance < value.amount) {
        throw new Error(`Transfer would overdraw ${value.from}: ${fromBalance} < ${value.amount}`)
      }

      balances.set(value.from, fromBalance - value.amount)
      balances.set(value.to, (balances.get(value.to) || 0) + value.amount)

      await view.append({
        type: 'transfer',
        from: value.from,
        to: value.to,
        amount: value.amount,
        note: value.note || '',
        by: node.from.key.toString('hex')
      })
      continue
    }

    throw new Error(`Unknown command type: ${value.type}`)
  }
}

async function sync(bases, rounds = 6) {
  for (let i = 0; i < rounds; i++) {
    await Promise.all(bases.map(base => base.update()))
    await sleep(25)
  }
}

async function printLedger(view) {
  for (let i = 0; i < view.length; i++) {
    console.log(`  ${i}: ${JSON.stringify(await view.get(i))}`)
  }
}

async function computeBalances(view) {
  const balances = new Map()

  for (let i = 0; i < view.length; i++) {
    const entry = await view.get(i)

    if (entry.type === 'grant') {
      balances.set(entry.account, (balances.get(entry.account) || 0) + entry.amount)
      continue
    }

    if (entry.type === 'transfer') {
      balances.set(entry.from, (balances.get(entry.from) || 0) - entry.amount)
      balances.set(entry.to, (balances.get(entry.to) || 0) + entry.amount)
    }
  }

  return balances
}

async function printBalances(balances) {
  for (const [account, amount] of [...balances.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${account}: ${amount}`)
  }
}

function assertAccount(account) {
  if (typeof account !== 'string' || account.length === 0) {
    throw new Error(`Invalid account: ${account}`)
  }
}

function assertAmount(amount) {
  if (!Number.isInteger(amount)) {
    throw new Error(`Invalid amount: ${amount}`)
  }
  if (amount < 0) {
    console.log("found negative amount, sync issue ocurred")
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
