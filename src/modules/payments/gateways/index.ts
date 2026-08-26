import { paymentProviders } from "../providers";
import { MtnMomoAdapter } from "./mtn-momo";
import { TelecelCashAdapter } from "./telecel-cash";
import { AtMoneyAdapter } from "./at-money";
import { CardPaymentsAdapter } from "./card";
import { BankTransferAdapter } from "./bank";

export const mtnMomo = new MtnMomoAdapter();
export const telecelCash = new TelecelCashAdapter();
export const atMoney = new AtMoneyAdapter();
export const cardPayments = new CardPaymentsAdapter();
export const bankTransfer = new BankTransferAdapter();

export const ghanaPaymentGateways = [mtnMomo, telecelCash, atMoney, cardPayments, bankTransfer] as const;

let registered = false;

/**
 * Registers the Ghana mobile-money, card, and bank-transfer gateways onto the shared
 * provider-neutral registry used by the payments service. Idempotent: safe to import/call from
 * multiple entry points (API routes, tests) without triggering the registry's
 * already-registered guard.
 */
export function registerGhanaPaymentGateways() {
  if (registered) return;
  for (const adapter of ghanaPaymentGateways) paymentProviders.register(adapter);
  registered = true;
}

registerGhanaPaymentGateways();

export { MtnMomoAdapter, TelecelCashAdapter, AtMoneyAdapter, CardPaymentsAdapter, BankTransferAdapter };
export { GhanaCollectionGatewayAdapter, providerUnavailable } from "./shared";
export type { CollectionGatewayConfig } from "./shared";
