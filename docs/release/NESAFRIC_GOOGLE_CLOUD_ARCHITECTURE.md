# NesAfric Google Cloud architecture

Last updated: 22 October 2026.

## 1. Projects (created 22 October 2026)

| | Production | Staging |
|---|---|---|
| Project ID | `nesafric-production` | `nesafric-staging` |
| Project number | 566189824549 | 574250521576 |
| Display name | NesAfric Production | NesAfric Staging |
| Labels | `app=nesafric`, `env=production` | `app=nesafric`, `env=staging` |
| Owner | `billynganyunfor@gmail.com` (no organisation) | same |
| Billing account | `014A23-82CC11-33C0C5` (My Billing Account 1, USD) | same |
| Budget alert | USD 200 / month (`a2b49176-…`) | USD 30 / month (`52fa2fb9-…`) |

Budget thresholds: 50 %, 90 %, 100 % of actual spend and 100 % of forecast spend. Alerts go to the billing account's administrators by email. **Budgets do not cap spending.**

The billing account is shared with Tap & Order (`taporder-staging-d29581`). Only the invoice is shared. No Tap & Order project, service, secret or IAM binding is used or changed. Costs are kept apart by project, labels and separate budgets.

### APIs enabled on both projects

`run`, `cloudbuild`, `artifactregistry`, `secretmanager`, `sqladmin`, `storage`, `cloudscheduler`, `logging`, `monitoring`, `cloudtrace`, `iam`, `iamcredentials`, `cloudresourcemanager`, `billingbudgets`, `cloudbilling`, `cloudkms` (plus Google's defaults such as BigQuery and Dataform, which cost nothing unless used).

Enabling an API costs nothing. Production resources now exist: see `NESAFRIC_PRODUCTION_DEPLOYMENT.md`. Staging has only the empty instance `nesafric-staging-db` (`db-f1-micro`).

### Older NesAfric projects (not touched)

| Project | Account | State |
|---|---|---|
| `nesafric` | info@realtegicworks.com | Suspended (billing). Holds suspended Cloud SQL `nesafric-prod-db`. Do not delete until its contents are checked. |
| `nesafric-ac521` | info@realtegicworks.com | Firebase; Data Connect free-trial `db-f1-micro`. Unused by the app. |
| `realtegic-nesafric-386174` | info@realtegicworks.com | Search Console, Tag Manager, Play, Analytics. Keep. |

## 2. Target architecture (proposed, not yet provisioned)

The backend is the Next.js app itself (API routes). It runs on Cloud Run as one container built with Next.js `output: "standalone"`.

| Component | Service | Notes |
|---|---|---|
| Web + API + WhatsApp webhook | Cloud Run service `nesafric-web` | Production: min 1 instance so webhooks answer fast. Staging: min 0. |
| Background jobs | Cloud Run Job `nesafric-worker`, triggered by Cloud Scheduler every minute | Replaces the Vercel cron. Uses the existing Postgres job queue; no Redis needed. |
| Database | Cloud SQL for PostgreSQL 18 **or** keep Neon | Decision pending. |
| Media | Cloud Storage: one public bucket (listing photos), one private bucket (identity documents, CMEK, uniform access, no public access) | `src/platform/storage/gcs-adapter.ts` exists. |
| Secrets | Secret Manager | One secret per env var; mounted into Cloud Run. |
| Images | Artifact Registry `europe-west1-docker.pkg.dev/<project>/nesafric` | |
| CI/CD | Cloud Build or GitHub Actions with Workload Identity Federation | GitHub Actions currently fails at startup; fix first. |
| Region | `europe-west1` | Low latency to Ghana; Tier 1 pricing. |

## 3. Cost estimate (USD / month)

| Item | Production | Staging |
|---|---|---|
| Cloud Run web (1 always-on instance) | 45–55 | 0–5 |
| Worker + Scheduler | 5–10 | 2 |
| Cloud SQL (1 vCPU / 3.75 GB, single zone; HA doubles) | ~55 (~110 HA) | ~10 |
| Storage, secrets, registry, logging | ~5 | ~3 |
| **Total** | **110–180** | **15–20** |

Keeping Neon removes the Cloud SQL line.

## 4. Approvals still needed before provisioning billable resources

1. Database: Cloud SQL or Neon.
2. Always-on production Cloud Run instance (~USD 50 / month).
3. Region `europe-west1`.
4. NesAfric-owned Meta app and system user (current token belongs to the Tap & Order app).
