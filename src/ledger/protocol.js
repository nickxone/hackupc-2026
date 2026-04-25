import bareCrypto from "bare-crypto";
import hypercoreCrypto from "hypercore-crypto";
import b4a from "b4a";
import Hyperbee from "hyperbee";
import { getInitialCreditAmount } from "./config.js";

const { createHash, randomUUID } = bareCrypto;

export function openLedgerView(store) {
  return new Hyperbee(store.get("shared-ledger"), {
    keyEncoding: "utf-8",
    valueEncoding: "json",
  });
}

export function createApply() {
  return async function apply(nodes, view, host) {
    for (const node of nodes) {
      if (!node || node.value == null) continue;

      const value = node.value;

      if (value.type === "register-account") {
        if (!isValidRegistration(value)) continue;
        await host.addWriter(node.from.key, { indexer: true });

        const existing = await view.get(`account:${value.accountId}`);
        if (!existing) {
          await view.put(`account:${value.accountId}`, {
            accountId: value.accountId,
            name: value.name,
            publicKey: value.publicKey,
            writerKey: value.writerKey,
            createdAt: value.createdAt,
            signature: value.signature,
          });

          const initialTxId = initialCreditTxId(value.accountId);
          await view.put(`entry:${initialTxId}`, {
            type: "initial-credit",
            txId: initialTxId,
            toAccount: value.accountId,
            amount: getInitialCreditAmount(),
            createdAt: value.createdAt,
            signatures: { account: value.signature },
          });
        }
        continue;
      }

      if (value.type === "transfer-proposal") {
        const sender = await view.get(`account:${value.fromAccount}`);
        const senderPublicKey = sender ? sender.value.publicKey : value.senderPublicKey;
        if (!senderPublicKey) continue;
        if (!isValidProposal(value, senderPublicKey)) continue;

        await host.ackWriter(node.from.key);
        await ensureInlineAccount(view, {
          accountId: value.fromAccount,
          name: value.senderName || shortName(value.fromAccount),
          publicKey: senderPublicKey,
          writerKey: value.senderWriterKey || node.from.key.toString("hex"),
          createdAt: value.createdAt,
        });

        const existing = await view.get(`proposal:${value.txId}`);
        if (!existing) {
          await view.put(`proposal:${value.txId}`, {
            txId: value.txId,
            fromAccount: value.fromAccount,
            toAccount: value.toAccount,
            amount: value.amount,
            memo: value.memo || "",
            createdAt: value.createdAt,
            senderSignature: value.senderSignature,
          });
        }

        await tryFinalizeTransfer(value.txId, view);
        continue;
      }

      if (value.type === "transfer-acceptance") {
        const recipient = await view.get(`account:${value.recipientAccount}`);
        const recipientPublicKey = recipient ? recipient.value.publicKey : value.recipientPublicKey;
        if (!recipientPublicKey) continue;
        if (!isValidAcceptance(value, recipientPublicKey)) continue;

        await host.ackWriter(node.from.key);
        await ensureInlineAccount(view, {
          accountId: value.recipientAccount,
          name: value.recipientName || shortName(value.recipientAccount),
          publicKey: recipientPublicKey,
          writerKey: value.recipientWriterKey || node.from.key.toString("hex"),
          createdAt: value.acceptedAt,
        });

        const existing = await view.get(`acceptance:${value.txId}`);
        if (!existing) {
          await view.put(`acceptance:${value.txId}`, {
            txId: value.txId,
            recipientAccount: value.recipientAccount,
            acceptedAt: value.acceptedAt,
            recipientSignature: value.recipientSignature,
          });
        }

        await tryFinalizeTransfer(value.txId, view);
      }
    }
  };
}

async function tryFinalizeTransfer(txId, view) {
  const existing = await view.get(`entry:${txId}`);
  if (existing) return;

  const proposalEntry = await view.get(`proposal:${txId}`);
  const acceptanceEntry = await view.get(`acceptance:${txId}`);
  if (!proposalEntry || !acceptanceEntry) return;

  const proposal = proposalEntry.value;
  const acceptance = acceptanceEntry.value;
  if (proposal.toAccount !== acceptance.recipientAccount) return;

  await view.put(`entry:${txId}`, {
    type: "transfer",
    txId,
    fromAccount: proposal.fromAccount,
    toAccount: proposal.toAccount,
    amount: proposal.amount,
    memo: proposal.memo,
    createdAt: proposal.createdAt,
    acceptedAt: acceptance.acceptedAt,
    signatures: {
      sender: proposal.senderSignature,
      recipient: acceptance.recipientSignature,
    },
  });

  await view.put(`status:${txId}`, { txId, state: "finalized" });
}

export function createIdentity() {
  const { publicKey, secretKey } = hypercoreCrypto.keyPair();
  const publicKeyHex = b4a.toString(publicKey, "hex");
  const secretKeyHex = b4a.toString(secretKey, "hex");
  return {
    accountId: hashId(publicKeyHex),
    publicKey: publicKeyHex,
    secretKey: secretKeyHex,
  };
}

export function signRegistration(identity, name, writerKey, createdAt = new Date().toISOString()) {
  const payload = registrationPayload({
    accountId: identity.accountId,
    name,
    publicKey: identity.publicKey,
    writerKey,
    createdAt,
  });
  return { ...payload, signature: signPayload(identity.secretKey, payload) };
}

export function signTransferProposal(
  identity,
  toAccount,
  amount,
  memo = "",
  txId = randomUUID(),
  createdAt = new Date().toISOString(),
) {
  const payload = proposalPayload({
    txId,
    fromAccount: identity.accountId,
    toAccount,
    amount,
    memo,
    createdAt,
    senderPublicKey: identity.publicKey,
    senderName: identity.name || null,
  });
  return { ...payload, senderSignature: signPayload(identity.secretKey, payload) };
}

export function signTransferAcceptance(identity, txId, acceptedAt = new Date().toISOString()) {
  const payload = acceptancePayload({
    txId,
    recipientAccount: identity.accountId,
    acceptedAt,
    recipientPublicKey: identity.publicKey,
    recipientName: identity.name || null,
  });
  return { ...payload, recipientSignature: signPayload(identity.secretKey, payload) };
}

export async function computeBalance(view, accountId) {
  let balance = 0;
  for await (const entry of view.createReadStream({ gte: "entry:", lt: "entry:~" })) {
    const tx = entry.value;
    if (tx.type === "initial-credit" && tx.toAccount === accountId) balance += tx.amount;
    if (tx.type === "transfer") {
      if (tx.fromAccount === accountId) balance -= tx.amount;
      if (tx.toAccount === accountId) balance += tx.amount;
    }
  }
  return balance;
}

export async function computeAllBalances(view) {
  const balances = new Map();
  for await (const entry of view.createReadStream({ gte: "entry:", lt: "entry:~" })) {
    const tx = entry.value;
    if (tx.type === "initial-credit") {
      balances.set(tx.toAccount, (balances.get(tx.toAccount) || 0) + tx.amount);
      continue;
    }
    if (tx.type === "transfer") {
      balances.set(tx.fromAccount, (balances.get(tx.fromAccount) || 0) - tx.amount);
      balances.set(tx.toAccount, (balances.get(tx.toAccount) || 0) + tx.amount);
    }
  }
  return balances;
}

export async function listPendingForRecipient(view, accountId) {
  const pending = [];
  for await (const entry of view.createReadStream({ gte: "proposal:", lt: "proposal:~" })) {
    const proposal = entry.value;
    if (proposal.toAccount !== accountId) continue;
    const finalized = await view.get(`entry:${proposal.txId}`);
    const acceptance = await view.get(`acceptance:${proposal.txId}`);
    if (!finalized && !acceptance) pending.push(proposal);
  }
  return pending;
}

export async function readHistory(view) {
  const history = [];
  for await (const entry of view.createReadStream({ gte: "entry:", lt: "entry:~" })) {
    history.push({ key: entry.key, value: entry.value });
  }
  return history;
}

export async function findAccountNameById(view, accountId) {
  const entry = await view.get(`account:${accountId}`);
  return entry ? entry.value.name : null;
}

export async function findAccountByName(view, name) {
  for await (const entry of view.createReadStream({ gte: "account:", lt: "account:~" })) {
    if (entry.value && entry.value.name === name) return entry.value;
  }
  return null;
}

function isValidRegistration(value) {
  if (!isObject(value)) return false;
  if (typeof value.writerKey !== "string" || value.writerKey.length === 0) return false;
  if (!value.accountId || !value.name || !value.publicKey || !value.signature) return false;
  if (hashId(value.publicKey) !== value.accountId) return false;
  return verifyPayload(value.publicKey, registrationPayload(value), value.signature);
}

function isValidProposal(value, publicKey) {
  if (!isObject(value)) return false;
  if (!value.txId || !value.fromAccount || !value.toAccount) return false;
  if (!Number.isInteger(value.amount) || value.amount <= 0) return false;
  if (!value.senderSignature) return false;
  return verifyPayload(publicKey, proposalPayload(value), value.senderSignature);
}

function isValidAcceptance(value, publicKey) {
  if (!isObject(value)) return false;
  if (!value.txId || !value.recipientAccount || !value.acceptedAt) return false;
  if (!value.recipientSignature) return false;
  return verifyPayload(publicKey, acceptancePayload(value), value.recipientSignature);
}

function registrationPayload(value) {
  return {
    type: "register-account",
    accountId: value.accountId,
    name: value.name,
    publicKey: value.publicKey,
    writerKey: value.writerKey,
    createdAt: value.createdAt,
  };
}

function proposalPayload(value) {
  return {
    type: "transfer-proposal",
    txId: value.txId,
    fromAccount: value.fromAccount,
    toAccount: value.toAccount,
    amount: value.amount,
    memo: value.memo || "",
    createdAt: value.createdAt,
    senderPublicKey: value.senderPublicKey || null,
    senderName: value.senderName || null,
  };
}

function acceptancePayload(value) {
  return {
    type: "transfer-acceptance",
    txId: value.txId,
    recipientAccount: value.recipientAccount,
    acceptedAt: value.acceptedAt,
    recipientPublicKey: value.recipientPublicKey || null,
    recipientName: value.recipientName || null,
  };
}

async function ensureInlineAccount(view, account) {
  const existing = await view.get(`account:${account.accountId}`);
  if (existing) return existing;
  if (hashId(account.publicKey) !== account.accountId) return null;

  await view.put(`account:${account.accountId}`, {
    accountId: account.accountId,
    name: account.name,
    publicKey: account.publicKey,
    writerKey: account.writerKey,
    createdAt: account.createdAt,
    signature: null,
  });

  return view.get(`account:${account.accountId}`);
}

function shortName(accountId) {
  return accountId.slice(0, 12);
}

function signPayload(secretKeyHex, payload) {
  const message = b4a.from(stableStringify(payload));
  const secretKey = b4a.from(secretKeyHex, "hex");
  return b4a.toString(hypercoreCrypto.sign(message, secretKey), "base64");
}

function verifyPayload(publicKeyHex, payload, signatureBase64) {
  if (typeof signatureBase64 !== "string" || signatureBase64.length === 0) return false;
  const message = b4a.from(stableStringify(payload));
  const signature = b4a.from(signatureBase64, "base64");
  const publicKey = b4a.from(publicKeyHex, "hex");
  if (signature.byteLength !== 64 || publicKey.byteLength !== 32) return false;
  return hypercoreCrypto.verify(message, signature, publicKey);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

export function hashId(input) {
  return createHash("sha256").update(input).digest("hex");
}

export function shortId(value) {
  return value.slice(0, 12);
}

function initialCreditTxId(accountId) {
  return `initial:${accountId}`;
}

function isObject(value) {
  return value && typeof value === "object";
}
