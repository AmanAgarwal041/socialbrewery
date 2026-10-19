#!/bin/sh
# Lets this extension use your Clerk application (required by Clerk for every extension).
# Run once per Clerk instance, with that instance's secret key:
#   CLERK_SECRET_KEY=sk_test_... sh extension/scripts/allow-clerk-origin.sh
# Note: this sets the instance's allowed origins to this list; add any others you already use.
set -eu
: "${CLERK_SECRET_KEY:?Set CLERK_SECRET_KEY to the Clerk instance secret key}"
ID=$(node -p "require('$(dirname "$0")/extension-key.json').id")
curl -sS -X PATCH https://api.clerk.com/v1/instance \
  -H "Authorization: Bearer $CLERK_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"allowed_origins\": [\"chrome-extension://$ID\"]}" \
  -w "\nHTTP %{http_code}\n"
