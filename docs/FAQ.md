# FAQ

## Is this a SaaS service?

No. LLM Router is self-hosted and runs locally or on your own server.

## Does it replace my relay provider?

No. It sits in front of one existing OpenAI-compatible relay. Your upstream `base_url` and API key still come from that relay.

## Does the router model answer user prompts?

No. The router model only returns JSON that selects the final target model. The final answer is always a separate upstream call.

## Can I still choose a model manually?

Yes. Send a real upstream model ID instead of `auto`, `auto-coding`, or `auto-longtext`.

## Can I choose the router model used by auto?

Yes. Open `http://127.0.0.1:8787/admin` and switch router-model selection from automatic to manual. This only changes the internal routing decision model; the final answer is still a separate call to the selected target model.

## Does it support streaming?

Yes. `stream: true` is supported for Chat Completions. The router first makes a non-streaming route decision, then proxies the selected upstream SSE stream.

## Does it support tools and function calling?

Yes. Tool calling fields are passed through to the final model request:

- `tools`
- `tool_choice`
- `parallel_tool_calls`
- legacy `functions`
- legacy `function_call`

## Does it support images?

Multimodal Chat Completions payloads are forwarded to the final answer model unchanged. For the internal route request only, large base64 image data is replaced with metadata to avoid wasting routing context.

## Will it leak my upstream API key?

The router sanitizes error messages and ignores `.env` by default. You should still avoid sharing raw logs and never commit `.env`.

## Is the price catalog a billing source of truth?

No. It is only used for the default cheapest known-price router-model selection and routing context. Your real bill still comes from the upstream provider or relay.

## Why not always use the strongest model?

Because many requests are simple. The router is designed to spend strong-model budget on tasks that actually need it: hard coding, architecture, security review, complex reasoning, and high-risk planning.

## Can it be as easy as ccswitch?

That is the target. The core proxy and routing path already work. The next product step is a CLI and background service manager so setup becomes `init`, `start`, `status`, and `stop`.
