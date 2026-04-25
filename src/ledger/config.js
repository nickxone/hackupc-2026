const fs = require('fs')
const path = require('path')

const MARKET_CONFIG_FILE = path.resolve(__dirname, '../../config/market.json')

function loadMarketConfig() {
  if (!fs.existsSync(MARKET_CONFIG_FILE)) {
    throw new Error(`Missing market config file: ${MARKET_CONFIG_FILE}`)
  }

  return JSON.parse(fs.readFileSync(MARKET_CONFIG_FILE, 'utf8'))
}

function getLedgerBootstrapKey() {
  const { ledgerBootstrapKey } = loadMarketConfig()
  if (!/^[a-f0-9]{64}$/i.test(ledgerBootstrapKey || '')) {
    throw new Error(`Invalid ledgerBootstrapKey in ${MARKET_CONFIG_FILE}`)
  }

  return ledgerBootstrapKey
}

function getInitialCreditAmount() {
  const { initialCredits } = loadMarketConfig()
  if (!Number.isInteger(initialCredits) || initialCredits <= 0) {
    throw new Error(`Invalid initialCredits in ${MARKET_CONFIG_FILE}`)
  }

  return initialCredits
}

function saveLedgerBootstrapKey(key) {
  if (!/^[a-f0-9]{64}$/i.test(key || '')) {
    throw new Error(`Invalid ledger bootstrap key: ${key}`)
  }

  const current = fs.existsSync(MARKET_CONFIG_FILE) ? loadMarketConfig() : {}
  const next = {
    ...current,
    ledgerBootstrapKey: key
  }

  fs.mkdirSync(path.dirname(MARKET_CONFIG_FILE), { recursive: true })
  fs.writeFileSync(MARKET_CONFIG_FILE, JSON.stringify(next, null, 2) + '\n')
}
module.exports = {
  MARKET_CONFIG_FILE,
  getInitialCreditAmount,
  getLedgerBootstrapKey,
  loadMarketConfig,
  saveLedgerBootstrapKey
}
