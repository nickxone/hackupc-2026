const { EventEmitter } = require('events')

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
    this.timer = null
    this.running = false
    this.busy = false
    this.queue = Promise.resolve()
  }

  registerPeer(name) {
    this.peerNames.add(name)
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
  }

  async submitEvent(event, { syncNames = [] } = {}) {
    return this.runExclusive(() => this.schedule(async () => {
      await this.app.submitSignedEvent(event)
      this.emit('submitted', { type: event.type, txId: event.txId || null })

      for (const name of syncNames) {
        await this.schedule(() => this.app.syncPeer(name), `sync:${name}`)
      }
    }, event.type, { allowDrop: false }))
  }

  async flush(rounds = 4) {
    return this.runExclusive(async () => {
      for (let i = 0; i < rounds; i++) {
        for (const peerName of this.peerNames) {
          await this.app.syncPeer(peerName)
        }
      }
    })
  }

  async tick() {
    if (!this.running || this.busy || this.peerNames.size === 0) return
    this.busy = true

    try {
      const names = [...this.peerNames]
      const peerName = names[Math.floor(Math.random() * names.length)]
      await this.runExclusive(() => this.schedule(() => this.app.syncPeer(peerName), `tick:${peerName}`, { allowDrop: true }))
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
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = {
  SimulatedLedgerNetwork
}
