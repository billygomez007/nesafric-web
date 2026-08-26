import { GhanaCollectionGatewayAdapter } from "./shared";

/**
 * MTN Mobile Money (Ghana) collections adapter. Points at whichever REST endpoint the
 * organisation's MTN MoMo Collections integration (direct Open API or an aggregator) exposes,
 * configured entirely through environment variables — no credentials are hard-coded.
 */
export class MtnMomoAdapter extends GhanaCollectionGatewayAdapter {
  constructor() {
    super({
      key: "mtn-momo-gh",
      displayName: "MTN Mobile Money",
      supportedMethods: ["MOBILE_MONEY"],
      baseUrlEnv: "MTN_MOMO_BASE_URL",
      apiKeyEnv: "MTN_MOMO_API_KEY",
      merchantIdEnv: "MTN_MOMO_SUBSCRIPTION_KEY",
      webhookSecretEnv: "MTN_MOMO_WEBHOOK_SECRET",
      signatureHeader: "x-momo-signature",
    });
  }
}
