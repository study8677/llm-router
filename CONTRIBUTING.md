# Contributing

Thanks for improving LLM Router. The project is intentionally small, so contributions should keep the core path easy to audit.

## Development

```bash
npm install
npm run build
npm test
```

For local manual testing:

```bash
cp .env.example .env
npm run dev
```

Do not commit `.env` or any real upstream API key.

## Pull request expectations

- Keep changes scoped to one problem.
- Add or update tests for routing behavior, fallback behavior, protocol compatibility, or error handling.
- Update docs when changing user-facing behavior.
- Include the validation commands you ran.

## Routing changes

Routing changes should preserve these invariants:

- The router model never directly answers the user.
- The final answer request is a separate upstream call.
- Manual real model requests bypass auto routing.
- Unknown-price models can be answer candidates, but not cheapest router models.
- Errors must not leak upstream API keys.

## Useful commands

```bash
npm run build
npm test
npm run test:live-routing
```

`test:live-routing` requires a real `.env` and calls the configured upstream relay.
