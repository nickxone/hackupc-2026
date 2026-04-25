const fs = require('fs')
const path = require('path')

const Autobase = require('autobase')
const Corestore = require('corestore')
const b4a = require('b4a')

const { getLedgerBootstrapKey } = require('./config')
const protocol = require('./protocol')

class LocalLedgerApp {
  constructor({
    rootDir = path.resolve(process.env.P2P_LEDGER_ROOT || '.p2p-ledger-demo'),
    backgroundUpdateIntervalMs = 1000
  } = {}) {
    this.rootDir = rootDir
    this.backgroundUpdateIntervalMs = backgroundUpdateIntervalMs
    this.accountsDir = path.join(rootDir, 'accounts')
    this.peersDir = path.join(rootDir, 'peers')
    this._backgroundNode = null
    this._backgroundTimer = null
    this._backgroundUpdateInFlight = false
  }

  async ensureReady() {
    fs.mkdirSync(this.rootDir, { recursive: true })
    fs.mkdirSync(this.accountsDir, { recursive: true })
    fs.mkdirSync(this.peersDir, { recursive: true })
    await this.ensureBootstrapBase()
  }

  async createAccount(name) {
    const session = await this.openSession({ name })
    try {
      return await session.createAccount(name)
    } finally {
      await session.close()
    }
  }

  async buildSignedTransferProposal(fromName, toName, amount, memo = '') {
    const session = await this.openSession({ name: fromName })
    try {
      return await session.buildSignedTransferProposal(fromName, toName, amount, memo)
    } finally {
      await session.close()
    }
  }

  async buildSignedTransferProposalToAccount(fromName, toAccountId, amount, memo = '') {
    const session = await this.openSession({ name: fromName })
    try {
      return await session.buildSignedTransferProposalToAccount(fromName, toAccountId, amount, memo)
    } finally {
      await session.close()
    }
  }

  async buildSignedTransferAcceptance(name, txId) {
    const session = await this.openSession({ name })
    try {
      return await session.buildSignedTransferAcceptance(name, txId)
    } finally {
      await session.close()
    }
  }

  async announceAccount(name) {
    const session = await this.openSession({ name })
    try {
      return await session.announceAccount(name)
    } finally {
      await session.close()
    }
  }

  async ingestSignedEvent(name, event) {
    const session = await this.openSession({ name })
    try {
      await session.ingestSignedEvent(event)
    } finally {
      await session.close()
    }
  }

  async submitSignedEvent(name, event) {
    const session = await this.openSession({ name })
    try {
      await session.submitSignedEvent(name, event)
    } finally {
      await session.close()
    }
  }

  async proposeTransfer(fromName, toName, amount, memo = '') {
    const session = await this.openSession({ name: fromName })
    try {
      return await session.proposeTransfer(fromName, toName, amount, memo)
    } finally {
      await session.close()
    }
  }

  async proposeTransferToAccount(fromName, toAccountId, amount, memo = '') {
    const session = await this.openSession({ name: fromName })
    try {
      return await session.proposeTransferToAccount(fromName, toAccountId, amount, memo)
    } finally {
      await session.close()
    }
  }

  async acceptTransfer(name, txId) {
    const session = await this.openSession({ name })
    try {
      return await session.acceptTransfer(name, txId)
    } finally {
      await session.close()
    }
  }

  async pending(name) {
    const session = await this.openSession({ name })
    try {
      return await session.pending(name)
    } finally {
      await session.close()
    }
  }

  async balances() {
    const session = await this.openSession()
    try {
      return await session.balances()
    } finally {
      await session.close()
    }
  }

  async history() {
    const session = await this.openSession()
    try {
      return await session.history()
    } finally {
      await session.close()
    }
  }

  async openSession({ name = null, backgroundUpdates = false } = {}) {
    await this.ensureReady()
    const session = new LedgerSession(this)
    await session.open({ name, backgroundUpdates })
    return session
  }

  replicateNode(node, connection) {
    return node.store.replicate(connection)
  }

  connectNodes(leftNode, rightNode) {
    const leftConnection = leftNode.store.replicate(true)
    const rightConnection = rightNode.store.replicate(false)
    leftConnection.pipe(rightConnection).pipe(leftConnection)
    return { leftConnection, rightConnection }
  }

  closeConnection(connection) {
    if (!connection) return
    connection.leftConnection?.destroy()
    connection.rightConnection?.destroy()
  }

  async settleNodes(nodes, rounds = 16, delayMs = 30) {
    for (let i = 0; i < rounds; i++) {
      await Promise.all(nodes.map(node => node.base.update()))
      await sleep(delayMs)
    }
  }

  async refreshNode(node, rounds = 2, delayMs = 50) {
    await this.settleNodes([node], rounds, delayMs)
  }

  async openPeer(name) {
    assertName(name)
    await this.ensureReady()

    const account = this.loadAccount(name)
    const store = new Corestore(account.peerDir)
    const bootstrap = this.loadBootstrap()

    const base = new Autobase(store, b4a.from(bootstrap.key, 'hex'), {
      open: protocol.openLedgerView,
      apply: protocol.createApply(),
      valueEncoding: 'json',
      optimistic: true
    })

    await base.ready()
    return { name, account, store, base }
  }

  async closeNode(node) {
    if (!node) return
    if (this._backgroundNode === node) {
      this.stopBackgroundUpdates()
    }
    await node.base.close()
    await node.store.close()
  }

  async ensureBootstrapBase() {
    const configuredKey = getLedgerBootstrapKey()
    const legacyBootstrapFile = path.join(this.rootDir, 'bootstrap.json')
    if (fs.existsSync(legacyBootstrapFile)) {
      const legacy = loadJson(legacyBootstrapFile)
      if (legacy.key !== configuredKey) {
        throw new Error(`bootstrap.json key does not match configured market key: ${legacy.key}`)
      }
      return this.loadBootstrap()
    }

    writeJson(legacyBootstrapFile, { key: configuredKey })
    return this.loadBootstrap()
  }

  loadBootstrap() {
    return { key: getLedgerBootstrapKey() }
  }

  loadAccount(name) {
    return loadJson(this.accountFile(name))
  }

  accountFile(name) {
    return path.join(this.accountsDir, `${name}.json`)
  }

  listLocalAccountNames() {
    if (!fs.existsSync(this.accountsDir)) return []

    return fs.readdirSync(this.accountsDir)
      .filter(file => file.endsWith('.json'))
      .map(file => path.basename(file, '.json'))
      .sort()
  }

  async resolveAccountByName(name, view) {
    if (fs.existsSync(this.accountFile(name))) {
      return this.loadAccount(name)
    }

    const account = await protocol.findAccountByName(view, name)
    if (!account) {
      throw new Error(`Unknown account: ${name}`)
    }

    return account
  }

  startBackgroundUpdates(node) {
    if (!this.backgroundUpdateIntervalMs || this.backgroundUpdateIntervalMs <= 0 || !node) {
      return node
    }

    if (this._backgroundNode === node && this._backgroundTimer) {
      return node
    }

    this.stopBackgroundUpdates()
    this._backgroundNode = node
    this._backgroundTimer = setInterval(async () => {
      if (!this._backgroundNode || this._backgroundUpdateInFlight) return

      this._backgroundUpdateInFlight = true
      try {
        await this._backgroundNode.base.update()
      } catch {
      } finally {
        this._backgroundUpdateInFlight = false
      }
    }, this.backgroundUpdateIntervalMs)

    return node
  }

  stopBackgroundUpdates() {
    if (this._backgroundTimer) clearInterval(this._backgroundTimer)
    this._backgroundTimer = null
    this._backgroundNode = null
    this._backgroundUpdateInFlight = false
  }
}

class LedgerSession {
  constructor(app) {
    this.app = app
    this.primaryPeerName = null
    this.peerNodes = new Map()
    this.peerConnections = new Map()
    this.backgroundUpdates = false
  }

  async open({ name = null, backgroundUpdates = false } = {}) {
    this.backgroundUpdates = Boolean(backgroundUpdates)
    const localNames = this.app.listLocalAccountNames()

    if (name) {
      this.primaryPeerName = name
      if (fs.existsSync(this.app.accountFile(name))) {
        const peer = await this.ensurePeer(name)
        this.primaryPeerName = peer.name
      }
    } else if (localNames[0]) {
      const peer = await this.ensurePeer(localNames[0])
      this.primaryPeerName = peer.name
    }

    for (const localName of localNames) {
      if (localName === name) continue
      await this.ensurePeer(localName)
    }

    if (this.backgroundUpdates) {
      this.app.startBackgroundUpdates(this.getPrimaryPeer())
    }

    return this
  }

  async close() {
    for (const connection of this.peerConnections.values()) {
      this.app.closeConnection(connection)
    }
    this.peerConnections.clear()

    for (const peer of this.peerNodes.values()) {
      await this.app.closeNode(peer)
    }
    this.peerNodes.clear()

    if (this.backgroundUpdates) {
      this.app.stopBackgroundUpdates()
    }
  }

  async ensurePeer(name) {
    assertName(name)

    if (this.peerNodes.has(name)) {
      return this.peerNodes.get(name)
    }

    const peer = await this.app.openPeer(name)
    this.peerNodes.set(name, peer)

    for (const [otherName, otherPeer] of this.peerNodes.entries()) {
      if (otherName === name) continue

      const connectionKey = pairKey(name, otherName)
      if (this.peerConnections.has(connectionKey)) continue

      const connection = this.app.connectNodes(peer, otherPeer)
      this.peerConnections.set(connectionKey, connection)
    }

    await this.syncOpenPeers()
    await this.rebroadcastKnownAccounts()

    return peer
  }

  getPeer(name) {
    return this.peerNodes.get(name) || null
  }

  getPrimaryPeer() {
    if (this.primaryPeerName && this.peerNodes.has(this.primaryPeerName)) {
      return this.peerNodes.get(this.primaryPeerName)
    }

    const firstPeer = this.peerNodes.values().next().value || null
    if (firstPeer) {
      this.primaryPeerName = firstPeer.name
    }

    return firstPeer
  }

  async ensureReaderPeer(preferredName = null) {
    if (preferredName) {
      const peer = await this.ensurePeer(preferredName)
      this.primaryPeerName = peer.name
      return peer
    }

    const existing = this.getPrimaryPeer()
    if (existing) return existing

    const localNames = this.app.listLocalAccountNames()
    if (!localNames[0]) return null

    const peer = await this.ensurePeer(localNames[0])
    this.primaryPeerName = peer.name
    return peer
  }

  async syncOpenPeers(rounds = 8, delayMs = 30) {
    const peers = [...this.peerNodes.values()]
    if (peers.length === 0) return
    await this.app.settleNodes(peers, rounds, delayMs)
  }

  async createAccount(name) {
    this.app.createLocalAccount(name)

    const peer = await this.ensurePeer(name)
    const existing = await peer.base.view.get(`account:${peer.account.accountId}`)

    if (!existing) {
      await this.announceAccount(name)
      await this.syncOpenPeers()
    }

    if (!this.primaryPeerName) {
      this.primaryPeerName = name
    }

    if (this.backgroundUpdates && this.getPrimaryPeer()) {
      this.app.startBackgroundUpdates(this.getPrimaryPeer())
    }

    return { name, accountId: peer.account.accountId }
  }

  async announceAccount(name) {
    const peer = await this.ensurePeer(name)
    this.primaryPeerName = peer.name
    const registration = protocol.signRegistration(peer.account, peer.account.name, peer.base.local.key.toString('hex'))
    await this.broadcastSignedEvent(registration)
    await this.syncOpenPeers()
    return registration
  }

  async buildSignedTransferProposal(fromName, toName, amount, memo = '') {
    assertName(fromName)
    assertName(toName)
    const parsedAmount = parsePositiveInt(amount, 'amount')

    const sender = await this.ensurePeer(fromName)
    this.primaryPeerName = sender.name
    await this.syncOpenPeers()

    const senderBalance = await protocol.computeBalance(sender.base.view, sender.account.accountId)
    if (senderBalance < 0) {
      throw new Error(`Sender balance is negative, refusing to sign: ${senderBalance}`)
    }
    if (senderBalance < parsedAmount) {
      throw new Error(`Sender has insufficient funds, refusing to sign: ${senderBalance} < ${parsedAmount}`)
    }

    const recipient = await this.app.resolveAccountByName(toName, sender.base.view)
    return protocol.signTransferProposal(sender.account, recipient.accountId, parsedAmount, memo)
  }

  async buildSignedTransferProposalToAccount(fromName, toAccountId, amount, memo = '') {
    assertName(fromName)
    assertRequired(toAccountId, 'toAccountId')
    const parsedAmount = parsePositiveInt(amount, 'amount')

    const sender = await this.ensurePeer(fromName)
    this.primaryPeerName = sender.name
    await this.syncOpenPeers()

    const senderBalance = await protocol.computeBalance(sender.base.view, sender.account.accountId)
    if (senderBalance < 0) {
      throw new Error(`Sender balance is negative, refusing to sign: ${senderBalance}`)
    }
    if (senderBalance < parsedAmount) {
      throw new Error(`Sender has insufficient funds, refusing to sign: ${senderBalance} < ${parsedAmount}`)
    }

    return protocol.signTransferProposal(sender.account, toAccountId, parsedAmount, memo)
  }

  async buildSignedTransferAcceptance(name, txId) {
    assertName(name)
    assertRequired(txId, 'txId')

    const peer = await this.ensurePeer(name)
    this.primaryPeerName = peer.name
    await this.syncOpenPeers()

    const proposal = await peer.base.view.get(`proposal:${txId}`)
    if (!proposal) throw new Error(`Unknown proposal: ${txId}`)
    if (proposal.value.toAccount !== peer.account.accountId) {
      throw new Error('This account is not the recipient for that transaction')
    }

    const finalized = await peer.base.view.get(`entry:${txId}`)
    if (finalized) {
      throw new Error(`Transaction already finalized: ${txId}`)
    }

    const senderBalance = await protocol.computeBalance(peer.base.view, proposal.value.fromAccount)
    if (senderBalance < 0) {
      throw new Error(`Recipient sees sender balance is negative, refusing to sign: ${senderBalance}`)
    }
    if (senderBalance < proposal.value.amount) {
      throw new Error(`Recipient sees insufficient sender funds, refusing to sign: ${senderBalance} < ${proposal.value.amount}`)
    }

    return protocol.signTransferAcceptance(peer.account, txId)
  }

  async submitSignedEvent(name, event) {
    const peer = await this.ensurePeer(name)
    this.primaryPeerName = peer.name
    await this.broadcastSignedEvent(event)
    await this.syncOpenPeers()
  }

  async proposeTransfer(fromName, toName, amount, memo = '') {
    const event = await this.buildSignedTransferProposal(fromName, toName, amount, memo)
    await this.submitSignedEvent(fromName, event)
    return event
  }

  async proposeTransferToAccount(fromName, toAccountId, amount, memo = '') {
    const event = await this.buildSignedTransferProposalToAccount(fromName, toAccountId, amount, memo)
    await this.submitSignedEvent(fromName, event)
    return event
  }

  async acceptTransfer(name, txId) {
    const event = await this.buildSignedTransferAcceptance(name, txId)
    await this.submitSignedEvent(name, event)
    return event
  }

  async pending(name) {
    const peer = await this.ensurePeer(name)
    this.primaryPeerName = peer.name
    await this.syncOpenPeers()
    return protocol.listPendingForRecipient(peer.base.view, peer.account.accountId)
  }

  async balances() {
    const reader = await this.ensureReaderPeer()
    if (!reader) return []

    await this.syncOpenPeers()
    const balances = await protocol.computeAllBalances(reader.base.view)
    const rows = []

    for (const [accountId, amount] of [...balances.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      rows.push({
        accountId,
        amount,
        name: await protocol.findAccountNameById(reader.base.view, accountId)
      })
    }

    return rows
  }

  async history() {
    const reader = await this.ensureReaderPeer()
    if (!reader) return []

    await this.syncOpenPeers()
    return protocol.readHistory(reader.base.view)
  }

  async rebroadcastKnownAccounts() {
    for (const sourcePeer of this.peerNodes.values()) {
      const registration = protocol.signRegistration(
        sourcePeer.account,
        sourcePeer.account.name,
        sourcePeer.base.local.key.toString('hex')
      )

      let missingSomewhere = false
      for (const targetPeer of this.peerNodes.values()) {
        const existing = await targetPeer.base.view.get(`account:${sourcePeer.account.accountId}`)
        if (!existing) {
          missingSomewhere = true
          break
        }
      }

      if (missingSomewhere) {
        await this.broadcastSignedEvent(registration)
      }
    }
  }

  async broadcastSignedEvent(event) {
    for (const peer of this.peerNodes.values()) {
      await peer.base.append(event, { optimistic: true })
    }
  }

  async ingestSignedEvent(event) {
    await this.broadcastSignedEvent(event)
    await this.syncOpenPeers()
  }
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2))
}

LocalLedgerApp.prototype.createLocalAccount = function createLocalAccount(name) {
  assertName(name)

  const file = this.accountFile(name)
  if (fs.existsSync(file)) {
    throw new Error(`Account already exists: ${name}`)
  }

  const identity = protocol.createIdentity()
  writeJson(file, {
    name,
    accountId: identity.accountId,
    publicKeyPem: identity.publicKeyPem,
    privateKeyPem: identity.privateKeyPem,
    peerDir: path.join(this.peersDir, name)
  })

  return identity
}

function parsePositiveInt(value, label) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}: ${value}`)
  }

  return parsed
}

function assertRequired(value, label) {
  if (!value) throw new Error(`Missing ${label}`)
}

function assertName(name) {
  if (!/^[a-z0-9_-]+$/i.test(name || '')) {
    throw new Error(`Invalid name: ${name}`)
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function pairKey(left, right) {
  return [left, right].sort().join('::')
}

function hasFiles(dir) {
  return fs.existsSync(dir) && fs.readdirSync(dir).length > 0
}

module.exports = {
  LocalLedgerApp
}
