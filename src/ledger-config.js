import { getCreditPricing, getInitialCreditAmount, getPriceForTier } from "./ledger/config.js";

const pricing = getCreditPricing();

export const ledgerConfig = {
  initialBalance: getInitialCreditAmount(),
  pricePerTokenPerTier: 0.1,
  pricePerRequest: pricing.pricePerRequest,
  tierPrices: pricing.tierPrices,
  getPriceForTier,
};
