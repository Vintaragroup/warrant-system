#!/bin/bash

# Generate a pre-signed URL using Telnyx Cloud Storage Companion API
# This creates a temporary, publicly accessible URL with security token

if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: $0 <TELNYX_API_KEY> <OBJECT_PATH>"
  echo ""
  echo "Example:"
  echo "  $0 'your-api-key' 'hold-music/moonlightdrive.mp3'"
  echo ""
  echo "This will generate a pre-signed URL using Telnyx's API endpoint:"
  echo "  POST /api/cloud-storage-companion/create-presigned-object-url"
  echo ""
  echo "The response will include a URL with X-AMZ-Security-Token query parameter"
  exit 1
fi

API_KEY="$1"
OBJECT_PATH="$2"
REGION="${3:-us-central-1}"

echo "=== Telnyx Cloud Storage Pre-Signed URL Generator ==="
echo ""
echo "API Key: ${API_KEY:0:20}..."
echo "Object: $OBJECT_PATH"
echo "Region: $REGION"
echo ""
echo "Requesting pre-signed URL from Telnyx API..."
echo ""

curl -X POST "https://api.telnyx.com/api/cloud-storage-companion/create-presigned-object-url" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"object_path\": \"$OBJECT_PATH\",
    \"region\": \"$REGION\"
  }" | jq '.'

echo ""
echo "✅ Pre-signed URL generated!"
echo "Use this URL in your HOLD_MUSIC_URL environment variable."
echo "The URL includes an X-AMZ-Security-Token query parameter."
echo ""
echo "Note: Non-verified accounts get 5-minute TTL."
echo "Level 2 verified accounts can request longer TTLs."
