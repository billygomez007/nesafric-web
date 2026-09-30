import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("business WhatsApp routes", () => {
  it("provider route authenticates before reading or writing WhatsApp configuration", () => {
    const source = read(
      "src/app/api/providers/[providerId]/whatsapp-notifications/route.ts",
    );

    expect(source).toContain("requireUser");
    expect(source).toContain("getProvider");
    expect(source).toContain("resolveServiceProviderWhatsAppSubject");
    expect(source).toContain("getBusinessWhatsAppConfig");
    expect(source).toContain("saveBusinessWhatsAppConfig");
  });

  it("professional route authenticates before reading or writing WhatsApp configuration", () => {
    const source = read(
      "src/app/api/marketplace-professionals/[professionalId]/whatsapp-notifications/route.ts",
    );

    expect(source).toContain("requireUser");
    expect(source).toContain("getMarketplaceProfessional");
    expect(source).toContain(
      "resolveMarketplaceProfessionalWhatsAppSubject",
    );
    expect(source).toContain("getBusinessWhatsAppConfig");
    expect(source).toContain("saveBusinessWhatsAppConfig");
  });
});

describe("business WhatsApp verification routes", () => {
  it("provider verification routes authenticate and authorize before OTP work", () => {
    const requestSource = read(
      "src/app/api/providers/[providerId]/whatsapp-notifications/verification/request/route.ts",
    );
    const verifySource = read(
      "src/app/api/providers/[providerId]/whatsapp-notifications/verification/verify/route.ts",
    );

    for (const source of [requestSource, verifySource]) {
      expect(source).toContain("requireUser");
      expect(source).toContain("getProvider");
      expect(source).toContain(
        "resolveServiceProviderWhatsAppSubject",
      );
      expect(source).toContain('"Cache-Control": "no-store"');
    }

    expect(requestSource).toContain(
      "requestBusinessWhatsAppVerification",
    );
    expect(verifySource).toContain("verifyBusinessWhatsApp");
  });

  it("professional verification routes authenticate and authorize before OTP work", () => {
    const requestSource = read(
      "src/app/api/marketplace-professionals/[professionalId]/whatsapp-notifications/verification/request/route.ts",
    );
    const verifySource = read(
      "src/app/api/marketplace-professionals/[professionalId]/whatsapp-notifications/verification/verify/route.ts",
    );

    for (const source of [requestSource, verifySource]) {
      expect(source).toContain("requireUser");
      expect(source).toContain("getMarketplaceProfessional");
      expect(source).toContain(
        "resolveMarketplaceProfessionalWhatsAppSubject",
      );
      expect(source).toContain('"Cache-Control": "no-store"');
    }

    expect(requestSource).toContain(
      "requestBusinessWhatsAppVerification",
    );
    expect(verifySource).toContain("verifyBusinessWhatsApp");
  });

  it("does not expose the verification marker directly from API routes", () => {
    const paths = [
      "src/app/api/providers/[providerId]/whatsapp-notifications/verification/request/route.ts",
      "src/app/api/providers/[providerId]/whatsapp-notifications/verification/verify/route.ts",
      "src/app/api/marketplace-professionals/[professionalId]/whatsapp-notifications/verification/request/route.ts",
      "src/app/api/marketplace-professionals/[professionalId]/whatsapp-notifications/verification/verify/route.ts",
    ];

    for (const routePath of paths) {
      expect(read(routePath)).not.toContain(
        "markBusinessWhatsAppVerified",
      );
    }
  });
});
