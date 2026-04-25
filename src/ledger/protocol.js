import hypercoreCrypto from 'hypercore-crypto'
import b4a from 'b4a'
import Hyperbee from 'hyperbee'

export function openLedgerView(store) {
  return new Hyperbee(store.get('shared-ledger'), {
    keyEncoding: 'utf-8',
    valueEncoding: 'json'
  })
}

export function createApply({ authorityPublicKeyPem }) {
  return async function apply(nodes, view, host) {
    for (const node of nodes) {
      if (!node || node.value == null) continue

      const value = node.value
      // console.log(`[ledger:protocol] apply type=${value.type} txId=${value.txId || 'none'}`)

      if (value.type === 'register-account') {
        if (!isValidRegistration(value)) {
          console.warn(`[ledger:protocol] invalid registration for ${value.name}`)
          continue
        }

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
          // console.log(`[ledger:protocol] registered account: ${value.name} (${value.accountId.slice(0, 12)})`)
        }

        if (value.writerKey) {
          await host.ackWriter(b4a.from(value.writerKey, 'hex'))
        }

        continue
      }

      if (value.type === 'grant') {
        if (!isValidGrant(value, authorityPublicKeyPem)) {
          console.warn(`[ledger:protocol] invalid grant for ${value.toAccount}`)
          continue
        }

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
          // console.log(`[ledger:protocol] finalized grant: ${value.amount} -> ${value.toAccount.slice(0, 12)}`)
        }

        continue
      }

      if (value.type === 'transfer-proposal') {
        const sender = await view.get(`account:${value.fromAccount}`)
        if (!sender) {
          // console.warn(`[ledger:protocol] transfer-proposal sender not found: ${value.fromAccount.slice(0, 12)}`)
          continue
        }
        if (!isValidProposal(value, sender.value.publicKeyPem)) {
          console.warn(`[ledger:protocol] invalid transfer-proposal from ${value.fromAccount.slice(0, 12)}`)
          continue
        }

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
          // console.log(`[ledger:protocol] stored proposal: ${value.txId.slice(0, 12)}`)
        }

        await tryFinalizeTransfer(value.txId, view)
        continue
      }

      if (value.type === 'transfer-acceptance') {
        const recipient = await view.get(`account:${value.recipientAccount}`)
        if (!recipient) {
          // console.warn(`[ledger:protocol] transfer-acceptance recipient not found: ${value.recipientAccount.slice(0, 12)}`)
          continue
        }
        if (!isValidAcceptance(value, recipient.value.publicKeyPem)) {
          console.warn(`[ledger:protocol] invalid transfer-acceptance from ${value.recipientAccount.slice(0, 12)}`)
          continue
        }

        await host.ackWriter(node.from.key)

        const existing = await view.get(`acceptance:${value.txId}`)
        if (!existing) {
          await view.put(`acceptance:${value.txId}`, {
            txId: value.txId,
            recipientAccount: value.recipientAccount,
            acceptedAt: value.acceptedAt,
            recipientSignature: value.recipientSignature
          })
          // console.log(`[ledger:protocol] stored acceptance: ${value.txId.slice(0, 12)}`)
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
  if (!proposalEntry || !acceptanceEntry) {
    // console.log(`[ledger:protocol] cannot finalize ${txId.slice(0, 12)} yet: prop=${!!proposalEntry} acc=${!!acceptanceEntry}`)
    return
  }

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
  console.log(`[ledger:protocol] FINALIZED transfer ${txId.slice(0, 12)}: ${proposal.amount} from ${proposal.fromAccount.slice(0, 8)} to ${proposal.toAccount.slice(0, 8)}`)
}

export function createIdentity() {
  const keyPair = hypercoreCrypto.keyPair()
  const publicKeyPem = b4a.toString(keyPair.publicKey, 'hex')
  const privateKeyPem = b4a.toString(keyPair.secretKey, 'hex')

  return {
    accountId: hashId(publicKeyPem),
    publicKeyPem,
    privateKeyPem
  }
}

export function signRegistration(identity, name, writerKey, createdAt = new Date().toISOString()) {
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

export function signGrant(authority, toAccount, amount, txId = b4a.toString(hypercoreCrypto.randomBytes(16), 'hex'), createdAt = new Date().toISOString()) {
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

export function signTransferProposal(identity, toAccount, amount, memo = '', txId = b4a.toString(hypercoreCrypto.randomBytes(16), 'hex'), createdAt = new Date().toISOString()) {
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

export function signTransferAcceptance(identity, txId, acceptedAt = new Date().toISOString()) {
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

export async function computeBalance(view, accountId) {
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

export async function computeAllBalances(view) {
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

export async function listPendingForRecipient(view, accountId) {
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

export async function readHistory(view) {
  const history = []

  for await (const entry of view.createReadStream({ gte: 'entry:', lt: 'entry:~' })) {
    history.push({ key: entry.key, value: entry.value })
  }

  return history
}

export async function findAccountNameById(view, accountId) {
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
  const secretKey = b4a.from(privateKeyPem, 'hex')
  const msg = b4a.from(stableStringify(payload))
  return b4a.toString(hypercoreCrypto.sign(msg, secretKey), 'base64')
}

function verifyPayload(publicKeyPem, payload, signature) {
  if (typeof signature !== 'string' || signature.length === 0) return false
  const publicKey = b4a.from(publicKeyPem, 'hex')
  const sig = b4a.from(signature, 'base64')
  const msg = b4a.from(stableStringify(payload))
  return hypercoreCrypto.verify(msg, sig, publicKey)
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`

  const keys = Object.keys(value).sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

export function hashId(input) {
  return b4a.toString(hypercoreCrypto.hash(b4a.from(input)), 'hex')
}

export function shortId(value) {
  return value.slice(0, 12)
}

function isObject(value) {
  return value && typeof value === 'object'
}
