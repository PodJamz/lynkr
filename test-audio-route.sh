#!/bin/bash
# Test script for ACE-Step audio generation route
# Make sure Lynkr is running: cd /Users/jamesspalding/lynkr && node index.js

set -e

API_KEY="${API_KEY:-InqBXm2os9z7jDieEo6aPLaxOU1XQhsF5I-MVB40YpNqIiMkPzp3gM5vAwxNXEek}"
BASE_URL="${BASE_URL:-http://localhost:8081}"

echo "🧪 Testing ACE-Step Audio Generation Route"
echo "=========================================="
echo ""

# Test 1: Health check (should include ACE-Step)
echo "1. Health Check (with ACE-Step):"
curl -s "${BASE_URL}/health/ready?deep=true" | jq '.checks.acestep' || echo "ACE-Step check not found"
echo ""

# Test 2: Create generation task
echo "2. Creating generation task..."
TASK_RESPONSE=$(curl -s -X POST "${BASE_URL}/v1/audio/generate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_KEY}" \
  -d '{
    "prompt": "upbeat electronic dance track",
    "duration": 10
  }')

echo "Response:"
echo "$TASK_RESPONSE" | jq . || echo "$TASK_RESPONSE"
echo ""

TASK_ID=$(echo "$TASK_RESPONSE" | jq -r '.id // .task_id // empty')

if [ -z "$TASK_ID" ] || [ "$TASK_ID" = "null" ]; then
  echo "❌ Failed to get task ID"
  exit 1
fi

echo "✅ Task ID: $TASK_ID"
echo ""

# Test 3: Poll for status
echo "3. Polling for status (waiting 5 seconds)..."
sleep 5

STATUS_RESPONSE=$(curl -s "${BASE_URL}/v1/audio/generate/${TASK_ID}/status" \
  -H "Authorization: Bearer ${API_KEY}")

echo "Status:"
echo "$STATUS_RESPONSE" | jq . || echo "$STATUS_RESPONSE"
echo ""

# Test 4: Test SSE stream (first few messages)
echo "4. Testing SSE stream (first 3 messages, 6 seconds)..."
timeout 6 curl -s -N "${BASE_URL}/v1/audio/generate/${TASK_ID}/stream" \
  -H "Authorization: Bearer ${API_KEY}" | head -3 || echo "Stream ended or timeout"
echo ""

echo "✨ Tests complete!"
echo ""
echo "💡 To check if generation completed, poll status again:"
echo "   curl -s '${BASE_URL}/v1/audio/generate/${TASK_ID}/status' -H 'Authorization: Bearer ${API_KEY}' | jq ."
