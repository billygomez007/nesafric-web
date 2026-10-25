#!/usr/bin/env bash
# One-time setup of NesAfric web on Google Cloud Run. Run it in Cloud Shell (or anywhere `gcloud`
# is logged in as a project owner) from a clone of this repository:
#
#   PROJECT_ID=my-project ENV_FILE=.env.production bash deploy/cloud-run/setup.sh
#
# ENV_FILE holds the production values (KEY=VALUE lines, the same variables Vercel had). Each one
# becomes a Secret Manager secret of the same name; values are read from the file and never
# printed. NEXT_PUBLIC_* lines are build-time values and are skipped (see cloudbuild.yaml).
#
# Optional:
#   REGION=europe-west1        Put it in or near the database's region.
#   USE_STATIC_EGRESS=true     The database only accepts listed IPs (Vercel Secure Compute did
#                              this): all traffic leaves through Cloud NAT on one reserved IP,
#                              which is printed at the end for the database allowlist.
#   SERVICE=nesafric-web
#
# Safe to re-run: existing resources are kept, and secrets get a new version only when the value
# in ENV_FILE changed. It touches nothing outside PROJECT_ID: no DNS, no Vercel.
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID}"
: "${ENV_FILE:?Set ENV_FILE to the production env file}"
REGION="${REGION:-europe-west1}"
SERVICE="${SERVICE:-nesafric-web}"
REPOSITORY=nesafric
RUNTIME_SA="nesafric-web-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
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
for account in nesafric-web-runtime nesafric-web-deployer; do
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

step "Secrets from ${ENV_FILE} (values are not printed)"
secret_flags=()
JOBS_RUN_SECRET_VALUE=""
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
  line="${line#export }"
  key="${line%%=*}"; value="${line#*=}"
  [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || continue
  case "$key" in NEXT_PUBLIC_*|VERCEL|VERCEL_*|PORT|K_SERVICE|K_REVISION|K_CONFIGURATION) continue ;; esac
  # Strip one pair of surrounding quotes, as dotenv does.
  if [[ "$value" =~ ^\"(.*)\"$ ]] || [[ "$value" =~ ^\'(.*)\'$ ]]; then value="${BASH_REMATCH[1]}"; fi
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
done < "$ENV_FILE"
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
cat <<NEXT
Next:
  1. Connect GitHub to Cloud Build and create the trigger (docs/cloud-run-deployment.md, step 3),
     with substitutions _REGION=${REGION} _STATIC_EGRESS=${USE_STATIC_EGRESS}.
  2. Run the trigger once, then check ${URL}/api/health.
NEXT
