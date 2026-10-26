#!/usr/bin/env bash
# Sets up and deploys the share service behind b.cuplex.org. Safe to run again: it creates only
# what's missing, then deploys the service and the Firebase Hosting site in front of it.
#
# Needs the Google Cloud CLI and Node. Sign in once first:
#   gcloud auth login
#   npx firebase-tools login
# Then, from Git Bash or any bash:
#   bash share-service/deploy.sh
set -euo pipefail

PROJECT=elemental-apex-511507-g2
REGION=europe-west3
SERVICE=bridge-share
BUCKET="$PROJECT-shared-bridges"
ACCOUNT="$SERVICE@$PROJECT.iam.gserviceaccount.com"
GAME_ORIGIN=https://bridgebuilder.cuplex.org
PUBLIC_ORIGIN=https://b.cuplex.org
HERE="$(cd "$(dirname "$0")" && pwd)"
FIREBASE="npx -y firebase-tools@latest"

echo "== APIs"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  storage.googleapis.com firebase.googleapis.com firebasehosting.googleapis.com --project "$PROJECT"

echo "== Bucket gs://$BUCKET"
# Private: only the service reads it, and nobody can list what's in it.
if ! gcloud storage buckets describe "gs://$BUCKET" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://$BUCKET" --project "$PROJECT" --location "$REGION" \
    --uniform-bucket-level-access --public-access-prevention
fi

echo "== Service account $ACCOUNT"
if ! gcloud iam service-accounts describe "$ACCOUNT" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SERVICE" --project "$PROJECT" --display-name "Bridge Builder share service"
fi
# Create and read, but not overwrite or delete: what's stored stays as it was shared.
for role in roles/storage.objectCreator roles/storage.objectViewer; do
  gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member "serviceAccount:$ACCOUNT" --role "$role" >/dev/null
done

echo "== Build account"
# A source deploy builds in Cloud Build as the project's default compute account, which newer
# projects no longer give any roles: it needs Cloud Run Builder to read the sources and push the image.
NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$NUMBER-compute@developer.gserviceaccount.com" \
  --role roles/run.builder --condition None >/dev/null

echo "== Cloud Run service $SERVICE"
gcloud run deploy "$SERVICE" --source "$HERE" --project "$PROJECT" --region "$REGION" --quiet \
  --service-account "$ACCOUNT" --allow-unauthenticated \
  --memory 256Mi --cpu 1 --min-instances 0 --max-instances 3 --concurrency 80 \
  --set-env-vars "BUCKET=$BUCKET,GAME_ORIGIN=$GAME_ORIGIN,PUBLIC_ORIGIN=$PUBLIC_ORIGIN"

echo "== Firebase Hosting"
# Adding Firebase to the project fails harmlessly once it's there.
$FIREBASE projects:addfirebase "$PROJECT" >/dev/null 2>&1 || echo "(Firebase already on $PROJECT)"
# The Android App Link check reads this from b.cuplex.org too.
mkdir -p "$HERE/hosting/.well-known"
cp "$HERE/../public/.well-known/assetlinks.json" "$HERE/hosting/.well-known/assetlinks.json"
(cd "$HERE" && $FIREBASE deploy --only hosting --project "$PROJECT")

echo
echo "Deployed. Until b.cuplex.org is connected, the service answers at https://$PROJECT.web.app"
