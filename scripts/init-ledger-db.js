const fs = require('fs')
const path = require('path')

const Autobase = require('autobase')
const Corestore = require('corestore')

const { MARKET_CONFIG_FILE, saveLedgerBootstrapKey } = require('../src/ledger/config')
const protocol = require('../src/ledger/protocol')

async function main() {
  const rootDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(process.env.P2P_LEDGER_ROOT || '.p2p-ledger-demo')

  const accountsDir = path.join(rootDir, 'accounts')
  const peersDir = path.join(rootDir, 'peers')
  const bootstrapDir = path.join(rootDir, 'bootstrap')
  const bootstrapFile = path.join(rootDir, 'bootstrap.json')

  fs.mkdirSync(rootDir, { recursive: true })
  fs.mkdirSync(accountsDir, { recursive: true })
  fs.mkdirSync(peersDir, { recursive: true })
  fs.mkdirSync(bootstrapDir, { recursive: true })

  const { key, repairedFrom } = await initializeBootstrapStore(bootstrapDir)

  writeJson(bootstrapFile, { key })
  saveLedgerBootstrapKey(key)

  console.log(`Initialized ledger database in ${rootDir}`)
  console.log(`Bootstrap key: ${key}`)
  console.log(`Updated market config in ${MARKET_CONFIG_FILE}`)
  console.log(`Wrote ${bootstrapFile}`)
  if (repairedFrom) {
    console.log(`Backed up broken bootstrap store to ${repairedFrom}`)
  }
}

async function initializeBootstrapStore(bootstrapDir) {
  try {
    return { key: await readOrCreateBootstrapKey(bootstrapDir), repairedFrom: null }
  } catch (err) {
    if (!isMovedUnsafelyError(err)) throw err

    const repairedFrom = `${bootstrapDir}.corrupt-${Date.now()}`
    fs.renameSync(bootstrapDir, repairedFrom)
    fs.mkdirSync(bootstrapDir, { recursive: true })
    return {
      key: await readOrCreateBootstrapKey(bootstrapDir),
      repairedFrom
    }
  }
}

async function readOrCreateBootstrapKey(bootstrapDir) {
  const store = new Corestore(bootstrapDir)
  const base = new Autobase(store, null, {
    open: protocol.openLedgerView,
    apply: protocol.createApply(),
    valueEncoding: 'json',
    optimistic: true
  })

  try {
    await base.ready()
    return base.key.toString('hex')
  } finally {
    await base.close().catch(() => {})
    await store.close().catch(() => {})
  }
}

function isMovedUnsafelyError(err) {
  return String(err && err.message || err).includes('Invalid device file, was moved unsafely')
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2))
}

main().catch(err => {
  console.error(err.message || err)
  process.exitCode = 1
})
