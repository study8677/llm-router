# Operations

## Run locally

```bash
npm install
npm run build
npm start
```

## Run with Docker

```bash
cp .env.example .env
docker compose up --build
```

## Health check

```bash
curl http://127.0.0.1:8787/health
```

The response includes the number of upstream models loaded at startup.

## Logs

Logs are JSON lines written to stdout.

Important events:

- `server_started`
- `request_completed`
- `request_failed`
- `auto_route_decision`
- `auto_route_applied`
- `auto_answer_failed`
- `auto_stream_answer_failed`

## Production notes

- Set `ROUTER_API_KEY` if the router is reachable by anything other than local trusted clients.
- Keep the service behind a private network or reverse proxy.
- Do not expose the service publicly without TLS and authentication.
- Monitor upstream errors, especially `429`, timeout, and `5xx`.
- Rotate upstream keys if logs or config files are accidentally shared.
