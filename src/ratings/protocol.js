import Hyperbee from "hyperbee";
import bareCrypto from "bare-crypto";

const { randomUUID } = bareCrypto;

export function openRatingsView(store) {
  return new Hyperbee(store.get("shared-ratings"), {
    keyEncoding: "utf-8",
    valueEncoding: "json",
  });
}

export function createApply() {
  return async function apply(nodes, view, host) {
    for (const node of nodes) {
      if (!node || node.value == null) continue;
      const value = node.value;
      if (!isValidRating(value)) continue;

      await host.ackWriter(node.from.key);

      const ratingId = value.ratingId;
      const existing = await view.get(`rating:${ratingId}`);
      if (existing) continue;

      const normalizedTarget = normalizeTarget(value.target);
      const stored = {
        type: "rating",
        ratingId,
        target: value.target,
        normalizedTarget,
        score: value.score,
        reviewerName: value.reviewerName,
        createdAt: value.createdAt,
      };

      await view.put(`rating:${ratingId}`, stored);
      await view.put(`target-rating:${normalizedTarget}:${value.createdAt}:${ratingId}`, stored);
    }
  };
}

export function createRatingEvent({
  target,
  score,
  reviewerName,
  ratingId = randomUUID(),
  createdAt = new Date().toISOString(),
}) {
  const parsedScore = Number(score);
  if (!isValidTarget(target)) throw new Error(`Invalid rating target: ${target}`);
  if (!Number.isInteger(parsedScore) || parsedScore < 1 || parsedScore > 5) {
    throw new Error(`Invalid rating score: ${score}`);
  }
  if (!isValidReviewerName(reviewerName)) {
    throw new Error(`Invalid reviewerName: ${reviewerName}`);
  }

  return {
    type: "rating",
    ratingId,
    target: String(target).trim(),
    score: parsedScore,
    reviewerName: String(reviewerName).trim(),
    createdAt,
  };
}

export async function getRatingsForTarget(view, target) {
  const normalizedTarget = normalizeTarget(target);
  const ratings = [];
  for await (const entry of view.createReadStream({
    gte: `target-rating:${normalizedTarget}:`,
    lt: `target-rating:${normalizedTarget}:~`,
  })) {
    ratings.push(entry.value);
  }
  return ratings;
}

export async function getAverageRating(view, target) {
  const ratings = await getRatingsForTarget(view, target);
  if (ratings.length === 0) return null;

  const total = ratings.reduce((sum, rating) => sum + rating.score, 0);
  return Number((total / ratings.length).toFixed(2));
}

export async function getAllAverageRatings(view) {
  const grouped = new Map();

  for await (const entry of view.createReadStream({ gte: "rating:", lt: "rating:~" })) {
    const rating = entry.value;
    const existing = grouped.get(rating.normalizedTarget) || {
      target: rating.target,
      normalizedTarget: rating.normalizedTarget,
      count: 0,
      total: 0,
    };
    existing.count += 1;
    existing.total += rating.score;
    grouped.set(rating.normalizedTarget, existing);
  }

  return [...grouped.values()]
    .map((row) => ({
      target: row.target,
      normalizedTarget: row.normalizedTarget,
      count: row.count,
      average: Number((row.total / row.count).toFixed(2)),
    }))
    .sort((a, b) => a.target.localeCompare(b.target));
}

export async function readRatingsHistory(view) {
  const history = [];
  for await (const entry of view.createReadStream({ gte: "rating:", lt: "rating:~" })) {
    history.push(entry.value);
  }
  return history;
}

export function normalizeTarget(target) {
  return String(target || "").trim().toLowerCase();
}

function isValidRating(value) {
  return isObject(value)
    && value.type === "rating"
    && typeof value.ratingId === "string"
    && value.ratingId.length > 0
    && isValidTarget(value.target)
    && Number.isInteger(value.score)
    && value.score >= 1
    && value.score <= 5
    && isValidReviewerName(value.reviewerName)
    && typeof value.createdAt === "string"
    && value.createdAt.length > 0;
}

function isValidTarget(target) {
  return typeof target === "string" && target.trim().length > 0;
}

function isValidReviewerName(name) {
  return typeof name === "string" && name.trim().length > 0;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
