# Routing Behavior

This document describes the expected behavior of `auto`, `auto-coding`, and `auto-longtext`.

## Virtual models

| Virtual model | Primary intent |
| --- | --- |
| `auto` | General-purpose routing. |
| `auto-coding` | Coding-oriented routing. |
| `auto-longtext` | Long-context routing. |

## Router model selection

By default, the router model is selected automatically:

1. Load upstream models from `/v1/models`.
2. Resolve pricing from upstream metadata.
3. Fall back to the local public price catalog.
4. Pick the cheapest model whose price is known.

Models with unknown price are still valid answer candidates, but cannot become the cheapest router model.

You can override this from the local Admin page at `/admin`, or by posting to `/admin/config`:

```json
{ "router_model_id": "gpt-5.5" }
```

When a router model is manually configured, it must exist in the upstream model list. Manual configuration can use a model whose price is unknown because the user is explicitly overriding the default cost-saving policy.

## Decision schema

The router model must return strict JSON:

```json
{
  "target_model": "gpt-5.4-mini",
  "task_type": "simple_chat",
  "difficulty": "simple",
  "reasoning_effort": "none",
  "confidence": 0.98,
  "reason": "Short translation task; low-cost model is sufficient."
}
```

`target_model` must be one of the upstream candidate model IDs. Invalid targets are rejected.

## Default routing intent

| Request type | Expected routing direction |
| --- | --- |
| trivial chat, rewrite, translation, formatting | low-cost capable model |
| simple coding, small code generation, syntax fixes | coding specialist |
| architecture, repo migration, production debugging | strongest frontier model |
| security or billing logic review | strongest frontier model |
| simple long-text extraction | low-cost long-context-capable model |
| complex long-text reasoning | strongest frontier model |

## Fallback

Fallback only applies to virtual models.

Retryable failures:

- timeout
- network error
- HTTP `429`
- HTTP `5xx`

When fallback happens, the failed target is passed to the next route call as `excluded_models`.

For streaming, fallback only works before any upstream chunk has been sent to the client.

## Manual override

If the request uses a real upstream model ID, the router does not call the router model. The request is forwarded directly.
