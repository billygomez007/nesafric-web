import { describe, expect, it } from "vitest";
import { contentFor } from "@/modules/account-emails/service";
import { BRAND } from "@/platform/brand";
import { renderEmail } from "@/modules/notifications/email-templates/render";

describe("NesAfric team invitation email", () => {
  it("uses the hello@ NesAfric sender and professional invitation subject", () => {
    const email = contentFor(
      "TEAM_INVITATION",
      "there",
      "Golden Coast Properties",
      undefined,
      undefined,
      {
        inviterName: "Ama Boateng",
        roleLabel: "Property Manager",
        invitationExpiresAt: "2026-09-30T00:00:00.000Z",
      },
    );

    expect(email.sender).toBe("hello");
    expect(BRAND.sender[email.sender]).toBe("NesAfric <hello@nesafric.com>");
    expect(email.subject).toBe(
      "You've been invited to join Golden Coast Properties on NesAfric",
    );
  });

  it("contains inviter, workspace, role and expiry information", () => {
    const email = contentFor(
      "TEAM_INVITATION",
      "there",
      "Golden Coast Properties",
      undefined,
      undefined,
      {
        inviterName: "Ama Boateng",
        roleLabel: "Property Manager",
        invitationExpiresAt: "2026-09-30T00:00:00.000Z",
      },
    );

    const rendered = renderEmail(email.content);

    expect(rendered.text).toContain("Ama Boateng");
    expect(rendered.text).toContain("Golden Coast Properties");
    expect(rendered.text).toContain("Property Manager");
    expect(rendered.text).toContain("Open NesAfric");
    expect(rendered.html).toContain(BRAND.siteUrl);
  });

  it("does not expose the invitation token in rendered email text while acceptance flow is not yet implemented", () => {
    const token = "secret-invitation-token";

    const email = contentFor(
      "TEAM_INVITATION",
      "there",
      "Golden Coast Properties",
      undefined,
      undefined,
      {
        inviterName: "Ama Boateng",
        roleLabel: "Property Manager",
        invitationExpiresAt: "2026-09-30T00:00:00.000Z",
        invitationToken: token,
      },
    );

    const rendered = renderEmail(email.content);

    expect(rendered.html).not.toContain(token);
    expect(rendered.text).not.toContain(token);
  });
});
