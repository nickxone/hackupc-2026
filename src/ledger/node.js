import { existsSync, mkdirSync, readFileSync, writeFileSync } from "bare-fs";
import { join } from "bare-path";
import Autobase from "autobase";
import Corestore from "corestore";
import b4a from "b4a";

import { getLedgerBootstrapKey } from "./config.js";
import {
  computeAllBalances,
  computeBalance,
  createApply,
  createIdentity,
  findAccountByName,
  findAccountNameById,
  listPendingForRecipient,
  openLedgerView,
  readHistory,
  signRegistration,
  signTransferAcceptance,
  signTransferProposal,
} from "./protocol.js";

export class LedgerNode {
  constructor({ rootDir, name }) {
    if (!/^[a-z0-9_-]+$/i.test(name || "")) throw new Error(`Invalid ledger name: ${name}`);
    this.rootDir = rootDir;
    this.name = name;
    this.accountFile = join(rootDir, "account.json");
    this.peerDir = join(rootDir, "peer");
    this.account = null;
    this.store = null;
    this.base = null;
    this._updateInterval = null;
    this._updateInFlight = false;
  }

  async ready() {
    mkdirSync(this.rootDir, { recursive: true });

    if (!existsSync(this.accountFile)) {
      const identity = createIdentity();
      writeJson(this.accountFile, {
        name: this.name,
        accountId: identity.accountId,
        publicKey: identity.publicKey,
        secretKey: identity.secretKey,
      });
    }
    this.account = readJson(this.accountFile);

    this.store = new Corestore(this.peerDir);
    const bootstrapKey = getLedgerBootstrapKey();
    this.base = new Autobase(this.store, b4a.from(bootstrapKey, "hex"), {
      open: openLedgerView,
      apply: createApply(),
      valueEncoding: "json",
      optimistic: true,
    });
    await this.base.ready();
    return this;
  }

  get accountId() {
    return this.account.accountId;
  }

  get publicKey() {
    return this.account.publicKey;
  }

  get view() {
    return this.base.view;
  }

  get writerKeyHex() {
    return this.base.local.key.toString("hex");
  }

  replicateOn(connection) {
    return this.store.replicate(connection);
  }

  async update() {
    if (this._updateInFlight) return;
    this._updateInFlight = true;
    try {
      await this.base.update();
    } catch {
    } finally {
      this._updateInFlight = false;
    }
  }

  async ingestSignedEvent(event) {
    await this.base.append(event, { optimistic: true });
  }

  async announceAccount() {
    const event = signRegistration(this.account, this.account.name, this.writerKeyHex);
    await this.ingestSignedEvent(event);
    return event;
  }

  async signProposal({ toAccount, amount, memo = "" }) {
    if (!toAccount) throw new Error("toAccount required");
    if (!Number.isInteger(amount) || amount <= 0) throw new Error(`Invalid amount: ${amount}`);

    await this.update();

    const senderBalance = await computeBalance(this.view, this.accountId);
    if (senderBalance < amount) {
      throw new Error(`Insufficient funds: ${senderBalance} < ${amount}`);
    }

    return signTransferProposal(this.account, toAccount, amount, memo);
  }

  async signAcceptance(txId) {
    if (!txId) throw new Error("txId required");
    await this.update();

    const proposal = await this.view.get(`proposal:${txId}`);
    if (!proposal) throw new Error(`Unknown proposal: ${txId}`);
    if (proposal.value.toAccount !== this.accountId) {
      throw new Error("Not the recipient for that transaction");
    }

    const finalized = await this.view.get(`entry:${txId}`);
    if (finalized) throw new Error(`Transaction already finalized: ${txId}`);

    const senderBalance = await computeBalance(this.view, proposal.value.fromAccount);
    if (senderBalance < proposal.value.amount) {
      throw new Error(
        `Recipient sees insufficient sender funds: ${senderBalance} < ${proposal.value.amount}`,
      );
    }

    return signTransferAcceptance(this.account, txId);
  }

  async getProposal(txId) {
    await this.update();
    const entry = await this.view.get(`proposal:${txId}`);
    return entry ? entry.value : null;
  }

  async getEntry(txId) {
    await this.update();
    const entry = await this.view.get(`entry:${txId}`);
    return entry ? entry.value : null;
  }

  async pending() {
    await this.update();
    return listPendingForRecipient(this.view, this.accountId);
  }

  async balance() {
    await this.update();
    return computeBalance(this.view, this.accountId);
  }

  async balances() {
    await this.update();
    const map = await computeAllBalances(this.view);
    const rows = [];
    for (const [accountId, amount] of [...map.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      rows.push({
        accountId,
        amount,
        name: await findAccountNameById(this.view, accountId),
      });
    }
    return rows;
  }

  async history() {
    await this.update();
    return readHistory(this.view);
  }

  async lastRecipientAccount() {
    await this.update();

    const history = await readHistory(this.view);
    let latest = null;

    for (const entry of history) {
      const tx = entry.value;
      if (!tx || tx.type !== "transfer") continue;
      if (tx.fromAccount !== this.accountId) continue;

      const at = tx.acceptedAt || tx.createdAt || "";
      if (!latest || at > latest.at) {
        latest = {
          at,
          toAccount: tx.toAccount,
          txId: tx.txId,
        };
      }
    }

    return latest;
  }

  async findAccountByName(name) {
    await this.update();
    return findAccountByName(this.view, name);
  }

  startBackgroundUpdates(intervalMs = 1000) {
    if (this._updateInterval) return;
    this._updateInterval = setInterval(() => {
      this.update();
    }, intervalMs);
  }

  stopBackgroundUpdates() {
    if (this._updateInterval) clearInterval(this._updateInterval);
    this._updateInterval = null;
  }

  async close() {
    this.stopBackgroundUpdates();
    if (this.base) await this.base.close().catch(() => {});
    if (this.store) await this.store.close().catch(() => {});
  }
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2));
}
