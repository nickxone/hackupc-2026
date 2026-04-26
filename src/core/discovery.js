import Hyperswarm from "hyperswarm";

const ANNOUNCE_INTERVAL_MS = 10_000;
const DISCOVERY_REFRESH_INTERVAL_MS = 5_000;

export class Discovery {
  constructor({
    topicHex,
    peerName,
    models,
    qvacTopic,
    qvacProviderPublicKey,
    ledgerAccountId,
    ledgerRegistration,
  }) {
    if (!topicHex || topicHex.length !== 64) {
      throw new Error("Discovery: topicHex must be 64 hex chars (32 bytes)");
    }
    this.topicHex = topicHex;
    this.topic = Buffer.from(topicHex, "hex");
    this.peerName = peerName ?? "anonymous";
    this.models = models ?? [];
    this.qvacTopic = qvacTopic ?? null;
    this.qvacProviderPublicKey = qvacProviderPublicKey ?? null;
    this.ledgerAccountId = ledgerAccountId ?? null;
    this.ledgerRegistration = ledgerRegistration ?? null;

    this.swarm = null;
    this.discovery = null;
    this.peers = new Map();
    this.conns = new Map();
    this.handlers = {
      announce: [],
      creditAck: [],
      peerLeft: [],
      ledgerRegister: [],
      ledgerProposal: [],
      ledgerAcceptance: [],
      rating: [],
    };
    this.announceInterval = null;
    this.refreshInterval = null;
    this.refreshing = false;
  }

  setLedgerRegistration(registration) {
    this.ledgerRegistration = registration;
    this.ledgerAccountId = registration?.accountId ?? this.ledgerAccountId;
  }

  async start() {
    this.swarm = new Hyperswarm();
    this.swarm.on("connection", (conn, info) =>
      this.#onConnection(conn, info),
    );
    this.discovery = this.swarm.join(this.topic, {
      server: true,
      client: true,
    });
    await this.discovery.flushed();
    this.#broadcastAnnounce();
    this.announceInterval = setInterval(
      () => this.#broadcastAnnounce(),
      ANNOUNCE_INTERVAL_MS,
    );
    this.refreshInterval = setInterval(
      () => this.#refreshDiscovery(),
      DISCOVERY_REFRESH_INTERVAL_MS,
    );
  }

  async stop() {
    if (this.announceInterval) clearInterval(this.announceInterval);
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    this.announceInterval = null;
    this.refreshInterval = null;
    this.discovery = null;
    if (this.swarm) {
      await this.swarm.destroy();
      this.swarm = null;
    }
    this.peers.clear();
    this.conns.clear();
  }

  myPeerId() {
    return this.swarm?.keyPair.publicKey.toString("hex") ?? null;
  }

  on(event, handler) {
    if (!this.handlers[event]) throw new Error(`Unknown event: ${event}`);
    this.handlers[event].push(handler);
  }

  listPeers() {
    return Array.from(this.peers.values());
  }

  async sendCreditAck({ to, tokens, credits, model }) {
    const conn = this.conns.get(to);
    if (!conn) throw new Error(`No active connection to peer ${to}`);
    const msg = { t: "creditAck", to, tokens, credits, model };
    conn.write(JSON.stringify(msg) + "\n");
  }

  broadcastLedgerEvent(kind, event) {
    const map = {
      "register-account": "ledgerRegister",
      "transfer-proposal": "ledgerProposal",
      "transfer-acceptance": "ledgerAcceptance",
    };
    const t = map[kind];
    if (!t) throw new Error(`Unknown ledger event kind: ${kind}`);
    const line = JSON.stringify({ t, event }) + "\n";
    for (const conn of this.conns.values()) {
      try {
        conn.write(line);
      } catch {
      }
    }
  }

  broadcastRatingEvent(event) {
    const line = JSON.stringify({ t: "rating", event }) + "\n";
    for (const conn of this.conns.values()) {
      try {
        conn.write(line);
      } catch {
      }
    }
  }

  #onConnection(conn, info) {
    const peerId = info.publicKey.toString("hex");
    console.log(`PEER_CONNECTED ${peerId.slice(0, 12)}`);
    this.conns.set(peerId, conn);

    let buf = "";
    conn.on("data", (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.trim()) this.#handleFrame(peerId, line);
      }
    });
    conn.on("error", () => {});
    conn.on("close", () => this.#onClose(peerId));

    this.#sendAnnounceTo(conn);
  }

  #handleFrame(peerId, line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.t === "announce") {
      const peer = {
        peerId,
        peerName: msg.peerName,
        models: msg.models ?? [],
        qvacTopic: msg.qvacTopic ?? null,
        qvacProviderPublicKey: msg.qvacProviderPublicKey ?? null,
        ledgerAccountId: msg.ledgerAccountId ?? null,
        firstSeenAt: this.peers.get(peerId)?.firstSeenAt ?? Date.now(),
        lastSeenAt: Date.now(),
      };
      this.peers.set(peerId, peer);
      this.handlers.announce.forEach((h) => h(peer));
    } else if (msg.t === "creditAck" && msg.to === this.myPeerId()) {
      this.handlers.creditAck.forEach((h) =>
        h({
          from: peerId,
          tokens: msg.tokens,
          credits: msg.credits,
          model: msg.model,
        }),
      );
    } else if (msg.t === "ledgerRegister" && msg.event) {
      this.handlers.ledgerRegister.forEach((h) => h({ from: peerId, event: msg.event }));
    } else if (msg.t === "ledgerProposal" && msg.event) {
      this.handlers.ledgerProposal.forEach((h) => h({ from: peerId, event: msg.event }));
    } else if (msg.t === "ledgerAcceptance" && msg.event) {
      this.handlers.ledgerAcceptance.forEach((h) => h({ from: peerId, event: msg.event }));
    } else if (msg.t === "rating" && msg.event) {
      this.handlers.rating.forEach((h) => h({ from: peerId, event: msg.event }));
    }
  }

  #onClose(peerId) {
    this.conns.delete(peerId);
    const had = this.peers.delete(peerId);
    if (had) this.handlers.peerLeft.forEach((h) => h(peerId));
  }

  #sendAnnounceTo(conn) {
    const msg = {
      t: "announce",
      peerName: this.peerName,
      models: this.models,
      qvacTopic: this.qvacTopic,
      qvacProviderPublicKey: this.qvacProviderPublicKey,
      ledgerAccountId: this.ledgerAccountId,
    };
    try {
      conn.write(JSON.stringify(msg) + "\n");
      if (this.ledgerRegistration) {
        conn.write(JSON.stringify({ t: "ledgerRegister", event: this.ledgerRegistration }) + "\n");
      }
    } catch {
      // connection might be closing
    }
  }

  #broadcastAnnounce() {
    for (const conn of this.conns.values()) this.#sendAnnounceTo(conn);
  }

  async #refreshDiscovery() {
    if (!this.discovery || this.refreshing) return;
    this.refreshing = true;
    try {
      await this.discovery.refresh({ server: true, client: true });
      this.#broadcastAnnounce();
    } catch {
      // transient DHT refresh failures are expected on unstable networks
    } finally {
      this.refreshing = false;
    }
  }
}
