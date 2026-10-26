# WhatsApp admin

Platform administration from the official NesAfric WhatsApp number, for a platform principal an
operator has linked. Stage 1: reviews and approvals, and the support inbox. Accounts and
suspensions, and platform and billing, follow.

## Access

- Only an **active platform principal** whose WhatsApp number an operator linked with
  `scripts/whatsapp-admin.ts link` (which also sets a 6-digit PIN, stored hashed) can use it.
  For anyone else, "admin" is not a command.
- **PIN:** asked before the first admin command, then admin stays unlocked for 12 hours.
  `admin lock` locks it at once. 5 wrong PINs lock it for 30 minutes. PIN messages are removed
  from the stored transcript.
- **Every change** is read back and needs **confirm**. Each action runs the same service as the
  web admin (same permissions and audit) and is also audited as `platform_admin.whatsapp_*`.
- **Kill switch:** `scripts/whatsapp-admin.ts revoke --name "<display name>"` turns WhatsApp admin
  off at once; the web admin is unaffected.

## Commands

| Command | Does |
|---|---|
| `admin` | Admin menu (list) |
| `admin queue` | Agents and companies (P-), service providers (S-) and listings (L-) waiting for review, oldest first |
| `admin view <ref>` | Details, plus documents (Ghana Card, certificate) or photos as links that expire in 5 minutes and are removed from the transcript |
| `admin approve <ref> [note]` | Agent/company: verified. Provider: verified. Listing: verified and published |
| `admin changes <ref> <reason>` | Listing: back to the lister for changes. Provider: more information requested |
| `admin reject <ref> <reason>` | Rejects, with the reason sent to them |
| `admin support` | Customers waiting for a person (C-) |
| `admin open <ref>` | The last messages of that chat |
| `admin reply <ref> <message>` | Sends the message as "NesAfric team"; the assistant stays quiet in that chat |
| `admin done <ref>` | Hands the chat back to the assistant and tells the customer |
| `admin lock` | Locks admin now |

Admins also get a WhatsApp alert when a customer asks for a person or writes into a chat a person
is handling (inside the admin's 24-hour window; otherwise `admin support` lists it).

## Setup (production)

Migration `20261026120000_whatsapp_admin_pin` (additive). Then an operator runs the link step with
database access, typing the PIN at a hidden prompt.
