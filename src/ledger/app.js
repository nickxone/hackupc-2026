const fs = require('fs')
const path = require('path')

const Autobase = require('autobase')
const Corestore = require('corestore')
const b4a = require('b4a')

const protocol = require('./protocol')

class LocalLedgerApp {
  constructor({ rootDir = path.resolve(process.env.P2P_LEDGER_ROOT || '.p2p-ledger-demo') } = {}) {
    this.rootDir = rootDir
    this.accountsDir = path.join(rootDir, 'accounts')
    this.peersDir = path.join(rootDir, 'peers')
    this.bootstrapDir = path.join(rootDir, 'bootstrap')
    this.bootstrapMetaFile = path.join(rootDir, 'bootstrap.json')
    this.authorityFile = path.join(rootDir, 'authority.json')
  }

  async ensureReady() {
    fs.mkdirSync(this.rootDir, { recursive: true })
    fs.mkdirSync(this.accountsDir, { recursive: true })
    fs.mkdirSync(this.peersDir, { recursive: true })
    fs.mkdirSync(this.bootstrapDir, { recursive: true })
    await this.ensureAuthority()
    await this.ensureBootstrapBase()
  }

  async createAccount(name) {
    assertName(name)
    await this.ensureReady()

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

    const peer = await this.openPeer(name)
    const authority = await this.openAuthority()

    try {
      await this.syncPair(peer.base, authority.base)

      const existing = await authority.base.view.get(`account:${peer.account.accountId}`)
      if (!existing) {
        await authority.base.append(protocol.signRegistration(peer.account, peer.account.name, peer.base.local.key.toString('hex')))
        await this.syncPair(peer.base, authority.base)
      }

      return { name, accountId: peer.account.accountId }
    } finally {
      await this.closeNode(peer)
      await this.closeNode(authority)
    }
  }

  async buildSignedGrant(name, amount) {
    assertName(name)
    const parsedAmount = parsePositiveInt(amount, 'amount')
    await this.ensureReady()

    const authority = this.loadAuthority()
    const account = this.loadAccount(name)
    return protocol.signGrant(authority, account.accountId, parsedAmount)
  }

  async buildSignedTransferProposal(fromName, toName, amount, memo = '') {
    assertName(fromName)
    assertName(toName)
    const parsedAmount = parsePositiveInt(amount, 'amount')
    await this.ensureReady()

    const sender = await this.openPeer(fromName)
    const authority = await this.openAuthority()

    try {
      await this.syncPair(sender.base, authority.base)

      const senderBalance = await protocol.computeBalance(sender.base.view, sender.account.accountId)
      if (senderBalance < 0) {
        throw new Error(`Sender balance is negative, refusing to sign: ${senderBalance}`)
      }
      if (senderBalance < parsedAmount) {
        throw new Error(`Sender has insufficient funds, refusing to sign: ${senderBalance} < ${parsedAmount}`)
      }

      const recipient = this.loadAccount(toName)
      return protocol.signTransferProposal(sender.account, recipient.accountId, parsedAmount, memo)
    } finally {
      await this.closeNode(sender)
      await this.closeNode(authority)
    }
  }

  async buildSignedTransferAcceptance(name, txId) {
    assertName(name)
    assertRequired(txId, 'txId')
    await this.ensureReady()

    const peer = await this.openPeer(name)
    const authority = await this.openAuthority()

    try {
      await this.syncPair(peer.base, authority.base)

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
    } finally {
      await this.closeNode(peer)
      await this.closeNode(authority)
    }
  }

  async submitSignedEvent(event, { syncNames = [] } = {}) {
    await this.ensureReady()
    const authority = await this.openAuthority()

    try {
      await authority.base.append(event)

      for (const name of syncNames) {
        const peer = await this.openPeer(name)
        try {
          await this.syncPair(peer.base, authority.base)
        } finally {
          await this.closeNode(peer)
        }
      }
    } finally {
      await this.closeNode(authority)
    }
  }

  async grant(name, amount) {
    const event = await this.buildSignedGrant(name, amount)
    await this.submitSignedEvent(event, { syncNames: [name] })
    return event
  }

  async proposeTransfer(fromName, toName, amount, memo = '') {
    const event = await this.buildSignedTransferProposal(fromName, toName, amount, memo)
    await this.submitSignedEvent(event, { syncNames: [fromName] })
    return event
  }

  async acceptTransfer(name, txId) {
    const event = await this.buildSignedTransferAcceptance(name, txId)
    await this.submitSignedEvent(event, { syncNames: [name] })
    return event
  }

  async pending(name) {
    assertName(name)
    await this.ensureReady()

    const peer = await this.openPeer(name)
    const authority = await this.openAuthority()

    try {
      await this.syncPair(peer.base, authority.base)
      return await protocol.listPendingForRecipient(peer.base.view, peer.account.accountId)
    } finally {
      await this.closeNode(peer)
      await this.closeNode(authority)
    }
  }

  async balances() {
    await this.ensureReady()
    const authority = await this.openAuthority()

    try {
      await this.syncStandaloneBase(authority.base)
      const balances = await protocol.computeAllBalances(authority.base.view)
      const rows = []

      for (const [accountId, amount] of [...balances.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        rows.push({
          accountId,
          amount,
          name: await protocol.findAccountNameById(authority.base.view, accountId)
        })
      }

      return rows
    } finally {
      await this.closeNode(authority)
    }
  }

  async history() {
    await this.ensureReady()
    const authority = await this.openAuthority()

    try {
      await this.syncStandaloneBase(authority.base)
      return await protocol.readHistory(authority.base.view)
    } finally {
      await this.closeNode(authority)
    }
  }

  async syncPeer(name) {
    const peer = await this.openPeer(name)
    const authority = await this.openAuthority()

    try {
      await this.syncPair(peer.base, authority.base)
    } finally {
      await this.closeNode(peer)
      await this.closeNode(authority)
    }
  }

  async syncPair(leftBase, rightBase, rounds = 8) {
    const leftStream = leftBase.store.replicate(true)
    const rightStream = rightBase.store.replicate(false)
    leftStream.pipe(rightStream).pipe(leftStream)

    for (let i = 0; i < rounds; i++) {
      await Promise.all([leftBase.update(), rightBase.update()])
      await sleep(30)
    }

    leftStream.destroy()
    rightStream.destroy()
  }

  async syncStandaloneBase(base) {
    await base.update()
    await sleep(50)
    await base.update()
  }

  async openPeer(name) {
    assertName(name)
    await this.ensureReady()

    const account = this.loadAccount(name)
    const bootstrap = this.loadBootstrap()
    const authority = this.loadAuthority()

    const store = new Corestore(account.peerDir)
    const base = new Autobase(store, b4a.from(bootstrap.key, 'hex'), {
      open: protocol.openLedgerView,
      apply: protocol.createApply({ authorityPublicKeyPem: authority.publicKeyPem }),
      valueEncoding: 'json',
      optimistic: true
    })

    await base.ready()
    return { name, account, store, base }
  }

  async openAuthority() {
    await this.ensureReady()

    const bootstrap = this.loadBootstrap()
    const authority = this.loadAuthority()
    const store = new Corestore(this.bootstrapDir)
    const base = new Autobase(store, b4a.from(bootstrap.key, 'hex'), {
      open: protocol.openLedgerView,
      apply: protocol.createApply({ authorityPublicKeyPem: authority.publicKeyPem }),
      valueEncoding: 'json',
      optimistic: true
    })

    await base.ready()
    return { store, base, authority }
  }

  async closeNode(node) {
    if (!node) return
    await node.base.close()
    await node.store.close()
  }

  async ensureBootstrapBase() {
    if (fs.existsSync(this.bootstrapMetaFile)) return this.loadBootstrap()

    const authority = this.loadAuthority()
    const store = new Corestore(this.bootstrapDir)
    const base = new Autobase(store, null, {
      open: protocol.openLedgerView,
      apply: protocol.createApply({ authorityPublicKeyPem: authority.publicKeyPem }),
      valueEncoding: 'json',
      optimistic: true
    })

    await base.ready()
    writeJson(this.bootstrapMetaFile, { key: base.key.toString('hex') })
    await base.close()
    await store.close()
    return this.loadBootstrap()
  }

  async ensureAuthority() {
    if (fs.existsSync(this.authorityFile)) return this.loadAuthority()

    const authority = protocol.createIdentity()
    writeJson(this.authorityFile, authority)
    return authority
  }

  loadAuthority() {
    return loadJson(this.authorityFile)
  }

  loadBootstrap() {
    return loadJson(this.bootstrapMetaFile)
  }

  loadAccount(name) {
    return loadJson(this.accountFile(name))
  }

  accountFile(name) {
    return path.join(this.accountsDir, `${name}.json`)
  }
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2))
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

module.exports = {
  LocalLedgerApp
}
