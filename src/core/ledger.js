import { dirname, basename } from "bare-path";
import { config } from "../config.js";
import { LocalLedgerApp } from "../ledger/app.js";

export class Ledger {
  constructor(path) {
    this.path = path;
    this.name = basename(path, ".ledger.json");
    this.app = new LocalLedgerApp();
    this.state = {
      balance: 0,
      log: [],
    };
  }

  async load() {
    await this.app.ensureReady();
    try {
      await this.app.createAccount(this.name);
      // Give new accounts a starting balance by granting initial balance
      await this.app.grant(this.name, config.ledger.initialBalance);
    } catch (err) {
      // Account already exists
    }
    await this._syncState();
    return this.state;
  }

  balance() {
    return this.state.balance;
  }

  async _syncState() {
    await this.app.syncPeer(this.name);
    const balances = await this.app.balances();
    const myBalance = balances.find((b) => b.name === this.name);
    this.state.balance = myBalance ? myBalance.amount : 0;
    this.state.log = await this.app.history();
  }

  async earn({ from, tokens, credits, model, txId }) {
    if (txId) {
      await this.app.acceptTransfer(this.name, txId);
    }
    await this._syncState();
  }

  async spend({ to, tokens, credits, model }) {
    // to is a peerName in this context
    const event = await this.app.proposeTransfer(
      this.name,
      to,
      credits,
      model
    );
    await this._syncState();
    return event;
  }

  priceOf({ tokens, tier }) {
    return Math.ceil(tokens * config.ledger.pricePerTokenPerTier * tier);
  }
}
