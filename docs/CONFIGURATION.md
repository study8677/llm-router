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
| `LLM_ROUTER_CONFIG_PATH` | `.llm-router.local.json` | Local runtime config file used by the Admin page. |

## Example

```bash
PORT=8787
UPSTREAM_BASE_URL=https://your-relay.example.com
UPSTREAM_API_KEY=sk-your-upstream-key
ROUTER_API_KEY=local-router-key
UPSTREAM_TIMEOUT_MS=30000
AUTO_MAX_ATTEMPTS=2
LLM_ROUTER_CONFIG_PATH=.llm-router.local.json
```

## Local Admin page

Open the local Admin page after the server starts:

```text
http://127.0.0.1:8787/admin
```

The page lets you inspect upstream models and choose which model is used for the first routing call of `auto`, `auto-coding`, and `auto-longtext`.

- `automatic`: use the cheapest model with known pricing as the router model.
- `manual`: use the selected upstream model as the router model, even if its price is unknown.

The router model still only returns routing JSON. The final answer is always a second independent call to the selected target model.

If `ROUTER_API_KEY` is set, the Admin page shell can still be opened locally, but config reads and writes require the same key. The page stores that key only in the browser's `localStorage`.

The config API is also available directly:

```bash
curl http://127.0.0.1:8787/admin/config \
  -H "Authorization: Bearer local-router-key"

curl -X POST http://127.0.0.1:8787/admin/config \
  -H "content-type: application/json" \
  -H "Authorization: Bearer local-router-key" \
  -d '{"router_model_id":"gpt-5.5"}'
```

Use `{"router_model_id": null}` to return to automatic router-model selection.

## Client configuration

Use the router as the OpenAI-compatible endpoint:

```bash
base_url=http://127.0.0.1:8787/v1
api_key=local-router-key
model=auto
```

If `ROUTER_API_KEY` is empty, the client API key can be any placeholder value.
