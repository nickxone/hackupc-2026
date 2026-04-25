const { EventEmitter } = require('events')
const protocol = require('./protocol')

class SimulatedLedgerNetwork extends EventEmitter {
  constructor(app, {
    minDelayMs = 80,
    maxDelayMs = 400,
    dropRate = 0.05,
    duplicateRate = 0.05,
    peerSyncIntervalMs = 250
  } = {}) {
    super()
    this.app = app
    this.minDelayMs = minDelayMs
    this.maxDelayMs = maxDelayMs
    this.dropRate = dropRate
    this.duplicateRate = duplicateRate
    this.peerSyncIntervalMs = peerSyncIntervalMs
    this.peerNames = new Set()
    this.peerNodes = new Map()
    this.timer = null
    this.running = false
    this.busy = false
    this.queue = Promise.resolve()
    this._updateTimer = null
    this._updateInFlight = false
  }

  async registerPeer(name) {
    this.peerNames.add(name)
    if (!this.peerNodes.has(name)) {
      this.peerNodes.set(name, await this.app.openPeer(name))
    }
  }

  async open() {
    if (this._updateTimer) return
    this._updateTimer = setInterval(() => {
      this.updateAllPeers().catch(err => this.emit('error', err))
    }, this.app.backgroundUpdateIntervalMs)
  }

  start() {
    if (this.running) return
    this.running = true
    this.timer = setInterval(() => {
      this.tick().catch(err => this.emit('error', err))
    }, this.peerSyncIntervalMs)
  }

  async stop() {
    this.running = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    await this.flush(2)
    if (this._updateTimer) clearInterval(this._updateTimer)
    this._updateTimer = null
    await this.updateAllPeers().catch(() => {})
    await this.closeNodes()
  }

  async submitEvent(name, event) {
    return this.runExclusive(() => this.schedule(async () => {
      if (!this.peerNodes.has(name)) throw new Error(`Unknown peer: ${name}`)

      for (const peerNode of this.peerNodes.values()) {
        await peerNode.base.append(event, { optimistic: true })
      }
      this.emit('submitted', { from: name, type: event.type, txId: event.txId || null })
    }, event.type, { allowDrop: false }))
  }

  async flush(rounds = 4) {
    return this.runExclusive(async () => {
      const names = [...this.peerNames]
      for (let i = 0; i < rounds; i++) {
        for (let left = 0; left < names.length; left++) {
          for (let right = left + 1; right < names.length; right++) {
            await this.deliverBetween(names[left], names[right])
          }
        }
      }
    })
  }

  async tick() {
    if (!this.running || this.busy || this.peerNames.size === 0) return
    this.busy = true

    try {
      const names = [...this.peerNames]
      if (names.length < 2) return

      const leftIndex = Math.floor(Math.random() * names.length)
      let rightIndex = Math.floor(Math.random() * (names.length - 1))
      if (rightIndex >= leftIndex) rightIndex += 1

      const leftName = names[leftIndex]
      const rightName = names[rightIndex]
      await this.runExclusive(() => this.schedule(
        () => this.deliverBetween(leftName, rightName),
        `tick:${leftName}<->${rightName}`,
        { allowDrop: true }
      ))
    } finally {
      this.busy = false
    }
  }

  async runExclusive(task) {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => {})
    return run
  }

  async run(task) {
    return this.runExclusive(task)
  }

  async schedule(task, label = 'task', { allowDrop = true } = {}) {
    const dropped = allowDrop && Math.random() < this.dropRate
    const delayMs = this.minDelayMs + Math.floor(Math.random() * (this.maxDelayMs - this.minDelayMs + 1))

    if (dropped) {
      this.emit('dropped', { label, delayMs })
      await sleep(delayMs)
      return null
    }

    await sleep(delayMs)
    const result = await task()
    this.emit('delivered', { label, delayMs })

    if (Math.random() < this.duplicateRate) {
      const duplicateDelayMs = this.minDelayMs + Math.floor(Math.random() * (this.maxDelayMs - this.minDelayMs + 1))
      await sleep(duplicateDelayMs)
      await task()
      this.emit('duplicated', { label, delayMs: duplicateDelayMs })
    }

    return result
  }

  async deliverBetween(leftName, rightName, rounds = 6) {
    const leftNode = this.peerNodes.get(leftName)
    const rightNode = this.peerNodes.get(rightName)
    if (!leftNode) throw new Error(`Unknown peer: ${leftName}`)
    if (!rightNode) throw new Error(`Unknown peer: ${rightName}`)

    const connection = this.app.connectNodes(leftNode, rightNode)

    try {
      await this.app.settleNodes([leftNode, rightNode], rounds)
    } finally {
      this.app.closeConnection(connection)
    }
  }

  async updateAllPeers() {
    if (this._updateInFlight) return

    this._updateInFlight = true
    try {
      for (const peerNode of this.peerNodes.values()) {
        await peerNode.base.update()
      }
    } finally {
      this._updateInFlight = false
    }
  }

  async closeNodes() {
    const peers = [...this.peerNodes.values()]
    this.peerNodes.clear()

    for (const peerNode of peers) {
      await this.app.closeNode(peerNode)
    }
  }

  async buildSignedTransferProposal(fromName, toName, amount, memo = '') {
    const sender = this.peerNodes.get(fromName)
    const recipient = this.peerNodes.get(toName)
    if (!sender) throw new Error(`Unknown peer: ${fromName}`)
    if (!recipient) throw new Error(`Unknown peer: ${toName}`)

    await this.updateAllPeers()

    const parsedAmount = Number.parseInt(amount, 10)
    const senderBalance = await protocol.computeBalance(sender.base.view, sender.account.accountId)
    if (senderBalance < parsedAmount) {
      throw new Error(`Sender has insufficient funds, refusing to sign: ${senderBalance} < ${parsedAmount}`)
    }

    return protocol.signTransferProposal(sender.account, recipient.account.accountId, parsedAmount, memo)
  }

  async buildSignedTransferAcceptance(name, txId) {
    const peer = this.peerNodes.get(name)
    if (!peer) throw new Error(`Unknown peer: ${name}`)

    await this.updateAllPeers()

    const proposal = await peer.base.view.get(`proposal:${txId}`)
    if (!proposal) throw new Error(`Unknown proposal: ${txId}`)
    if (proposal.value.toAccount !== peer.account.accountId) {
      throw new Error('This account is not the recipient for that transaction')
    }

    return protocol.signTransferAcceptance(peer.account, txId)
  }

  async pending(name) {
    const peer = this.peerNodes.get(name)
    if (!peer) throw new Error(`Unknown peer: ${name}`)

    await this.updateAllPeers()
    return protocol.listPendingForRecipient(peer.base.view, peer.account.accountId)
  }

  async balances() {
    const firstPeer = this.peerNodes.values().next().value
    if (!firstPeer) return []

    await this.updateAllPeers()
    const balances = await protocol.computeAllBalances(firstPeer.base.view)
    const rows = []

    for (const [accountId, amount] of [...balances.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      rows.push({
        accountId,
        amount,
        name: await protocol.findAccountNameById(firstPeer.base.view, accountId)
      })
    }

    return rows
  }

  async history() {
    const firstPeer = this.peerNodes.values().next().value
    if (!firstPeer) return []

    await this.updateAllPeers()
    return protocol.readHistory(firstPeer.base.view)
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = {
  SimulatedLedgerNetwork
}
