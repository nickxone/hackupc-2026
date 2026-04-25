import crypto from 'bare-crypto'
import Hyperbee from 'hyperbee'

function openLedgerView(store) {
  return new Hyperbee(store.get('shared-ledger'), {
    keyEncoding: 'utf-8',
    valueEncoding: 'json'
  })
}

function createApply({ authorityPublicKeyPem }) {
  return async function apply(nodes, view, host) {
    for (const node of nodes) {
      if (!node || node.value == null) continue

      const value = node.value

      if (value.type === 'register-account') {
        if (!isValidRegistration(value)) continue

        const existing = await view.get(`account:${value.accountId}`)
        if (!existing) {
          await view.put(`account:${value.accountId}`, {
            accountId: value.accountId,
            name: value.name,
            publicKeyPem: value.publicKeyPem,
            writerKey: value.writerKey,
            createdAt: value.createdAt,
            signature: value.signature
          })
        }

        continue
      }

      if (value.type === 'grant') {
        if (!isValidGrant(value, authorityPublicKeyPem)) continue

        const existing = await view.get(`entry:${value.txId}`)
        if (!existing) {
          await view.put(`entry:${value.txId}`, {
            type: 'grant',
            txId: value.txId,
            toAccount: value.toAccount,
            amount: value.amount,
            createdAt: value.createdAt,
            signatures: {
              authority: value.authoritySignature
            }
          })
        }

        continue
      }

      if (value.type === 'transfer-proposal') {
        const sender = await view.get(`account:${value.fromAccount}`)
        if (!sender) continue
        if (!isValidProposal(value, sender.value.publicKeyPem)) continue

        await host.ackWriter(node.from.key)

        const existing = await view.get(`proposal:${value.txId}`)
        if (!existing) {
          await view.put(`proposal:${value.txId}`, {
            txId: value.txId,
            fromAccount: value.fromAccount,
            toAccount: value.toAccount,
            amount: value.amount,
            memo: value.memo || '',
            createdAt: value.createdAt,
            senderSignature: value.senderSignature
          })
        }

        await tryFinalizeTransfer(value.txId, view)
        continue
      }

      if (value.type === 'transfer-acceptance') {
        const recipient = await view.get(`account:${value.recipientAccount}`)
        if (!recipient) continue
        if (!isValidAcceptance(value, recipient.value.publicKeyPem)) continue

        await host.ackWriter(node.from.key)

        const existing = await view.get(`acceptance:${value.txId}`)
        if (!existing) {
          await view.put(`acceptance:${value.txId}`, {
            txId: value.txId,
            recipientAccount: value.recipientAccount,
            acceptedAt: value.acceptedAt,
            recipientSignature: value.recipientSignature
          })
        }

        await tryFinalizeTransfer(value.txId, view)
      }
    }
  }
}

async function tryFinalizeTransfer(txId, view) {
  const existing = await view.get(`entry:${txId}`)
  if (existing) return

  const proposalEntry = await view.get(`proposal:${txId}`)
  const acceptanceEntry = await view.get(`acceptance:${txId}`)
  if (!proposalEntry || !acceptanceEntry) return

  const proposal = proposalEntry.value
  const acceptance = acceptanceEntry.value
  if (proposal.toAccount !== acceptance.recipientAccount) return

  await view.put(`entry:${txId}`, {
    type: 'transfer',
    txId,
    fromAccount: proposal.fromAccount,
    toAccount: proposal.toAccount,
    amount: proposal.amount,
    memo: proposal.memo,
    createdAt: proposal.createdAt,
    acceptedAt: acceptance.acceptedAt,
    signatures: {
      sender: proposal.senderSignature,
      recipient: acceptance.recipientSignature
    }
  })

  await view.put(`status:${txId}`, {
    txId,
    state: 'finalized'
  })
}

function createIdentity() {
  const keyPair = crypto.generateKeyPairSync('ed25519')
  const publicKeyPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' })
  const privateKeyPem = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' })

  return {
    accountId: hashId(publicKeyPem),
    publicKeyPem,
    privateKeyPem
  }
}

function signRegistration(identity, name, writerKey, createdAt = new Date().toISOString()) {
  const payload = registrationPayload({
    accountId: identity.accountId,
    name,
    publicKeyPem: identity.publicKeyPem,
    writerKey,
    createdAt
  })

  return {
    ...payload,
    signature: signPayload(identity.privateKeyPem, payload)
  }
}

function signGrant(authority, toAccount, amount, txId = crypto.randomUUID(), createdAt = new Date().toISOString()) {
  const payload = grantPayload({
    txId,
    toAccount,
    amount,
    createdAt
  })

  return {
    ...payload,
    authoritySignature: signPayload(authority.privateKeyPem, payload)
  }
}

function signTransferProposal(identity, toAccount, amount, memo = '', txId = crypto.randomUUID(), createdAt = new Date().toISOString()) {
  const payload = proposalPayload({
    txId,
    fromAccount: identity.accountId,
    toAccount,
    amount,
    memo,
    createdAt
  })

  return {
    ...payload,
    senderSignature: signPayload(identity.privateKeyPem, payload)
  }
}

function signTransferAcceptance(identity, txId, acceptedAt = new Date().toISOString()) {
  const payload = acceptancePayload({
    txId,
    recipientAccount: identity.accountId,
    acceptedAt
  })

  return {
    ...payload,
    recipientSignature: signPayload(identity.privateKeyPem, payload)
  }
}

async function computeBalance(view, accountId) {
  let balance = 0

  for await (const entry of view.createReadStream({ gte: 'entry:', lt: 'entry:~' })) {
    const tx = entry.value

    if (tx.type === 'grant' && tx.toAccount === accountId) {
      balance += tx.amount
      continue
    }

    if (tx.type === 'transfer') {
      if (tx.fromAccount === accountId) balance -= tx.amount
      if (tx.toAccount === accountId) balance += tx.amount
    }
  }

  return balance
}

async function computeAllBalances(view) {
  const balances = new Map()

  for await (const entry of view.createReadStream({ gte: 'entry:', lt: 'entry:~' })) {
    const tx = entry.value

    if (tx.type === 'grant') {
      balances.set(tx.toAccount, (balances.get(tx.toAccount) || 0) + tx.amount)
      continue
    }

    if (tx.type === 'transfer') {
      balances.set(tx.fromAccount, (balances.get(tx.fromAccount) || 0) - tx.amount)
      balances.set(tx.toAccount, (balances.get(tx.toAccount) || 0) + tx.amount)
    }
  }

  return balances
}

async function listPendingForRecipient(view, accountId) {
  const pending = []

  for await (const entry of view.createReadStream({ gte: 'proposal:', lt: 'proposal:~' })) {
    const proposal = entry.value
    if (proposal.toAccount !== accountId) continue

    const finalized = await view.get(`entry:${proposal.txId}`)
    const acceptance = await view.get(`acceptance:${proposal.txId}`)
    if (!finalized && !acceptance) pending.push(proposal)
  }

  return pending
}

async function readHistory(view) {
  const history = []

  for await (const entry of view.createReadStream({ gte: 'entry:', lt: 'entry:~' })) {
    history.push({ key: entry.key, value: entry.value })
  }

  return history
}

async function findAccountNameById(view, accountId) {
  const entry = await view.get(`account:${accountId}`)
  return entry ? entry.value.name : null
}

function isValidRegistration(value) {
  if (!isObject(value)) return false
  if (typeof value.writerKey !== 'string' || value.writerKey.length === 0) return false
  if (!value.accountId || !value.name || !value.publicKeyPem || !value.signature) return false
  if (hashId(value.publicKeyPem) !== value.accountId) return false

  return verifyPayload(value.publicKeyPem, registrationPayload(value), value.signature)
}

function isValidGrant(value, authorityPublicKeyPem) {
  if (!isObject(value)) return false
  if (!value.txId || !value.toAccount || !Number.isInteger(value.amount) || value.amount <= 0) return false
  if (!authorityPublicKeyPem || !value.authoritySignature) return false

  return verifyPayload(authorityPublicKeyPem, grantPayload(value), value.authoritySignature)
}

function isValidProposal(value, publicKeyPem) {
  if (!isObject(value)) return false
  if (!value.txId || !value.fromAccount || !value.toAccount) return false
  if (!Number.isInteger(value.amount) || value.amount <= 0) return false
  if (!value.senderSignature) return false

  return verifyPayload(publicKeyPem, proposalPayload(value), value.senderSignature)
}

function isValidAcceptance(value, publicKeyPem) {
  if (!isObject(value)) return false
  if (!value.txId || !value.recipientAccount || !value.acceptedAt) return false
  if (!value.recipientSignature) return false

  return verifyPayload(publicKeyPem, acceptancePayload(value), value.recipientSignature)
}

function registrationPayload(value) {
  return {
    type: 'register-account',
    accountId: value.accountId,
    name: value.name,
    publicKeyPem: value.publicKeyPem,
    writerKey: value.writerKey,
    createdAt: value.createdAt
  }
}

function grantPayload(value) {
  return {
    type: 'grant',
    txId: value.txId,
    toAccount: value.toAccount,
    amount: value.amount,
    createdAt: value.createdAt
  }
}

function proposalPayload(value) {
  return {
    type: 'transfer-proposal',
    txId: value.txId,
    fromAccount: value.fromAccount,
    toAccount: value.toAccount,
    amount: value.amount,
    memo: value.memo || '',
    createdAt: value.createdAt
  }
}

function acceptancePayload(value) {
  return {
    type: 'transfer-acceptance',
    txId: value.txId,
    recipientAccount: value.recipientAccount,
    acceptedAt: value.acceptedAt
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

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`

  const keys = Object.keys(value).sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

function hashId(input) {
  return crypto.createHash('sha256').update(input).digest('hex')
}

function shortId(value) {
  return value.slice(0, 12)
}

function isObject(value) {
  return value && typeof value === 'object'
}

export {
  computeAllBalances,
  computeBalance,
  createApply,
  createIdentity,
  findAccountNameById,
  hashId,
  listPendingForRecipient,
  openLedgerView,
  readHistory,
  shortId,
  signGrant,
  signRegistration,
  signTransferAcceptance,
  signTransferProposal
}
