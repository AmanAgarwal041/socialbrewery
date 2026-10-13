#!/bin/sh
# Mounts the R2 bucket at /data, then runs Socialbrewery with that as its home folder.
set -eu

: "${R2_ACCOUNT_ID:?}" "${R2_BUCKET_NAME:?}" "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}"
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"

mkdir -p /data
/usr/local/bin/tigrisfs \
  --endpoint "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  --region auto -f "$R2_BUCKET_NAME" /data &
fuse_pid=$!

attempt=0
until mountpoint -q /data; do
  if ! kill -0 "$fuse_pid" 2>/dev/null; then
    echo "Could not mount the R2 bucket $R2_BUCKET_NAME" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "Timed out mounting the R2 bucket $R2_BUCKET_NAME" >&2
    exit 1
  fi
  sleep 1
done

node /app/src/server.js &
app_pid=$!

# Let the app finish its writes before the mount goes away, so nothing is lost on sleep or redeploy.
stop() {
  kill -TERM "$app_pid" 2>/dev/null || true
  wait "$app_pid" 2>/dev/null || true
  fusermount -u /data 2>/dev/null || true
  kill "$fuse_pid" 2>/dev/null || true
}
trap stop TERM INT

wait "$app_pid"
status=$?
stop
exit "$status"
