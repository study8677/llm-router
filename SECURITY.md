# Security Policy

LLM Router is a local proxy that handles API keys and user prompts. Treat it as part of your trusted local infrastructure.

## Supported versions

The project is pre-1.0. Security fixes target the latest `main` branch unless a release branch exists.

## Reporting a vulnerability

Please do not open a public issue for vulnerabilities, leaked credentials, or private prompt data.

Use GitHub private vulnerability reporting:

https://github.com/study8677/llm-router/security/advisories/new

Include:

- affected commit or version
- reproduction steps
- expected impact
- whether secrets, logs, or prompts were exposed

## Secrets

- Never commit `.env`.
- Use `ROUTER_API_KEY` if the proxy is reachable outside your machine.
- Do not expose this service directly to the public internet without authentication, TLS, and network controls.
- Logs are structured and should not include upstream API keys; still review logs before sharing them.

## Scope

In scope:

- API key leakage
- request/response leakage
- auth bypass for `ROUTER_API_KEY`
- unsafe error sanitization
- denial-of-service issues in routing or streaming

Out of scope:

- Provider account bans caused by misuse of upstream services
- Model hallucination or model output quality
- Pricing catalog inaccuracies without a security impact
