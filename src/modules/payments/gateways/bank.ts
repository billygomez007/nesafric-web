import { GhanaCollectionGatewayAdapter } from "./shared";

/**
 * Bank-transfer readiness adapter (e.g. dedicated virtual account / direct-debit collection).
 * Registered so BANK_TRANSFER checkouts have somewhere to route once a processor is configured;
 * until then `isConfigured()` reports unavailable and `createIntent` fails closed.
 */
export class BankTransferAdapter extends GhanaCollectionGatewayAdapter {
  constructor() {
    super({
      key: "bank-transfer-gh",
      displayName: "Bank transfer",
      supportedMethods: ["BANK_TRANSFER"],
      baseUrlEnv: "BANK_TRANSFER_PAYMENTS_BASE_URL",
      apiKeyEnv: "BANK_TRANSFER_PAYMENTS_API_KEY",
      webhookSecretEnv: "BANK_TRANSFER_PAYMENTS_WEBHOOK_SECRET",
      signatureHeader: "x-bank-transfer-signature",
    });
  }
}
