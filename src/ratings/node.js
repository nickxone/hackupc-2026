import { mkdirSync } from "bare-fs";
import Autobase from "autobase";
import Corestore from "corestore";
import b4a from "b4a";

import { getRatingsBootstrapKey } from "../ledger/config.js";
import {
  createApply,
  createRatingEvent,
  getAllAverageRatings,
  getAverageRating,
  getRatingsForTarget,
  openRatingsView,
  readRatingsHistory,
} from "./protocol.js";

export class RatingsNode {
  constructor({ rootDir, name }) {
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new Error(`Invalid ratings name: ${name}`);
    }
    this.rootDir = rootDir;
    this.name = name.trim();
    this.store = null;
    this.base = null;
    this._updateInterval = null;
  }

  async ready() {
    mkdirSync(this.rootDir, { recursive: true });
    this.store = new Corestore(this.rootDir);
    const bootstrapKey = getRatingsBootstrapKey();
    this.base = new Autobase(this.store, b4a.from(bootstrapKey, "hex"), {
      open: openRatingsView,
      apply: createApply(),
      valueEncoding: "json",
      optimistic: true,
    });
    await this.base.ready();
    return this;
  }

  get view() {
    return this.base.view;
  }

  async update() {
    try {
      await this.base.update();
    } catch {
    }
  }

  async ingestEvent(event) {
    await this.base.append(event, { optimistic: true });
  }

  async createRating({ target, score }) {
    const event = createRatingEvent({
      target,
      score,
      reviewerName: this.name,
    });
    await this.ingestEvent(event);
    return event;
  }

  async ratingsFor(target) {
    await this.update();
    return getRatingsForTarget(this.view, target);
  }

  async averageFor(target) {
    await this.update();
    return getAverageRating(this.view, target);
  }

  async allAverages() {
    await this.update();
    return getAllAverageRatings(this.view);
  }

  async history() {
    await this.update();
    return readRatingsHistory(this.view);
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
