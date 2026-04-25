import { readFile, writeFile, mkdir } from "bare-fs/promises";
import { dirname } from "bare-path";
import { ledgerConfig } from "../ledger-config.js";

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
        balance: ledgerConfig.initialBalance,
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
    return Math.ceil(tokens * ledgerConfig.pricePerTokenPerTier * tier);
  }

  async #persist() {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(this.state, null, 2));
  }
}
