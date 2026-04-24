export class Discovery {
  constructor({ topic, selfPubkey, selfName, models }) {
    this.topic = topic;
    this.selfPubkey = selfPubkey;
    this.selfName = selfName;
    this.models = models;
    this.peers = new Map();
    this.handlers = { announce: [], creditAck: [] };
  }

  async start() {
    throw new Error("Discovery.start: not implemented — wire up Hyperswarm");
  }

  async stop() {
    throw new Error("Discovery.stop: not implemented");
  }

  async announce() {
    throw new Error("Discovery.announce: not implemented");
  }

  async sendCreditAck({ to, tokens, credits, model }) {
    void to; void tokens; void credits; void model;
    throw new Error("Discovery.sendCreditAck: not implemented");
  }

  on(event, handler) {
    if (!this.handlers[event]) throw new Error(`Unknown event: ${event}`);
    this.handlers[event].push(handler);
  }

  listPeers() {
    return Array.from(this.peers.values());
  }
}
