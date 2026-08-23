#!/bin/bash

# Script to update HOLD_MUSIC_URL in Render environment
# Usage: ./set_hold_music_url.sh "https://your-url-here"

if [ -z "$1" ]; then
  echo "Usage: $0 <HOLD_MUSIC_URL>"
  echo ""
  echo "Example:"
  echo "  $0 'https://telnyx-uploads.s3.amazonaws.com/obj_abc123xyz?Signature=...&Expires=...'"
  echo ""
  echo "To get the pre-signed URL:"
  echo "1. Go to Telnyx Mission Control → Developer → Object Storage"
  echo "2. Find your moonlightdrive.mp3 file"
  echo "3. Click the file to get a pre-signed URL or 'Share' button"
  echo "4. Run this script with that URL"
  exit 1
fi

HOLD_MUSIC_URL="$1"

echo "Setting HOLD_MUSIC_URL in Render environment..."
echo "URL: $HOLD_MUSIC_URL"
echo ""
echo "Next steps:"
echo "1. Go to Render Dashboard → Your service → Environment"
echo "2. Add or update this variable:"
echo "   HOLD_MUSIC_URL=$HOLD_MUSIC_URL"
echo "3. Click 'Save' or 'Deploy'"
echo "4. Wait for deployment to complete"
echo ""
echo "After deployment, test with:"
echo "  curl -H 'Authorization: Bearer <your-bearer-token>' \\"
echo "    https://ai-agent-warrant.onrender.com/telnyx/hold_music"
echo ""
echo "Should return the HOLD_MUSIC_URL you just set."
