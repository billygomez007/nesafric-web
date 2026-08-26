import { GhanaCollectionGatewayAdapter } from "./shared";

/** AT Money (AirtelTigo, Ghana) mobile-money collections adapter. Environment-configured; no hard-coded credentials. */
export class AtMoneyAdapter extends GhanaCollectionGatewayAdapter {
  constructor() {
    super({
      key: "at-money-gh",
      displayName: "AT Money",
      supportedMethods: ["MOBILE_MONEY"],
      baseUrlEnv: "AT_MONEY_BASE_URL",
      apiKeyEnv: "AT_MONEY_API_KEY",
      merchantIdEnv: "AT_MONEY_MERCHANT_ID",
      webhookSecretEnv: "AT_MONEY_WEBHOOK_SECRET",
      signatureHeader: "x-at-money-signature",
    });
  }
}
