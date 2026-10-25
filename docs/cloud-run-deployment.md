# NesAfric web on Google Cloud Run

NesAfric web is built from this GitHub repository by Google Cloud Build and runs on Google Cloud Run. Vercel is no longer needed. The database, file storage, WhatsApp (Meta), SMS, email and AI providers stay where they are; only the web app moves.

```
GitHub (push to main)
   │  Cloud Build trigger
   ▼
Cloud Build ── docker build (Dockerfile) ──► Artifact Registry  (web:<sha>, migrate:<sha>)
   │  1. Cloud Run job  nesafric-web-migrate   prisma migrate deploy
   │  2. Cloud Run      nesafric-web           new revision, 100% traffic
   ▼
Cloud Run service nesafric-web  ◄── nesafric.com / www.nesafric.com (domain mapping)
   │  secrets from Secret Manager, optional static outbound IP (Cloud NAT)
   ├──► existing Postgres (DATABASE_URL)
   └──► existing storage, Meta, SMS, email, AI
Cloud Scheduler ── every 5 min ──► POST /api/jobs/run  (x-jobs-run-secret)
```

## Files

| File | Purpose |
|---|---|
| `Dockerfile` | `runner` target: the traced Next.js standalone server on port 8080, running as a non-root user. `migrate` target: Prisma CLI and migrations. |
| `.dockerignore` | Keeps `.env*`, `.git`, tests, mobile and docs out of the image. |
| `cloudbuild.yaml` | Build both images, push them, run migrations as a Cloud Run job, then deploy the new image. A failed migration stops the rollout, and the running revision keeps serving. |
| `deploy/cloud-run/setup.sh` | One-time, re-runnable project setup: APIs, registry, service accounts, secrets, service settings, the scheduler job and the optional static IP. |
| `deploy/cloud-run/read-env.py` | Reads the env file for `setup.sh`, decoding dotenv quoting and escapes, and checks JSON values. |
| `next.config.ts` | `output: "standalone"`. |

### Code changes for Cloud Run

- **Client IP** (`src/platform/security/client-ip.ts`): on Cloud Run (`K_SERVICE` is set), the rate-limit identity is the last `x-forwarded-for` entry, the address Google's front end appends. A value the caller sends sits before it and is ignored. Behind a Google load balancer, set `CLOUD_RUN_BEHIND_LOAD_BALANCER=true`. Cloudflare in front still needs `TRUST_CLOUDFLARE_CLIENT_IP=true`, as before.
- **Storage guard** (`src/platform/storage/environment.ts`): Cloud Run's disk does not survive an instance stopping. Without GCS or S3 configured, uploads therefore fail clearly, as on Vercel, instead of writing to the container disk.
- **WhatsApp reply path**: `after()` works on a self-hosted Next.js server. The service runs with `--no-cpu-throttling`, so the reply work after Meta's 200 keeps its CPU. On shutdown, Next.js finishes pending `after()` callbacks.

## Before you start

1. **A Google Cloud project with billing enabled.** Use your own Google account (billynganyunfor@gmail.com) in the console. Nobody else needs the password, and no key has to be shared.
2. **The production environment values** as a `KEY=VALUE` file, for example `.env.production`. The repository ignores `.env*`, so never commit this file. It holds the variables Vercel had: `DATABASE_URL`, `SESSION_SECRET`, `JOBS_RUN_SECRET`, `OTP_HASH_SECRET`, the `WHATSAPP_*`, `ARKESEL_*`, `RESEND_*`, `GOOGLE_OAUTH_*`, `STORAGE_*` and `AI_PROVIDER_*` values, and so on.
   - The Vercel dashboard (Project → Settings → Environment Variables) still shows them while the account is blocked. `vercel env pull .env.production --environment=production` also works.
   - Keep the file in Cloud Shell only, and delete it after setup.
3. **Database network access.** Vercel Secure Compute gave the app fixed outbound IPs.
   - If the database only accepts listed IPs, run the setup with `USE_STATIC_EGRESS=true`, then add the printed IP to the database allowlist **next to** the Vercel IPs. Do not remove the Vercel IPs until the switch is done.
   - If the database accepts any IP with a password and TLS, which is common on Neon, Supabase and similar hosts, nothing is needed.
4. **Region.** Choose the region closest to the database. The default is `europe-west1` (Belgium), which supports domain mapping and is a short hop from most European database regions.
5. **Storage.** Production must have GCS or S3/R2 configured (`STORAGE_GCS_*` or `STORAGE_S3_*`), as it did on Vercel. For GCS in the same project, the runtime service account `nesafric-web` can be granted access to the buckets instead of setting `GOOGLE_SERVICE_ACCOUNT_JSON`.

## Step 1: project setup (Cloud Shell)

Open https://shell.cloud.google.com, signed in as the project owner, and run:

```bash
git clone https://github.com/billygomez007/nesafric-web.git && cd nesafric-web
# upload .env.production with the Cloud Shell "Upload" menu, then:
PROJECT_ID=<your-project-id> ENV_FILE=~/.env.production REGION=europe-west1 \
  USE_STATIC_EGRESS=false bash deploy/cloud-run/setup.sh
rm ~/.env.production
```

The script prints the `*.run.app` service URL and the Cloud Build substitutions to use. Until the first build, the service shows Google's sample page.

`NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_GTM_ID` are not stored as secrets. Next.js inlines them into the browser bundle at build time, so they travel as the build substitutions `_SITE_URL` and `_GTM_ID`. Without the production `_GTM_ID`, the build ships with Google Tag Manager and all analytics events switched off.

The env file is read the way dotenv reads it (`deploy/cloud-run/read-env.py`): quotes are removed and escapes such as `\"` and `\n` are decoded, as `vercel env pull` writes them. A value that looks like JSON (for example `GOOGLE_SERVICE_ACCOUNT_JSON`) must parse, or the script stops before writing any secret.

## Step 2: first build

Use the substitutions printed in step 1, for example:

```bash
gcloud builds submit --config cloudbuild.yaml --region=europe-west1 \
  --gcs-source-staging-dir=gs://<your-project-id>_cloudbuild/source \
  --substitutions=COMMIT_SHA=$(git rev-parse HEAD),_REGION=europe-west1,_STATIC_EGRESS=false,_SITE_URL=https://www.nesafric.com,_GTM_ID=<GTM-XXXXXXX> \
  --service-account=projects/<your-project-id>/serviceAccounts/nesafric-web-deployer@<your-project-id>.iam.gserviceaccount.com
```

## Step 3: deploy on every push to main

1. Open Cloud Build → Triggers → **Connect repository**, choose GitHub, and install the Google Cloud Build app on `billygomez007/nesafric-web` only.
2. Create a trigger with these settings:
   - Event: push to branch `^main$`.
   - Configuration: `cloudbuild.yaml`.
   - Region: same as the service.
   - Service account: `nesafric-web-deployer`.
   - Substitutions: `_REGION`, `_STATIC_EGRESS`, `_SITE_URL` and `_GTM_ID`, as printed in step 1.

Builds run on Google Cloud, not GitHub Actions, so they do not use GitHub Actions minutes.

## Step 4: test on the run.app URL (production DNS untouched)

Work through the checklist below against `https://<service>.run.app`. Logging in with Google from that URL needs it added as an authorised redirect URI on the OAuth client. Without it, test with email or OTP sign-in.

- [ ] `/api/health` returns `HEALTHY` with the database `UP`.
- [ ] The home page, `/marketplace/properties`, a listing page and a professional profile load.
- [ ] Sign in, sign out, and an SMS OTP code arrives.
- [ ] An upload (a listing photo or logo) succeeds and is visible after a new deploy.
- [ ] `gcloud scheduler jobs run nesafric-jobs-run --location=<region>` succeeds, and the logs show `/api/jobs/run` returning 200.
- [ ] Logs show no `STORAGE_NOT_CONFIGURED`, `JOBS_RUN_NOT_CONFIGURED` or database connection errors.
- [ ] Guest write limits: two quick enquiries from the same phone and browser are counted against the same IP.

## Step 5: switch the domain (needs your approval at the time)

1. In Cloud Run → Manage custom domains, add `nesafric.com` and `www.nesafric.com` for `nesafric-web`. Google lists the DNS records to create.
2. **Before changing DNS**, write down the current DNS records for both names. They are the rollback.
3. Change the records at the DNS provider.
   - If the DNS is on Cloudflare, set the records to **DNS only** (grey cloud) until the Google certificate is issued.
   - The certificate usually takes 15 to 60 minutes after DNS resolves.
4. Nothing changes in Meta (`https://www.nesafric.com/api/webhooks/whatsapp`), the mobile app (`https://www.nesafric.com`) or Google OAuth, because the domain stays the same.
5. Re-run the step 4 checklist on `https://www.nesafric.com`. Then send a real WhatsApp message to +233 50 282 0002 and check that a reply arrives.

## Rollback

- **Bad release:** move traffic back to the previous revision. It takes seconds, and the database is unaffected unless the release carried a migration.

  ```bash
  gcloud run revisions list --service=nesafric-web --region=<region>
  gcloud run services update-traffic nesafric-web --region=<region> --to-revisions=<previous-revision>=100
  ```

- **Domain:** restore the DNS records you wrote down in step 5. This only helps while the old host can still serve. The Vercel account is blocked, so after the switch the previous Cloud Run revision is the practical rollback.
- **Migrations** are not undone by moving traffic. Before merging a release that drops or renames a column, check that the previous revision still works against the new schema, or fix forward.

## Cost (estimate, europe-west1)

| Item | Monthly |
|---|---|
| Cloud Run: 1 vCPU and 1 GiB, CPU always allocated. The 5-minute scheduler keeps an instance warm most of the time. | about $40–55 after the free tier |
| Cloud Build | free tier, 2,500 build-minutes a month on the default machine |
| Artifact Registry | about $0.10 per GB stored. Delete old images with a cleanup policy. |
| Secret Manager | under $1 |
| Cloud Scheduler | free (3 jobs free per billing account) |
| Static outbound IP: Cloud NAT and a reserved address (only with `USE_STATIC_EGRESS=true`) | about $5 |

To cost less, the scheduler can run every 15 minutes (`--schedule="*/15 * * * *"`). WhatsApp replies do not wait for it, because each webhook processes its own reply path. Reminders, retries and dispatch timeouts then run up to 15 minutes late.

## Retiring Vercel (after the switch)

Once the domain has served from Cloud Run for a few days, Vercel can go. Disconnect the Git integration so pushes stop creating failed "Account is blocked" checks, then remove `vercel.json`. Nothing in the app depends on Vercel. The `VERCEL` checks in `client-ip.ts` and `storage/environment.ts` simply never match on Cloud Run.
