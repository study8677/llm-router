# Configuration

LLM Router reads configuration from environment variables. A local `.env` file in the project root is loaded automatically.

## Required

| Variable | Description |
| --- | --- |
| `UPSTREAM_BASE_URL` | OpenAI-compatible upstream base URL, without a trailing slash. |
| `UPSTREAM_API_KEY` | API key for the upstream relay. |

## Optional

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8787` | Local HTTP port. |
| `ROUTER_API_KEY` | empty | If set, clients must call the router with `Authorization: Bearer <ROUTER_API_KEY>`. |
| `UPSTREAM_TIMEOUT_MS` | `30000` | Timeout for upstream requests. |
| `AUTO_MAX_ATTEMPTS` | `2` | Maximum answer-model attempts for auto requests. |

## Example

```bash
PORT=8787
UPSTREAM_BASE_URL=https://your-relay.example.com
UPSTREAM_API_KEY=sk-your-upstream-key
ROUTER_API_KEY=local-router-key
UPSTREAM_TIMEOUT_MS=30000
AUTO_MAX_ATTEMPTS=2
```

## Client configuration

Use the router as the OpenAI-compatible endpoint:

```bash
base_url=http://127.0.0.1:8787/v1
api_key=local-router-key
model=auto
```

If `ROUTER_API_KEY` is empty, the client API key can be any placeholder value.
