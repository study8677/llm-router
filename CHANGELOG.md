# Changelog

All notable changes to LLM Router will be documented in this file.

The project follows a lightweight changelog style until the first stable release.

## 0.1.1

- Added local Admin page at `/admin`.
- Added runtime router-model selection for `auto`, `auto-coding`, and `auto-longtext`.
- Added local `.llm-router.local.json` runtime config persistence.
- Added protected `/admin/config` API for reading and saving router settings.
- Added tests for manual router-model selection, Admin API auth, and unavailable saved models.

## 0.1.0

- Added OpenAI-compatible `POST /v1/chat/completions`.
- Added `GET /v1/models` and `GET /health`.
- Added virtual models: `auto`, `auto-coding`, `auto-longtext`.
- Added cheapest known-price router model selection.
- Added structured router JSON decisions.
- Added non-streaming and streaming Chat Completions forwarding.
- Added auto fallback on timeout, network error, `429`, and `5xx`.
- Added tool calling passthrough.
- Added multimodal routing payload redaction for base64-heavy inputs.
- Added structured JSON logs and routing headers.
