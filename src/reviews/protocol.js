const crypto = require('crypto')
const Hyperbee = require('hyperbee')

function openReviewView(store) {
  return new Hyperbee(store.get('shared-reviews'), {
    keyEncoding: 'utf-8',
    valueEncoding: 'json'
  })
}

function createApply() {
  return async function apply(nodes, view, host) {
    for (const node of nodes) {
      if (!node || node.value == null) continue

      const value = node.value
      if (value.type !== 'review') continue
      if (!isValidReview(value)) continue

      await host.ackWriter(node.from.key)

      const existing = await view.get(`review:${value.reviewId}`)
      if (existing) continue

      const targetKeyId = publicKeyId(value.targetPublicKey)
      const reviewerKeyId = publicKeyId(value.reviewerPublicKey)
      const duplicate = await view.get(`tx-review:${value.txId}:${reviewerKeyId}`)
      if (duplicate) continue

      const stored = {
        type: 'review',
        reviewId: value.reviewId,
        txId: value.txId,
        targetPublicKey: value.targetPublicKey,
        reviewerPublicKey: value.reviewerPublicKey,
        stars: value.stars,
        createdAt: value.createdAt,
        signature: value.signature
      }

      await view.put(`review:${value.reviewId}`, stored)
      await view.put(`user-review:${targetKeyId}:${value.reviewId}`, stored)
      await view.put(`reviewer-review:${reviewerKeyId}:${value.reviewId}`, stored)
      await view.put(`tx-review:${value.txId}:${reviewerKeyId}`, stored)
    }
  }
}

function signReview(identity, targetPublicKey, txId, stars, reviewId = crypto.randomUUID(), createdAt = new Date().toISOString()) {
  const payload = reviewPayload({
    reviewId,
    txId,
    targetPublicKey,
    reviewerPublicKey: identity.publicKeyPem,
    stars,
    createdAt
  })

  return {
    type: 'review',
    ...payload,
    signature: signPayload(identity.privateKeyPem, payload)
  }
}

async function getReviewsForUser(view, targetPublicKey) {
  const reviews = []
  const prefix = `user-review:${publicKeyId(targetPublicKey)}:`

  for await (const entry of view.createReadStream({ gte: prefix, lt: `${prefix}~` })) {
    reviews.push(entry.value)
  }

  reviews.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return reviews
}

async function getAverageStarsForUser(view, targetPublicKey) {
  const reviews = await getReviewsForUser(view, targetPublicKey)
  if (reviews.length === 0) return null

  const total = reviews.reduce((sum, review) => sum + review.stars, 0)
  return total / reviews.length
}

function isValidReview(value) {
  if (!isObject(value)) return false
  if (value.type !== 'review') return false
  if (!value.reviewId || !value.txId || !value.targetPublicKey || !value.reviewerPublicKey || !value.createdAt) return false
  if (!Number.isInteger(value.stars) || value.stars < 1 || value.stars > 5) return false
  if (!value.signature) return false

  return verifyPayload(value.reviewerPublicKey, reviewPayload(value), value.signature)
}

function reviewPayload(value) {
  return {
    reviewId: value.reviewId,
    txId: value.txId,
    targetPublicKey: value.targetPublicKey,
    reviewerPublicKey: value.reviewerPublicKey,
    stars: value.stars,
    createdAt: value.createdAt
  }
}

function signPayload(privateKeyPem, payload) {
  return crypto.sign(null, Buffer.from(stableStringify(payload)), privateKeyPem).toString('base64')
}

function verifyPayload(publicKeyPem, payload, signature) {
  if (typeof signature !== 'string' || signature.length === 0) return false

  return crypto.verify(
    null,
    Buffer.from(stableStringify(payload)),
    publicKeyPem,
    Buffer.from(signature, 'base64')
  )
}

function publicKeyId(publicKeyPem) {
  return crypto.createHash('sha256').update(publicKeyPem).digest('hex')
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`

  const keys = Object.keys(value).sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

function isObject(value) {
  return value && typeof value === 'object'
}

module.exports = {
  createApply,
  getAverageStarsForUser,
  getReviewsForUser,
  openReviewView,
  publicKeyId,
  signReview
}
