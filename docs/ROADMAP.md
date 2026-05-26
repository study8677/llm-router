# Roadmap

LLM Router is currently an MVP focused on one upstream key and intelligent model selection.

## Near term

- CLI setup flow: `llm-router init`, `start`, `stop`, `status`.
- Common client config helpers.
- Better model capability catalog.
- More live routing evaluation cases.
- Richer local Admin page for routing policy previews.
- Optional Docker image publishing.

## Protocol compatibility

- `POST /v1/embeddings` passthrough.
- Legacy `POST /v1/completions` passthrough.
- Responses API compatibility for Codex-style clients.
- Anthropic Messages compatibility for Claude-style clients.

## Routing intelligence

- Per-provider model capability profiles.
- Cost and latency aware routing.
- Policy overrides for teams and projects.
- Route decision tracing UI.
- Optional local route cache.

## Operations

- Structured metrics endpoint.
- Prometheus-friendly counters.
- Better health checks for upstream readiness.
- Configurable log levels.

## Not planned for the MVP

- SaaS multi-tenant control plane.
- Multi-upstream load balancing.
- Billing system.
- SaaS admin dashboard.
