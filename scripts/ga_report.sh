#!/usr/bin/env bash
# GA4 Data API query via a service account key — no gcloud, no pip installs.
# Signs a JWT with openssl, exchanges it for an access token, calls runReport.
# See docs/google-analytics.md for identifiers, examples and setup notes.
#
# Usage:  bash scripts/ga_report.sh '<runReport JSON body>'
# Env:    GA_SA_KEY       path to service-account JSON
#                         (default: ~/.config/hiya/hiya-sa.json)
#         GA_PROPERTY_ID  GA4 numeric property id (default: 544629918)
#
# Example:
#   bash scripts/ga_report.sh '{"dateRanges":[{"startDate":"28daysAgo","endDate":"today"}],
#     "dimensions":[{"name":"eventName"}],"metrics":[{"name":"eventCount"}]}' | jq .
set -euo pipefail

KEY="${GA_SA_KEY:-$HOME/.config/hiya/hiya-sa.json}"
PROPERTY_ID="${GA_PROPERTY_ID:-544629918}"
SCOPE="https://www.googleapis.com/auth/analytics.readonly"

[ -f "$KEY" ] || { echo "ERROR: service-account key not found: $KEY" >&2; exit 1; }

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

client_email=$(jq -r '.client_email' "$KEY")
now=$(date +%s); exp=$((now + 3600))
header='{"alg":"RS256","typ":"JWT"}'
claim=$(printf '{"iss":"%s","scope":"%s","aud":"https://oauth2.googleapis.com/token","iat":%s,"exp":%s}' \
  "$client_email" "$SCOPE" "$now" "$exp")
signing_input="$(printf '%s' "$header" | b64url).$(printf '%s' "$claim" | b64url)"
# sign with the private key via process substitution — key never touches a temp file
signature=$(printf '%s' "$signing_input" | openssl dgst -sha256 -sign <(jq -r '.private_key' "$KEY") | b64url)
jwt="$signing_input.$signature"

access_token=$(curl -s -X POST https://oauth2.googleapis.com/token \
  --data-urlencode 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer' \
  --data-urlencode "assertion=$jwt" | jq -r '.access_token // empty')

[ -n "$access_token" ] || { echo "ERROR: token exchange failed (key valid? Data API enabled?)" >&2; exit 1; }

body="${1:?need a runReport JSON body as arg 1 — see docs/google-analytics.md}"
curl -s -X POST \
  "https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_ID}:runReport" \
  -H "Authorization: Bearer ${access_token}" \
  -H 'Content-Type: application/json' \
  -d "$body"
