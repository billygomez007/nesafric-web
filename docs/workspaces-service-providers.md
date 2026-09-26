# `/api/workspaces`: service providers

`GET /api/workspaces` (and the web login response, which reuses `listUserWorkspaces`) now has a third collection next to `propertyOsOrganisations` and `marketplaceProfessionals`:

```json
"serviceProviders": [
  { "id": "…", "displayName": "Kofi Plumbing", "type": "INDIVIDUAL", "slug": "kofi-plumbing",
    "verificationStatus": "UNVERIFIED", "availabilityStatus": "UNAVAILABLE", "suspended": false }
]
```

- **Who is listed:** providers the signed-in user *owns*, under the same rule as `ownsProvider` (now the shared `ownedProviderWhere`):
  - the individual provider's user;
  - the provider's administrator;
  - an ACTIVE owner or administrator of the provider's company organisation.
  - Archived providers are never listed.
- **What is returned:** status fields only. No contact details, legal name, evidence, review notes or the suspension reason. `suspended` only says whether a platform suspension is in place.
- **Why:** the mobile app needs this to find the Service Provider workspace. Owners could already open `/api/providers/:id`, `/jobs` and `/metrics` without an organisation header, but nothing told the app which ids those were.
- **Compatibility:** the change is additive. Existing web consumers (the workspace switcher, Google sign-in completion) ignore the new key, and the mobile app treats a missing key as "no provider profiles".
- **Release:** no migration. The Service Provider workspace appears in the app only once this web change is deployed to the API the app points at.
- **Tests:** `tests/postgres-workspaces-providers.integration.test.ts`.
