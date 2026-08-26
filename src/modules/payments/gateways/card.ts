import { GhanaCollectionGatewayAdapter } from "./shared";

/**
 * Card-payments readiness adapter. Registered so the platform can route CARD checkouts through
 * a hosted-checkout processor as soon as credentials are configured; until then `isConfigured()`
 * reports unavailable and `createIntent` fails closed rather than faking a successful checkout.
 */
export class CardPaymentsAdapter extends GhanaCollectionGatewayAdapter {
  constructor() {
    super({
      key: "card-gh",
      displayName: "Card payments",
      supportedMethods: ["CARD"],
      baseUrlEnv: "CARD_PAYMENTS_BASE_URL",
      apiKeyEnv: "CARD_PAYMENTS_API_KEY",
      webhookSecretEnv: "CARD_PAYMENTS_WEBHOOK_SECRET",
      signatureHeader: "x-card-payments-signature",
    });
  }
}
