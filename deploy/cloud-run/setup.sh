#!/usr/bin/env bash
# One-time setup of NesAfric web on Google Cloud Run. Run it in Cloud Shell (or anywhere `gcloud`
# is logged in as a project owner) from a clone of this repository:
#
#   PROJECT_ID=my-project ENV_FILE=.env.production bash deploy/cloud-run/setup.sh
#
# ENV_FILE holds the production values (KEY=VALUE lines, the same variables Vercel had). Each one
# becomes a Secret Manager secret of the same name; values are read from the file and never
# printed. NEXT_PUBLIC_* lines are build-time values, not secrets (see cloudbuild.yaml).
#
# Optional:
#   REGION=europe-west1        Put it in or near the database's region.
#   USE_STATIC_EGRESS=true     The database only accepts listed IPs (Vercel Secure Compute did
#                              this): all traffic leaves through Cloud NAT on one reserved IP,
#                              which is printed at the end for the database allowlist.
#   SERVICE=nesafric-web
#
# NEXT_PUBLIC_SITE_URL and NEXT_PUBLIC_GTM_ID are not secrets: they are inlined at build time, so
# the script prints them as the Cloud Build substitutions _SITE_URL and _GTM_ID to use.
#
# Safe to re-run: existing resources are kept, and secrets get a new version only when the value
# in ENV_FILE changed. It touches nothing outside PROJECT_ID: no DNS, no Vercel.
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID}"
: "${ENV_FILE:?Set ENV_FILE to the production env file}"
REGION="${REGION:-europe-west1}"
SERVICE="${SERVICE:-nesafric-web}"
REPOSITORY=nesafric
RUNTIME_SA="nesafric-web@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_SA="nesafric-web-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
USE_STATIC_EGRESS="${USE_STATIC_EGRESS:-false}"
[ -f "$ENV_FILE" ] || { echo "ENV_FILE not found: $ENV_FILE" >&2; exit 1; }

gcloud config set project "$PROJECT_ID" >/dev/null
step() { printf '\n== %s\n' "$*"; }

step "Enabling APIs"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com cloudscheduler.googleapis.com iam.googleapis.com compute.googleapis.com

step "Artifact Registry repository ${REPOSITORY}"
gcloud artifacts repositories describe "$REPOSITORY" --location="$REGION" >/dev/null 2>&1 ||
  gcloud artifacts repositories create "$REPOSITORY" --location="$REGION" --repository-format=docker \
    --description="NesAfric web images"

step "Service accounts"
for account in nesafric-web nesafric-web-deployer; do
  gcloud iam service-accounts describe "${account}@${PROJECT_ID}.iam.gserviceaccount.com" >/dev/null 2>&1 ||
    gcloud iam service-accounts create "$account" --display-name="$account"
done
# The deployer is what the Cloud Build trigger runs as.
for role in roles/run.admin roles/artifactregistry.writer roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${DEPLOY_SA}" \
    --role="$role" --condition=None >/dev/null
done
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --member="serviceAccount:${DEPLOY_SA}" \
  --role=roles/iam.serviceAccountUser >/dev/null
# `gcloud builds submit` uploads the source to this bucket and the build, running as the deployer,
# reads it from there. Access is granted on this bucket only, not on the upload buckets.
SOURCE_BUCKET="gs://${PROJECT_ID}_cloudbuild"
gcloud storage buckets describe "$SOURCE_BUCKET" >/dev/null 2>&1 ||
  gcloud storage buckets create "$SOURCE_BUCKET" --location="$REGION" --uniform-bucket-level-access
for role in roles/storage.objectViewer roles/storage.legacyBucketReader; do
  gcloud storage buckets add-iam-policy-binding "$SOURCE_BUCKET" --member="serviceAccount:${DEPLOY_SA}" \
    --role="$role" >/dev/null
done

step "Secrets from ${ENV_FILE} (values are not printed)"
secret_flags=()
JOBS_RUN_SECRET_VALUE=""
SITE_URL_VALUE=""
GTM_ID_VALUE=""
# read-env.py decodes dotenv quoting and escapes (as `vercel env pull` writes them) and checks
# JSON values; it prints NUL-separated pairs, so values with newlines arrive intact. A parse error
# stops the script before any secret is written. The pairs file is private (mktemp is 0600).
pairs="$(mktemp)"
trap 'rm -f "$pairs"' EXIT
python3 "$(dirname "$0")/read-env.py" "$ENV_FILE" > "$pairs"
while IFS= read -r -d '' key && IFS= read -r -d '' value; do
  [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || continue
  case "$key" in
    # Build-time values: inlined into the browser bundle by Cloud Build, not runtime secrets.
    NEXT_PUBLIC_SITE_URL) SITE_URL_VALUE="$value"; continue ;;
    NEXT_PUBLIC_GTM_ID) GTM_ID_VALUE="$value"; continue ;;
    NEXT_PUBLIC_*|VERCEL|VERCEL_*|PORT|K_SERVICE|K_REVISION|K_CONFIGURATION) continue ;;
  esac
  [ -n "$value" ] || continue
  [ "$key" = JOBS_RUN_SECRET ] && JOBS_RUN_SECRET_VALUE="$value"
  if ! gcloud secrets describe "$key" >/dev/null 2>&1; then
    gcloud secrets create "$key" --replication-policy=automatic >/dev/null
  fi
  current="$(gcloud secrets versions access latest --secret="$key" 2>/dev/null || true)"
  if [ "$current" != "$value" ]; then
    printf '%s' "$value" | gcloud secrets versions add "$key" --data-file=- >/dev/null
    echo "  ${key}: new version"
  else
    echo "  ${key}: unchanged"
  fi
  gcloud secrets add-iam-policy-binding "$key" --member="serviceAccount:${RUNTIME_SA}" \
    --role=roles/secretmanager.secretAccessor >/dev/null
  secret_flags+=("${key}=${key}:latest")
done < "$pairs"
rm -f "$pairs"
for required in DATABASE_URL SESSION_SECRET JOBS_RUN_SECRET; do
  printf '%s\n' "${secret_flags[@]}" | grep -q "^${required}=" ||
    { echo "ENV_FILE must set ${required}" >&2; exit 1; }
done

network_flags=()
if [ "$USE_STATIC_EGRESS" = "true" ]; then
  step "Static outbound IP (Cloud NAT)"
  gcloud compute addresses describe nesafric-egress --region="$REGION" >/dev/null 2>&1 ||
    gcloud compute addresses create nesafric-egress --region="$REGION"
  gcloud compute routers describe nesafric-router --region="$REGION" >/dev/null 2>&1 ||
    gcloud compute routers create nesafric-router --network=default --region="$REGION"
  gcloud compute routers nats describe nesafric-nat --router=nesafric-router --region="$REGION" >/dev/null 2>&1 ||
    gcloud compute routers nats create nesafric-nat --router=nesafric-router --region="$REGION" \
      --nat-custom-subnet-ip-ranges=default --nat-external-ip-pool=nesafric-egress
  network_flags=(--network=default --subnet=default --vpc-egress=all-traffic)
fi

step "Cloud Run service ${SERVICE}"
# Until the first Cloud Build rollout, the service runs Google's sample image; the build replaces it.
image="$(gcloud run services describe "$SERVICE" --region="$REGION" --format='value(spec.template.spec.containers[0].image)' 2>/dev/null || true)"
image="${image:-us-docker.pkg.dev/cloudrun/container/hello}"
# --no-cpu-throttling keeps CPU on after a response, which the WhatsApp reply path needs (it runs in
# after(), right after Meta gets its 200). --timeout matches the longest route (120 s webhook).
gcloud run deploy "$SERVICE" --region="$REGION" --image="$image" \
  --service-account="$RUNTIME_SA" --allow-unauthenticated \
  --port=8080 --cpu=1 --memory=1Gi --concurrency=80 --timeout=300 \
  --min-instances=0 --max-instances=4 --no-cpu-throttling --cpu-boost \
  --set-env-vars="NODE_ENV=production" \
  --set-secrets="$(IFS=,; echo "${secret_flags[*]}")" \
  "${network_flags[@]}"
URL="$(gcloud run services describe "$SERVICE" --region="$REGION" --format='value(status.url)')"

step "Cloud Scheduler: /api/jobs/run every 5 minutes"
gcloud services enable cloudscheduler.googleapis.com >/dev/null
scheduler=(--schedule="*/5 * * * *" --time-zone=Etc/UTC --uri="${URL}/api/jobs/run" --http-method=POST
  --headers="x-jobs-run-secret=${JOBS_RUN_SECRET_VALUE}" --attempt-deadline=300s --location="$REGION")
if gcloud scheduler jobs describe nesafric-jobs-run --location="$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http nesafric-jobs-run "${scheduler[@]}" >/dev/null
else
  gcloud scheduler jobs create http nesafric-jobs-run "${scheduler[@]}" >/dev/null
fi

step "Done"
echo "Service URL:  ${URL}"
[ "$USE_STATIC_EGRESS" = "true" ] &&
  echo "Outbound IP:  $(gcloud compute addresses describe nesafric-egress --region="$REGION" --format='value(address)')  (add it to the database allowlist)"
SUBSTITUTIONS="_REGION=${REGION},_STATIC_EGRESS=${USE_STATIC_EGRESS},_SITE_URL=${SITE_URL_VALUE:-https://www.nesafric.com},_GTM_ID=${GTM_ID_VALUE}"
[ -n "$GTM_ID_VALUE" ] || echo "Note: ENV_FILE has no NEXT_PUBLIC_GTM_ID; analytics stay off until _GTM_ID is set."
cat <<NEXT
Cloud Build substitutions (use them for the first build and the trigger):
  ${SUBSTITUTIONS}
Next:
  1. First build (docs/cloud-run-deployment.md, step 2):
       gcloud builds submit --config cloudbuild.yaml --region=${REGION} \\
         --gcs-source-staging-dir=${SOURCE_BUCKET}/source \\
         --substitutions=COMMIT_SHA=\$(git rev-parse HEAD),${SUBSTITUTIONS} \\
         --service-account=projects/${PROJECT_ID}/serviceAccounts/${DEPLOY_SA}
  2. Connect GitHub to Cloud Build and create the trigger with the same substitutions (step 3).
  3. Check ${URL}/api/health.
NEXT
