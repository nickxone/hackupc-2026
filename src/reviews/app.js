const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const Autobase = require('autobase')
const Corestore = require('corestore')
const b4a = require('b4a')

const { LocalLedgerApp } = require('../ledger/app')
const reviewProtocol = require('./protocol')

class LocalReviewApp {
  constructor({ rootDir = path.resolve(process.env.P2P_LEDGER_ROOT || '.p2p-ledger-demo'), ledgerApp = null } = {}) {
    this.rootDir = rootDir
    this.accountsDir = path.join(rootDir, 'accounts')
    this.reviewsDir = path.join(rootDir, 'reviews')
    this.peersDir = path.join(this.reviewsDir, 'peers')
    this.bootstrapDir = path.join(this.reviewsDir, 'bootstrap')
    this.bootstrapMetaFile = path.join(this.reviewsDir, 'bootstrap.json')
    this.ledgerApp = ledgerApp || new LocalLedgerApp({ rootDir })
  }

  async ensureReady() {
    fs.mkdirSync(this.rootDir, { recursive: true })
    fs.mkdirSync(this.accountsDir, { recursive: true })
    fs.mkdirSync(this.reviewsDir, { recursive: true })
    fs.mkdirSync(this.peersDir, { recursive: true })
    fs.mkdirSync(this.bootstrapDir, { recursive: true })
    await this.ensureBootstrapBase()
  }

  async buildSignedReview(reviewerName, targetPublicKey, txId, stars) {
    assertName(reviewerName)
    assertPublicKey(targetPublicKey)
    assertTxId(txId)
    assertStars(stars)
    await this.ensureReady()

    const reviewer = await this.openPeer(reviewerName)
    const hub = await this.openHub()

    try {
      await this.syncPair(reviewer.base, hub.base)
      await this.assertReviewAllowed(reviewer.account.publicKeyPem, targetPublicKey, txId, hub.base.view)
      return reviewProtocol.signReview(reviewer.account, targetPublicKey, txId, stars)
    } finally {
      await this.closeNode(reviewer)
      await this.closeNode(hub)
    }
  }

  async submitSignedReview(event, { syncNames = [] } = {}) {
    await this.ensureReady()
    const hub = await this.openHub()

    try {
      await hub.base.append(event)

      for (const name of syncNames) {
        const peer = await this.openPeer(name)
        try {
          await this.syncPair(peer.base, hub.base)
        } finally {
          await this.closeNode(peer)
        }
      }
    } finally {
      await this.closeNode(hub)
    }
  }

  async addReview(reviewerName, targetPublicKey, txId, stars) {
    const review = await this.buildSignedReview(reviewerName, targetPublicKey, txId, stars)
    await this.submitSignedReview(review, { syncNames: [reviewerName] })
    return review
  }

  async createAccount(name) {
    assertName(name)
    await this.ensureReady()

    const file = path.join(this.accountsDir, `${name}.json`)
    if (fs.existsSync(file)) {
      return this.loadAccount(name)
    }

    const keyPair = crypto.generateKeyPairSync('ed25519')
    const publicKeyPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' })
    const privateKeyPem = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' })
    const accountId = crypto.createHash('sha256').update(publicKeyPem).digest('hex')

    const account = {
      name,
      accountId,
      publicKeyPem,
      privateKeyPem,
      peerDir: path.join(this.peersDir, name)
    }

    writeJson(file, account)
    return account
  }

  async getReviewsForUser(targetPublicKey) {
    assertPublicKey(targetPublicKey)
    await this.ensureReady()

    const hub = await this.openHub()
    try {
      await this.syncStandaloneBase(hub.base)
      return await reviewProtocol.getReviewsForUser(hub.base.view, targetPublicKey)
    } finally {
      await this.closeNode(hub)
    }
  }

  async getAverageStarsForUser(targetPublicKey) {
    assertPublicKey(targetPublicKey)
    await this.ensureReady()

    const hub = await this.openHub()
    try {
      await this.syncStandaloneBase(hub.base)
      return await reviewProtocol.getAverageStarsForUser(hub.base.view, targetPublicKey)
    } finally {
      await this.closeNode(hub)
    }
  }

  async assertReviewAllowed(reviewerPublicKey, targetPublicKey, txId, reviewView) {
    const entry = await this.ledgerApp.getSettledEntry(txId)
    if (!entry || entry.type !== 'transfer') {
      throw new Error(`Cannot review transaction ${txId}: no settled transfer found`)
    }

    const reviewerAccountId = publicKeyId(reviewerPublicKey)
    const targetAccountId = publicKeyId(targetPublicKey)
    const participantIds = new Set([entry.fromAccount, entry.toAccount])

    if (!participantIds.has(reviewerAccountId)) {
      throw new Error('Reviewer is not a participant in that transaction')
    }

    if (!participantIds.has(targetAccountId)) {
      throw new Error('Target is not a participant in that transaction')
    }

    if (reviewerAccountId === targetAccountId) {
      throw new Error('You cannot review yourself')
    }

    const duplicate = await reviewView.get(`tx-review:${txId}:${reviewerAccountId}`)
    if (duplicate) {
      throw new Error(`Reviewer has already reviewed transaction ${txId}`)
    }
  }

  async openPeer(name) {
    assertName(name)
    await this.ensureReady()

    const account = this.loadAccount(name)
    const bootstrap = this.loadBootstrap()
    const store = new Corestore(path.join(this.peersDir, name))
    const base = new Autobase(store, b4a.from(bootstrap.key, 'hex'), {
      open: reviewProtocol.openReviewView,
      apply: reviewProtocol.createApply(),
      valueEncoding: 'json',
      optimistic: true
    })

    await base.ready()
    return { name, account, store, base }
  }

  async openHub() {
    await this.ensureReady()

    const bootstrap = this.loadBootstrap()
    const store = new Corestore(this.bootstrapDir)
    const base = new Autobase(store, b4a.from(bootstrap.key, 'hex'), {
      open: reviewProtocol.openReviewView,
      apply: reviewProtocol.createApply(),
      valueEncoding: 'json',
      optimistic: true
    })

    await base.ready()
    return { store, base }
  }

  async closeNode(node) {
    if (!node) return
    await node.base.close()
    await node.store.close()
  }

  async ensureBootstrapBase() {
    if (fs.existsSync(this.bootstrapMetaFile)) return this.loadBootstrap()

    const store = new Corestore(this.bootstrapDir)
    const base = new Autobase(store, null, {
      open: reviewProtocol.openReviewView,
      apply: reviewProtocol.createApply(),
      valueEncoding: 'json',
      optimistic: true
    })

    await base.ready()
    writeJson(this.bootstrapMetaFile, { key: base.key.toString('hex') })
    await base.close()
    await store.close()
    return this.loadBootstrap()
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

  loadAccount(name) {
    return loadJson(path.join(this.accountsDir, `${name}.json`))
  }

  getAccount(name) {
    return this.loadAccount(name)
  }

  loadBootstrap() {
    return loadJson(this.bootstrapMetaFile)
  }
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2))
}

function assertName(name) {
  if (!/^[a-z0-9_-]+$/i.test(name || '')) {
    throw new Error(`Invalid name: ${name}`)
  }
}

function assertPublicKey(publicKeyPem) {
  if (typeof publicKeyPem !== 'string' || !publicKeyPem.includes('BEGIN PUBLIC KEY')) {
    throw new Error('Expected a PEM public key')
  }
}

function assertStars(stars) {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw new Error(`Invalid star rating: ${stars}`)
  }
}

function assertTxId(txId) {
  if (typeof txId !== 'string' || txId.length === 0) {
    throw new Error('Expected a transaction id')
  }
}

function publicKeyId(publicKeyPem) {
  return crypto.createHash('sha256').update(publicKeyPem).digest('hex')
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = {
  LocalReviewApp
}
