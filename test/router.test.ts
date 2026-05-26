import test from "node:test";
import assert from "node:assert/strict";
import { AppConfig, ChatCompletionRequest, OpenAIModel } from "../src/types.js";
import { ModelRegistry } from "../src/modelRegistry.js";
import { RouterEngine } from "../src/routerEngine.js";
import { UpstreamClient, UpstreamError, UpstreamStreamResponse } from "../src/upstream.js";
import { createAppState, createHttpServer } from "../src/httpServer.js";

const config: AppConfig = {
  port: 0,
  upstreamBaseUrl: "https://relay.test",
  upstreamApiKey: "sk-test-secret",
  upstreamTimeoutMs: 1000,
  autoMaxAttempts: 2
};

const models: OpenAIModel[] = [
  { id: "expensive-answer", pricing: { prompt: 1, completion: 1 } },
  { id: "gpt-4.1-nano" },
  { id: "unknown-price-model" }
];

class MockUpstream implements UpstreamClient {
  calls: ChatCompletionRequest[] = [];
  nextTarget = "expensive-answer";
  nextTaskType: string | undefined;
  nextDifficulty: string | undefined;
  nextReasoningEffort: string | undefined;
  failTargets = new Map<string, UpstreamError>();

  async listModels(): Promise<OpenAIModel[]> {
    return models;
  }

  async chatCompletions(body: ChatCompletionRequest): Promise<unknown> {
    this.calls.push(body);

    if (body.model === "gpt-4.1-nano" && isRouterRequest(body)) {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                target_model: this.nextTarget,
                task_type: this.nextTaskType,
                difficulty: this.nextDifficulty,
                reasoning_effort: this.nextReasoningEffort,
                confidence: 0.9,
                reason: "mock route"
              })
            }
          }
        ]
      };
    }

    const failure = this.failTargets.get(String(body.model));
    if (failure) {
      this.failTargets.delete(String(body.model));
      throw failure;
    }

    return {
      id: "chatcmpl_mock",
      object: "chat.completion",
      model: body.model,
      choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop", index: 0 }]
    };
  }

  async chatCompletionsStream(body: ChatCompletionRequest): Promise<UpstreamStreamResponse> {
    this.calls.push(body);

    const failure = this.failTargets.get(String(body.model));
    if (failure) {
      this.failTargets.delete(String(body.model));
      throw failure;
    }

    return {
      headers: new Headers({ "content-type": "text/event-stream; charset=utf-8" }),
      body: streamFromText(
        [
          `data: ${JSON.stringify({ id: "chatcmpl_mock", object: "chat.completion.chunk", model: body.model, choices: [] })}`,
          "data: [DONE]",
          ""
        ].join("\n\n")
      )
    };
  }
}

test("auto calls cheapest priced router model, then selected target model", async () => {
  const upstream = new MockUpstream();
  const engine = new RouterEngine(config, upstream, new ModelRegistry(models));

  const result = await engine.handleChatCompletion(
    { model: "auto", messages: [{ role: "user", content: "hello" }] },
    "req_1"
  );

  assert.equal(result.targetModel, "expensive-answer");
  assert.equal(upstream.calls.length, 2);
  assert.equal(upstream.calls[0].model, "gpt-4.1-nano");
  assert.equal(upstream.calls[1].model, "expensive-answer");
  assert.deepEqual(upstream.calls[1].messages, [{ role: "user", content: "hello" }]);
});

test("manual model does not call router model", async () => {
  const upstream = new MockUpstream();
  const engine = new RouterEngine(config, upstream, new ModelRegistry(models));

  const result = await engine.handleChatCompletion(
    { model: "expensive-answer", messages: [{ role: "user", content: "hello" }] },
    "req_2"
  );

  assert.equal(result.targetModel, "expensive-answer");
  assert.equal(upstream.calls.length, 1);
  assert.equal(upstream.calls[0].model, "expensive-answer");
});

test("unknown-price model is not chosen as router model", async () => {
  const upstream = new MockUpstream();
  const engine = new RouterEngine(config, upstream, new ModelRegistry(models));

  await engine.handleChatCompletion({ model: "auto", messages: [{ role: "user", content: "hello" }] }, "req_3");

  assert.equal(upstream.calls[0].model, "gpt-4.1-nano");
  assert.notEqual(upstream.calls[0].model, "unknown-price-model");
});

test("invalid router target is rejected", async () => {
  const upstream = new MockUpstream();
  upstream.nextTarget = "not-in-candidates";
  const engine = new RouterEngine(config, upstream, new ModelRegistry(models));

  await assert.rejects(
    () => engine.handleChatCompletion({ model: "auto", messages: [{ role: "user", content: "hello" }] }, "req_4"),
    /invalid_router_decision|unavailable target_model/
  );
});

test("auto stream calls router model, then proxies selected target stream", async () => {
  const upstream = new MockUpstream();
  const engine = new RouterEngine(config, upstream, new ModelRegistry(models));

  const result = await engine.handleChatCompletionStream(
    { model: "auto", stream: true, messages: [{ role: "user", content: "hello" }] },
    "req_5"
  );

  assert.equal(result.targetModel, "expensive-answer");
  assert.equal(upstream.calls.length, 2);
  assert.equal(upstream.calls[0].model, "gpt-4.1-nano");
  assert.equal(upstream.calls[1].model, "expensive-answer");
  assert.equal(upstream.calls[1].stream, true);
  assert.match(await readStream(result.stream.body), /chat\.completion\.chunk/);
});

test("manual stream bypasses router model", async () => {
  const upstream = new MockUpstream();
  const engine = new RouterEngine(config, upstream, new ModelRegistry(models));

  const result = await engine.handleChatCompletionStream(
    { model: "expensive-answer", stream: true, messages: [{ role: "user", content: "hello" }] },
    "req_manual_stream"
  );

  assert.equal(result.targetModel, "expensive-answer");
  assert.equal(upstream.calls.length, 1);
  assert.equal(upstream.calls[0].model, "expensive-answer");
  assert.equal(upstream.calls[0].stream, true);
});

test("auto fallback re-routes after retryable target failure", async () => {
  const upstream = new MockUpstream();
  const engine = new RouterEngine(config, upstream, new ModelRegistry(models));
  upstream.failTargets.set("expensive-answer", new UpstreamError(500, "upstream_error", "temporary", "server_error", true));
  upstream.nextTarget = "expensive-answer";

  const originalChat = upstream.chatCompletions.bind(upstream);
  let routeCount = 0;
  upstream.chatCompletions = async (body) => {
    if (body.model === "gpt-4.1-nano" && isRouterRequest(body)) {
      routeCount += 1;
      upstream.nextTarget = routeCount === 1 ? "expensive-answer" : "gpt-4.1-nano";
    }
    return originalChat(body);
  };

  const result = await engine.handleChatCompletion({ model: "auto", messages: [{ role: "user", content: "hello" }] }, "req_6");

  assert.equal(result.targetModel, "gpt-4.1-nano");
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].status, "failed");
  assert.equal(result.attempts[1].status, "success");
});

test("auto stream fallback re-routes after retryable target failure before chunks", async () => {
  const upstream = new MockUpstream();
  const engine = new RouterEngine(config, upstream, new ModelRegistry(models));
  upstream.failTargets.set("expensive-answer", new UpstreamError(429, "rate_limit_error", "temporary", "rate_limit_error", true));
  upstream.nextTarget = "expensive-answer";

  const originalChat = upstream.chatCompletions.bind(upstream);
  let routeCount = 0;
  upstream.chatCompletions = async (body) => {
    if (body.model === "gpt-4.1-nano" && isRouterRequest(body)) {
      routeCount += 1;
      upstream.nextTarget = routeCount === 1 ? "expensive-answer" : "gpt-4.1-nano";
    }
    return originalChat(body);
  };

  const result = await engine.handleChatCompletionStream({ model: "auto", stream: true, messages: [{ role: "user", content: "hello" }] }, "req_stream_fallback");

  assert.equal(result.targetModel, "gpt-4.1-nano");
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].status, "failed");
  assert.equal(result.attempts[1].status, "success");
  assert.equal(upstream.calls.at(-1)?.model, "gpt-4.1-nano");
  assert.equal(upstream.calls.at(-1)?.stream, true);
});

test("auto-coding simple coding prefers gpt-5.3-codex over strongest model", async () => {
  const upstream = new MockUpstream();
  upstream.nextTarget = "gpt-5.3-codex";
  upstream.nextTaskType = "simple_coding";
  upstream.nextDifficulty = "simple";
  upstream.nextReasoningEffort = "low";
  const codingModels: OpenAIModel[] = [
    { id: "gpt-4.1-nano" },
    { id: "gpt-5.3-codex" },
    { id: "gpt-5.5" }
  ];
  const engine = new RouterEngine(config, upstream, new ModelRegistry(codingModels));

  const result = await engine.handleChatCompletion(
    { model: "auto-coding", messages: [{ role: "user", content: "Write a tiny TypeScript function." }] },
    "req_7"
  );

  assert.equal(result.targetModel, "gpt-5.3-codex");
  assert.equal(upstream.calls[1].model, "gpt-5.3-codex");
  assert.equal(upstream.calls[0].reasoning_effort, undefined);
  assert.equal(upstream.calls[1].reasoning_effort, "low");

  const routePayload = JSON.parse(String((upstream.calls[0].messages?.[1] as { content: string }).content));
  const codexProfile = routePayload.candidate_model_details.find((model: { id: string }) => model.id === "gpt-5.3-codex");
  assert.ok(codexProfile.specialties.includes("coding"));
});

test("auto-coding hard planning uses router-selected gpt-5.5 with xhigh reasoning", async () => {
  const upstream = new MockUpstream();
  upstream.nextTarget = "gpt-5.5";
  upstream.nextTaskType = "coding_planning";
  upstream.nextDifficulty = "hard";
  upstream.nextReasoningEffort = "xhigh";
  const codingModels: OpenAIModel[] = [
    { id: "gpt-4.1-nano" },
    { id: "gpt-5.3-codex" },
    { id: "gpt-5.5" }
  ];
  const engine = new RouterEngine(config, upstream, new ModelRegistry(codingModels));

  const result = await engine.handleChatCompletion(
    { model: "auto-coding", messages: [{ role: "user", content: "Plan a difficult repo-wide migration." }] },
    "req_8"
  );

  assert.equal(result.targetModel, "gpt-5.5");
  assert.equal(upstream.calls[0].reasoning_effort, undefined);
  assert.equal(upstream.calls[1].model, "gpt-5.5");
  assert.equal(upstream.calls[1].reasoning_effort, "xhigh");

  const routePayload = JSON.parse(String((upstream.calls[0].messages?.[1] as { content: string }).content));
  const strongestProfile = routePayload.candidate_model_details.find((model: { id: string }) => model.id === "gpt-5.5");
  assert.equal(strongestProfile.strength, "frontier_strongest");
  assert.ok(strongestProfile.recommended_for.includes("architecture planning"));
});

test("auto hard coding uses router-selected gpt-5.5 xhigh", async () => {
  const upstream = new MockUpstream();
  upstream.nextTarget = "gpt-5.5";
  upstream.nextTaskType = "hard_coding";
  upstream.nextDifficulty = "hard";
  upstream.nextReasoningEffort = "xhigh";
  const codingModels: OpenAIModel[] = [
    { id: "gpt-4.1-nano" },
    { id: "gpt-5.3-codex" },
    { id: "gpt-5.5" }
  ];
  const engine = new RouterEngine(config, upstream, new ModelRegistry(codingModels));

  const result = await engine.handleChatCompletion(
    { model: "auto", messages: [{ role: "user", content: "Debug a hard production race condition." }] },
    "req_9"
  );

  assert.equal(result.targetModel, "gpt-5.5");
  assert.equal(upstream.calls[1].model, "gpt-5.5");
  assert.equal(upstream.calls[1].reasoning_effort, "xhigh");
});

test("auto simple general task prefers balanced cheap model when available", async () => {
  const upstream = new MockUpstream();
  upstream.nextTarget = "gpt-5.4-mini";
  upstream.nextTaskType = "simple_chat";
  upstream.nextDifficulty = "simple";
  upstream.nextReasoningEffort = "none";
  const generalModels: OpenAIModel[] = [
    { id: "gpt-4.1-nano" },
    { id: "gpt-5.4-mini" },
    { id: "gpt-5.5" }
  ];
  const engine = new RouterEngine(config, upstream, new ModelRegistry(generalModels));

  const result = await engine.handleChatCompletion(
    { model: "auto", messages: [{ role: "user", content: "Say hello." }] },
    "req_10"
  );

  assert.equal(result.targetModel, "gpt-5.4-mini");
  assert.equal(upstream.calls[1].model, "gpt-5.4-mini");
});

test("auto preserves tool calling fields on final request and routing payload", async () => {
  const upstream = new MockUpstream();
  const engine = new RouterEngine(config, upstream, new ModelRegistry(models));
  const tools = [
    {
      type: "function",
      function: {
        name: "lookup_order",
        description: "Lookup an order.",
        parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] }
      }
    }
  ];
  const functions = [
    {
      name: "legacy_lookup",
      parameters: { type: "object", properties: { query: { type: "string" } } }
    }
  ];

  await engine.handleChatCompletion(
    {
      model: "auto",
      messages: [{ role: "user", content: "Use the available tool if needed." }],
      tools,
      tool_choice: { type: "function", function: { name: "lookup_order" } },
      parallel_tool_calls: true,
      functions,
      function_call: { name: "legacy_lookup" }
    },
    "req_tools"
  );

  const routePayload = JSON.parse(String((upstream.calls[0].messages?.[1] as { content: string }).content));
  assert.deepEqual(routePayload.request.tools, tools);
  assert.deepEqual(routePayload.request.tool_choice, { type: "function", function: { name: "lookup_order" } });
  assert.equal(routePayload.request.parallel_tool_calls, true);
  assert.deepEqual(routePayload.request.functions, functions);
  assert.deepEqual(routePayload.request.function_call, { name: "legacy_lookup" });
  assert.deepEqual(routePayload.required_capabilities, ["tool_calls", "parallel_tool_calls"]);

  assert.deepEqual(upstream.calls[1].tools, tools);
  assert.deepEqual(upstream.calls[1].tool_choice, { type: "function", function: { name: "lookup_order" } });
  assert.equal(upstream.calls[1].parallel_tool_calls, true);
  assert.deepEqual(upstream.calls[1].functions, functions);
  assert.deepEqual(upstream.calls[1].function_call, { name: "legacy_lookup" });
});

test("auto stream preserves tool calling fields on final request", async () => {
  const upstream = new MockUpstream();
  const engine = new RouterEngine(config, upstream, new ModelRegistry(models));
  const tools = [
    {
      type: "function",
      function: {
        name: "lookup_order",
        parameters: { type: "object", properties: { id: { type: "string" } } }
      }
    }
  ];

  await engine.handleChatCompletionStream(
    {
      model: "auto",
      stream: true,
      messages: [{ role: "user", content: "Use the available tool if needed." }],
      tools,
      tool_choice: "auto",
      parallel_tool_calls: false
    },
    "req_stream_tools"
  );

  const routePayload = JSON.parse(String((upstream.calls[0].messages?.[1] as { content: string }).content));
  assert.deepEqual(routePayload.request.tools, tools);
  assert.deepEqual(routePayload.request.tool_choice, "auto");
  assert.equal(routePayload.request.parallel_tool_calls, false);
  assert.deepEqual(routePayload.required_capabilities, ["tool_calls"]);

  assert.deepEqual(upstream.calls[1].tools, tools);
  assert.deepEqual(upstream.calls[1].tool_choice, "auto");
  assert.equal(upstream.calls[1].parallel_tool_calls, false);
  assert.equal(upstream.calls[1].stream, true);
});

test("auto multimodal routing redacts base64 images while final request stays unchanged", async () => {
  const upstream = new MockUpstream();
  const engine = new RouterEngine(config, upstream, new ModelRegistry(models));
  const imageUrl = `data:image/png;base64,${"a".repeat(4096)}`;
  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: "Describe this screenshot and answer briefly." },
        { type: "image_url", image_url: { url: imageUrl, detail: "high" } }
      ]
    }
  ];

  await engine.handleChatCompletion({ model: "auto", messages }, "req_multimodal");

  const routePayload = JSON.parse(String((upstream.calls[0].messages?.[1] as { content: string }).content));
  const routedUrl = routePayload.request.messages[0].content[1].image_url.url;
  assert.match(routedUrl, /omitted base64 data url for routing/);
  assert.equal(JSON.stringify(routePayload).includes(imageUrl), false);
  assert.deepEqual(routePayload.required_capabilities, ["vision"]);
  const answerProfile = routePayload.candidate_model_details.find((model: { id: string }) => model.id === "expensive-answer");
  assert.equal(typeof answerProfile.capabilities.supports_tool_calls, "boolean");
  assert.equal(typeof answerProfile.capabilities.supports_vision, "boolean");
  assert.deepEqual(upstream.calls[1].messages, messages);
});

test("http /v1/models includes virtual models and upstream models", async () => {
  const upstream = new MockUpstream();
  const state = await createAppState(config, upstream);
  const server = createHttpServer(state);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/models`);
    const body = (await response.json()) as { data: Array<{ id: string }> };
    const ids = body.data.map((model) => model.id);
    assert.ok(ids.includes("auto"));
    assert.ok(ids.includes("auto-coding"));
    assert.ok(ids.includes("auto-longtext"));
    assert.ok(ids.includes("expensive-answer"));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("http /v1/chat/completions supports stream true", async () => {
  const upstream = new MockUpstream();
  const state = await createAppState(config, upstream);
  const server = createHttpServer(state);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "auto", stream: true, messages: [{ role: "user", content: "hello" }] })
    });
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
    assert.equal(response.headers.get("x-llm-router-original-model"), "auto");
    assert.equal(response.headers.get("x-llm-router-target-model"), "expensive-answer");
    assert.match(text, /data: \[DONE\]/);
    assert.equal(upstream.calls[0].model, "gpt-4.1-nano");
    assert.equal(upstream.calls[1].model, "expensive-answer");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

function isRouterRequest(body: ChatCompletionRequest): boolean {
  return Array.isArray(body.messages) && JSON.stringify(body.messages).includes("candidate_models");
}

function streamFromText(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    }
  });
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
