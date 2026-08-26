import { billingProviders } from "../providers";
import { TestBillingAdapter } from "./test";
import { HttpBillingAdapter } from "./http";

// Side-effect module: registers every Phase 20 SaaS billing adapter onto the shared
// `billingProviders` registry the first time the billing module is imported anywhere.
billingProviders.register(new TestBillingAdapter());
billingProviders.register(new HttpBillingAdapter());

export { billingProviders };
