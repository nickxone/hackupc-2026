import fs from "fs";
const { readFile, writeFile, mkdir } = fs.promises;
import path from "path";
const { dirname } = path;
import { config } from "../config.js";

export class Ledger {
  constructor(path) {
    this.path = path;
    this.state = null;
  }

  async load() {
    try {
      const raw = await readFile(this.path, "utf8");
      this.state = JSON.parse(raw);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      this.state = {
        balance: config.ledger.initialBalance,
        log: [],
      };
      await this.#persist();
    }
    return this.state;
  }

  balance() {
    return this.state.balance;
  }

  async earn({ from, tokens, credits, model }) {
    this.state.balance += credits;
    this.state.log.push({
      ts: Date.now(),
      kind: "earn",
      from,
      tokens,
      credits,
      model,
    });
    await this.#persist();
  }

  async spend({ to, tokens, credits, model }) {
    this.state.balance -= credits;
    this.state.log.push({
      ts: Date.now(),
      kind: "spend",
      to,
      tokens,
      credits,
      model,
    });
    await this.#persist();
  }

  priceOf({ tokens, tier }) {
    return Math.ceil(tokens * config.ledger.pricePerTokenPerTier * tier);
  }

  async #persist() {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(this.state, null, 2));
  }
}
