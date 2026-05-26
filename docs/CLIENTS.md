# Client Examples

LLM Router works with clients that can call an OpenAI-compatible Chat Completions endpoint.

## Generic OpenAI-compatible config

```bash
base_url=http://127.0.0.1:8787/v1
api_key=local-router-key
model=auto
```

Use these virtual models:

- `auto`
- `auto-coding`
- `auto-longtext`

## curl

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer local-router-key' \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "Explain binary search in one paragraph."}]
  }'
```

## Streaming

```bash
curl -N http://127.0.0.1:8787/v1/chat/completions \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer local-router-key' \
  -d '{
    "model": "auto-coding",
    "stream": true,
    "messages": [{"role": "user", "content": "Write a TypeScript debounce function."}]
  }'
```

## Manual override

Use any real upstream model ID to bypass routing:

```json
{
  "model": "gpt-5.4-mini",
  "messages": [{ "role": "user", "content": "hello" }]
}
```
