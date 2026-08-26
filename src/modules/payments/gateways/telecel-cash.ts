import { GhanaCollectionGatewayAdapter } from "./shared";

/** Telecel Cash (Ghana) mobile-money collections adapter. Environment-configured; no hard-coded credentials. */
export class TelecelCashAdapter extends GhanaCollectionGatewayAdapter {
  constructor() {
    super({
      key: "telecel-cash-gh",
      displayName: "Telecel Cash",
      supportedMethods: ["MOBILE_MONEY"],
      baseUrlEnv: "TELECEL_CASH_BASE_URL",
      apiKeyEnv: "TELECEL_CASH_API_KEY",
      merchantIdEnv: "TELECEL_CASH_MERCHANT_ID",
      webhookSecretEnv: "TELECEL_CASH_WEBHOOK_SECRET",
      signatureHeader: "x-telecel-signature",
    });
  }
}
