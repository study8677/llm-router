#!/usr/bin/env bash
set -euo pipefail

ROUTER_BASE_URL="${ROUTER_BASE_URL:-http://127.0.0.1:8787/v1}"
ROUTER_API_KEY="${ROUTER_API_KEY:-local-router-key}"

curl -N "${ROUTER_BASE_URL}/chat/completions" \
  -H "content-type: application/json" \
  -H "authorization: Bearer ${ROUTER_API_KEY}" \
  -d '{
    "model": "auto-coding",
    "stream": true,
    "messages": [
      {
        "role": "user",
        "content": "Write a small TypeScript debounce function."
      }
    ]
  }'
