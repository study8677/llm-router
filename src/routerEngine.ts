import { RouterError } from "./errors.js";
import { logEvent } from "./logger.js";
import { ModelRegistry } from "./modelRegistry.js";
import { UpstreamClient, UpstreamError, UpstreamStreamResponse } from "./upstream.js";
import { AppConfig, ChatCompletionRequest, PricedModel, RouteAttempt, RouterDecision, VirtualModel } from "./types.js";

const ROUTER_SYSTEM_PROMPT = `You are an internal LLM routing policy engine.
You must not answer the user's task.
Your job is to directly choose the best final answer model for the request.
The cheapest router model is only used for routing; do not choose yourself just because you are cheap.
Use the candidate_model_details as your source of truth for model strength and specialties.

Routing principles:
- For trivial chat, rewrite, translation, formatting, and short factual Q&A, choose a low-cost capable model.
- For simple coding, small code generation, API usage, syntax fixes, and direct bugs, choose the best coding-specialist model.
- For difficult coding, architecture planning, repo-wide migrations, complex debugging, PR/security review, or high-risk engineering, choose the strongest frontier model available, such as gpt-5.5 or a Claude/Anthropic Alpha/Opus-class model.
- For complex reasoning, ambiguous planning, multi-step analysis, or high-stakes decisions, choose the strongest frontier model available.
- For long text, choose a strong long-context model; if the task also requires deep reasoning, choose the strongest frontier model.
- If required_capabilities includes vision, tool_calls, or parallel_tool_calls, choose a model whose capability hints do not conflict with that requirement. Prefer explicit support when available.
- Never invent a model. target_model must be exactly one id from candidate_models.

Reasoning effort:
- none: rote/simple tasks.
- low: simple coding or short standard tasks.
- medium: normal analysis or moderately involved generation.
- high: difficult coding, detailed analysis, or multi-step reasoning.
- xhigh: hardest planning, architecture, complex debugging, repo-wide work, high-risk review, or tasks where the strongest model is justified.

Return only strict JSON with this shape:
{"target_model":"<candidate model id>","task_type":"<task type>","difficulty":"simple|standard|hard","reasoning_effort":"none|low|medium|high|xhigh","confidence":0.0,"reason":"short reason"}
Do not include markdown, comments, or extra keys.`;

interface FinalRoute {
  targetModel: string;
  reasoningEffort?: string;
  routeReason: string;
}

export class RouterEngine {
  constructor(
    private readonly config: AppConfig,
    private readonly upstream: UpstreamClient,
    private readonly registry: ModelRegistry
  ) {}

  async handleChatCompletion(body: ChatCompletionRequest, requestId: string): Promise<{ response: unknown; targetModel: string; attempts: RouteAttempt[] }> {
    validateChatCompletionBody(body);
    if (body.stream === true) {
      throw new RouterError(400, "invalid_request_error", "Use handleChatCompletionStream for streaming requests");
    }

    if (!isVirtualModel(body.model)) {
      if (!this.registry.hasModel(body.model)) {
        throw new RouterError(404, "model_not_found", `Model '${body.model}' was not found in upstream model list`);
      }
      const started = Date.now();
      const response = await this.upstream.chatCompletions(body, requestId);
      return {
        response,
        targetModel: body.model,
        attempts: [{ targetModel: body.model, status: "success", durationMs: Date.now() - started }]
      };
    }

    return this.handleAuto(body, body.model, requestId);
  }

  async handleChatCompletionStream(
    body: ChatCompletionRequest,
    requestId: string,
    signal?: AbortSignal
  ): Promise<{ stream: UpstreamStreamResponse; targetModel: string; attempts: RouteAttempt[] }> {
    validateChatCompletionBody(body);
    const requestedModel = body.model;
    const streamBody: ChatCompletionRequest = { ...body, model: requestedModel, stream: true };

    if (!isVirtualModel(requestedModel)) {
      if (!this.registry.hasModel(requestedModel)) {
        throw new RouterError(404, "model_not_found", `Model '${requestedModel}' was not found in upstream model list`);
      }
      const started = Date.now();
      const stream = await this.upstream.chatCompletionsStream(streamBody, requestId, signal);
      return {
        stream,
        targetModel: requestedModel,
        attempts: [{ targetModel: requestedModel, status: "success", durationMs: Date.now() - started }]
      };
    }

    return this.handleAutoStream(streamBody, requestedModel, requestId, signal);
  }

  private async handleAuto(
    originalBody: ChatCompletionRequest,
    virtualModel: VirtualModel,
    requestId: string
  ): Promise<{ response: unknown; targetModel: string; attempts: RouteAttempt[] }> {
    const attempts: RouteAttempt[] = [];
    const excluded = new Set<string>();
    let lastError: UpstreamError | RouterError | undefined;

    for (let attempt = 0; attempt < this.config.autoMaxAttempts; attempt += 1) {
      const decision = await this.routeWithCheapestModel(originalBody, virtualModel, requestId, excluded);
      const finalRoute = finalizeRouterDecision(decision, candidateModelIds(this.registry, excluded));
      const targetModel = finalRoute.targetModel;
      const started = Date.now();
      logEvent({
        request_id: requestId,
        event: "auto_route_applied",
        original_model: virtualModel,
        target_model: targetModel,
        task_type: decision.task_type,
        difficulty: decision.difficulty,
        reasoning_effort: finalRoute.reasoningEffort,
        route_reason: finalRoute.routeReason
      });

      try {
        const answerBody = buildAnswerBody(originalBody, finalRoute);
        const response = await this.upstream.chatCompletions(answerBody, requestId);
        attempts.push({ targetModel, status: "success", reasoningEffort: finalRoute.reasoningEffort, durationMs: Date.now() - started });
        return { response, targetModel, attempts };
      } catch (error) {
        const durationMs = Date.now() - started;
        if (error instanceof UpstreamError) {
          attempts.push({ targetModel, status: "failed", reason: error.code, reasoningEffort: finalRoute.reasoningEffort, durationMs });
          lastError = error;
          excluded.add(targetModel);
          logEvent({
            request_id: requestId,
            event: "auto_answer_failed",
            original_model: virtualModel,
            router_model: this.getRouterModelId(excluded),
            target_model: targetModel,
            error: error.code,
            status: error.status
          });
          if (!error.retryable) {
            throw error;
          }
          continue;
        }
        throw error;
      }
    }

    if (lastError) {
      throw lastError;
    }
    throw new RouterError(503, "no_available_model", "No available target model for auto routing");
  }

  private async handleAutoStream(
    originalBody: ChatCompletionRequest,
    virtualModel: VirtualModel,
    requestId: string,
    signal?: AbortSignal
  ): Promise<{ stream: UpstreamStreamResponse; targetModel: string; attempts: RouteAttempt[] }> {
    const attempts: RouteAttempt[] = [];
    const excluded = new Set<string>();
    let lastError: UpstreamError | RouterError | undefined;

    for (let attempt = 0; attempt < this.config.autoMaxAttempts; attempt += 1) {
      const decision = await this.routeWithCheapestModel(originalBody, virtualModel, requestId, excluded);
      const finalRoute = finalizeRouterDecision(decision, candidateModelIds(this.registry, excluded));
      const targetModel = finalRoute.targetModel;
      const started = Date.now();
      logEvent({
        request_id: requestId,
        event: "auto_route_applied",
        original_model: virtualModel,
        target_model: targetModel,
        task_type: decision.task_type,
        difficulty: decision.difficulty,
        reasoning_effort: finalRoute.reasoningEffort,
        route_reason: finalRoute.routeReason,
        stream: true
      });

      try {
        const answerBody = buildAnswerBody(originalBody, finalRoute);
        answerBody.stream = true;
        const stream = await this.upstream.chatCompletionsStream(answerBody, requestId, signal);
        attempts.push({ targetModel, status: "success", reasoningEffort: finalRoute.reasoningEffort, durationMs: Date.now() - started });
        return { stream, targetModel, attempts };
      } catch (error) {
        const durationMs = Date.now() - started;
        if (error instanceof UpstreamError) {
          attempts.push({ targetModel, status: "failed", reason: error.code, reasoningEffort: finalRoute.reasoningEffort, durationMs });
          lastError = error;
          excluded.add(targetModel);
          logEvent({
            request_id: requestId,
            event: "auto_stream_answer_failed",
            original_model: virtualModel,
            router_model: this.getRouterModelId(excluded),
            target_model: targetModel,
            error: error.code,
            status: error.status
          });
          if (!error.retryable) {
            throw error;
          }
          continue;
        }
        throw error;
      }
    }

    if (lastError) {
      throw lastError;
    }
    throw new RouterError(503, "no_available_model", "No available target model for auto routing");
  }

  private async routeWithCheapestModel(
    originalBody: ChatCompletionRequest,
    virtualModel: VirtualModel,
    requestId: string,
    excludedTargets: Set<string>
  ): Promise<RouterDecision> {
    const routerModel = this.registry.cheapestPricedModel();
    if (!routerModel?.price) {
      throw new RouterError(503, "no_priced_router_model", "No priced model is available to act as the auto router model");
    }

    const candidateEntries = this.registry.all().filter((entry) => !excludedTargets.has(entry.model.id));
    const candidateModels = candidateEntries.map((entry) => entry.model.id);
    if (candidateModels.length === 0) {
      throw new RouterError(503, "no_available_model", "No candidate models remain after fallback exclusions");
    }

    const routeBody: ChatCompletionRequest = {
      model: routerModel.model.id,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: ROUTER_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            virtual_model: virtualModel,
            routing_goal: routingGoal(virtualModel),
            candidate_models: candidateModels,
            candidate_model_details: candidateEntries.map(modelRoutingProfile),
            excluded_models: [...excludedTargets],
            required_capabilities: inferRequiredCapabilities(originalBody),
            routing_input_notes:
              "For routing only, base64 data URLs and oversized base64-like strings in multimodal messages are replaced with metadata. The final answer request keeps the original messages unchanged.",
            request: {
              messages: prepareMessagesForRouting(originalBody.messages ?? []),
              stream: originalBody.stream,
              temperature: originalBody.temperature,
              max_tokens: originalBody.max_tokens,
              tools: originalBody.tools,
              tool_choice: originalBody.tool_choice,
              parallel_tool_calls: originalBody.parallel_tool_calls,
              functions: originalBody.functions,
              function_call: originalBody.function_call,
              response_format: originalBody.response_format
            }
          })
        }
      ]
    };

    const response = await this.upstream.chatCompletions(routeBody, requestId);
    const decision = parseRouterDecision(response);

    if (!candidateModels.includes(decision.target_model)) {
      throw new RouterError(502, "invalid_router_decision", `Router model selected unavailable target_model '${decision.target_model}'`);
    }

    logEvent({
      request_id: requestId,
      event: "auto_route_decision",
      original_model: virtualModel,
      router_model: routerModel.model.id,
      target_model: decision.target_model,
      task_type: decision.task_type,
      difficulty: decision.difficulty,
      reasoning_effort: decision.reasoning_effort,
      confidence: decision.confidence,
      reason: decision.reason
    });

    return decision;
  }

  private getRouterModelId(_excludedTargets: Set<string>): string | undefined {
    return this.registry.cheapestPricedModel()?.model.id;
  }
}

function validateChatCompletionBody(body: ChatCompletionRequest): asserts body is ChatCompletionRequest & { model: string; messages: unknown[] } {
  if (!body.model || typeof body.model !== "string") {
    throw new RouterError(400, "invalid_request_error", "Request body must include a string model");
  }
  if (!Array.isArray(body.messages)) {
    throw new RouterError(400, "invalid_request_error", "Request body must include messages");
  }
}

export function isVirtualModel(model: string): model is VirtualModel {
  return model === "auto" || model === "auto-coding" || model === "auto-longtext";
}

function routingGoal(virtualModel: VirtualModel): string {
  if (virtualModel === "auto-coding") {
    return [
      "Directly choose the final model for a coding request.",
      "Simple coding should normally use a coding-specialist model such as gpt-5.3-codex when available.",
      "Planning-heavy, difficult, architectural, repo-wide, security-sensitive, or ambiguous coding should use the strongest frontier model such as gpt-5.5 with xhigh reasoning when available.",
      "Do not over-optimize for price when the coding task is hard."
    ].join(" ");
  }
  if (virtualModel === "auto-longtext") {
    return [
      "Directly choose the final model for long-context reading, summarization, extraction, and long document analysis.",
      "Use a low-cost long-context-capable model for direct extraction or simple summarization.",
      "Use the strongest frontier model for multi-document reasoning, contradiction finding, legal/technical analysis, or plans based on long context."
    ].join(" ");
  }
  return [
    "Directly choose the final model for this request.",
    "Use simple_chat, rewrite, translation, summary_simple, simple_coding, hard_coding, coding_planning, longtext_simple, longtext_complex, complex_reasoning, creative, or unknown.",
    "Hard reasoning, difficult coding, planning, and high-risk analysis should choose the strongest frontier model available."
  ].join(" ");
}

function parseRouterDecision(response: unknown): RouterDecision {
  const content = extractAssistantContent(response);
  if (!content) {
    throw new RouterError(502, "invalid_router_response", "Router model response did not include assistant content");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(content));
  } catch {
    throw new RouterError(502, "invalid_router_response", "Router model response was not valid JSON");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new RouterError(502, "invalid_router_response", "Router model response JSON must be an object");
  }

  const targetModel = (parsed as { target_model?: unknown }).target_model;
  const confidence = (parsed as { confidence?: unknown }).confidence;
  const reason = (parsed as { reason?: unknown }).reason;
  const taskType = (parsed as { task_type?: unknown }).task_type;
  const difficulty = (parsed as { difficulty?: unknown }).difficulty;
  const reasoningEffort = (parsed as { reasoning_effort?: unknown }).reasoning_effort;

  if (typeof targetModel !== "string" || targetModel.trim() === "") {
    throw new RouterError(502, "invalid_router_response", "Router model response must include target_model");
  }
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    throw new RouterError(502, "invalid_router_response", "Router model response must include numeric confidence");
  }
  if (typeof reason !== "string") {
    throw new RouterError(502, "invalid_router_response", "Router model response must include reason");
  }

  return {
    target_model: targetModel,
    confidence,
    reason,
    task_type: typeof taskType === "string" ? taskType : undefined,
    difficulty: typeof difficulty === "string" ? difficulty : undefined,
    reasoning_effort: typeof reasoningEffort === "string" ? reasoningEffort : undefined
  };
}

function extractAssistantContent(response: unknown): string | undefined {
  if (!response || typeof response !== "object") {
    return undefined;
  }
  const choices = (response as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return undefined;
  }
  const message = (choices[0] as { message?: unknown }).message;
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : undefined;
}

function stripCodeFence(content: string): string {
  const trimmed = content.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function candidateModelIds(registry: ModelRegistry, excluded: Set<string>): string[] {
  return registry.allIds().filter((id) => !excluded.has(id));
}

function buildAnswerBody(originalBody: ChatCompletionRequest, finalRoute: FinalRoute): ChatCompletionRequest {
  const answerBody: ChatCompletionRequest = { ...originalBody, model: finalRoute.targetModel };
  if (finalRoute.reasoningEffort) {
    answerBody.reasoning_effort = finalRoute.reasoningEffort;
  } else {
    delete answerBody.reasoning_effort;
  }
  return answerBody;
}

function prepareMessagesForRouting(messages: unknown[]): unknown[] {
  return messages.map((message) => sanitizeRoutingValue(message));
}

function inferRequiredCapabilities(body: ChatCompletionRequest): string[] {
  const required = new Set<string>();
  if (hasVisionInput(body.messages)) {
    required.add("vision");
  }
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    required.add("tool_calls");
  }
  if (Array.isArray(body.functions) && body.functions.length > 0) {
    required.add("tool_calls");
  }
  if (body.parallel_tool_calls === true) {
    required.add("parallel_tool_calls");
  }
  return [...required];
}

function hasVisionInput(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => hasVisionInput(item));
  }
  if (!value || typeof value !== "object") {
    return false;
  }

  const object = value as Record<string, unknown>;
  if (object.type === "image_url" || object.type === "input_image") {
    return true;
  }
  if ("image_url" in object || "input_image" in object) {
    return true;
  }
  return Object.values(object).some((item) => hasVisionInput(item));
}

function sanitizeRoutingValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeRoutingString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeRoutingValue(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const source = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    sanitized[key] = sanitizeRoutingValue(item);
  }
  return sanitized;
}

function sanitizeRoutingString(value: string): string {
  const dataUrl = value.match(/^data:([^;,]+)?(?:;[^,]*)*;base64,([\s\S]*)$/i);
  if (dataUrl) {
    const mimeType = dataUrl[1] || "application/octet-stream";
    const base64 = dataUrl[2].replace(/\s/g, "");
    return `[omitted base64 data url for routing: mime=${mimeType}, approx_bytes=${approxBase64Bytes(base64)}, chars=${value.length}]`;
  }

  if (value.length > 2048 && looksLikeBase64(value)) {
    return `[omitted base64-like string for routing: approx_bytes=${approxBase64Bytes(value)}, chars=${value.length}]`;
  }

  if (/^https?:\/\//i.test(value) && value.length > 2048) {
    return `${value.slice(0, 512)}...[truncated url for routing: chars=${value.length}]`;
  }

  return value;
}

function looksLikeBase64(value: string): boolean {
  const compact = value.replace(/\s/g, "");
  if (compact.length < 2048 || compact.length % 4 !== 0) {
    return false;
  }
  return /^[A-Za-z0-9+/=_-]+$/.test(compact);
}

function approxBase64Bytes(value: string): number {
  const compact = value.replace(/\s/g, "");
  const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((compact.length * 3) / 4) - padding);
}

function normalizeLabel(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function finalizeRouterDecision(decision: RouterDecision, candidates: string[]): FinalRoute {
  if (!candidates.includes(decision.target_model)) {
    throw new RouterError(502, "invalid_router_decision", `Router model selected unavailable target_model '${decision.target_model}'`);
  }

  return {
    targetModel: decision.target_model,
    reasoningEffort: normalizeReasoningEffort(decision.reasoning_effort),
    routeReason: decision.reason
  };
}

function normalizeReasoningEffort(value: string | undefined): string | undefined {
  const normalized = normalizeLabel(value);
  if (normalized === "" || normalized === "none") {
    return undefined;
  }
  if (["low", "medium", "high", "xhigh"].includes(normalized)) {
    return normalized;
  }
  return undefined;
}

function modelRoutingProfile(entry: PricedModel) {
  const id = entry.model.id;
  const lower = id.toLowerCase();
  const profile = inferModelProfile(lower);

  return {
    id,
    price: entry.price
      ? {
          input_usd_per_1m_tokens: entry.price.inputUsdPer1MTokens,
          output_usd_per_1m_tokens: entry.price.outputUsdPer1MTokens,
          source: entry.price.source
        }
      : null,
    strength: profile.strength,
    specialties: profile.specialties,
    capabilities: inferModelCapabilities(entry.model, lower),
    recommended_for: profile.recommendedFor,
    reasoning_effort_guidance: profile.reasoningEffortGuidance
  };
}

function inferModelCapabilities(model: Record<string, unknown>, modelId: string) {
  const explicitVision = readCapability(model, ["vision", "image", "images", "image_input", "input_image"]);
  const explicitToolCalls = readCapability(model, ["tool_calls", "tools", "function_calling", "functions"]);
  const explicitParallelToolCalls = readCapability(model, ["parallel_tool_calls", "parallel_tools"]);

  return {
    supports_vision: explicitVision ?? inferVisionSupport(modelId),
    supports_tool_calls: explicitToolCalls ?? inferToolCallSupport(modelId),
    supports_parallel_tool_calls: explicitParallelToolCalls ?? explicitToolCalls ?? inferToolCallSupport(modelId),
    source: explicitVision !== undefined || explicitToolCalls !== undefined || explicitParallelToolCalls !== undefined ? "upstream_or_metadata" : "heuristic"
  };
}

function readCapability(model: Record<string, unknown>, names: string[]): boolean | undefined {
  const containers = [model.capabilities, model.supported_features, model.features, model.metadata, model] as unknown[];
  for (const container of containers) {
    if (!container || typeof container !== "object") {
      continue;
    }
    for (const name of names) {
      const value = (container as Record<string, unknown>)[name];
      if (typeof value === "boolean") {
        return value;
      }
      if (typeof value === "string") {
        const normalized = normalizeLabel(value);
        if (["true", "supported", "yes", "enabled"].includes(normalized)) {
          return true;
        }
        if (["false", "unsupported", "no", "disabled"].includes(normalized)) {
          return false;
        }
      }
    }
  }

  const modalities = collectStringArray(model.modalities, model.input_modalities, model.supported_modalities);
  if (names.some((name) => ["vision", "image", "images", "image_input", "input_image"].includes(name)) && modalities.some((item) => item.includes("image") || item.includes("vision"))) {
    return true;
  }
  return undefined;
}

function collectStringArray(...values: unknown[]): string[] {
  return values.flatMap((value) => {
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string").map((item) => item.toLowerCase());
    }
    return [];
  });
}

function inferVisionSupport(modelId: string): boolean {
  if (modelId.includes("embed") || modelId.includes("rerank") || modelId.includes("tts") || modelId.includes("whisper") || modelId.includes("speech")) {
    return false;
  }
  if (modelId.includes("vision") || modelId.includes("image") || modelId.includes("omni") || modelId.includes("4o") || modelId.includes("gemini") || modelId.includes("claude")) {
    return true;
  }
  if (modelId.includes("gpt-5") && !modelId.includes("codex")) {
    return true;
  }
  return false;
}

function inferToolCallSupport(modelId: string): boolean {
  if (modelId.includes("embed") || modelId.includes("rerank") || modelId.includes("tts") || modelId.includes("whisper") || modelId.includes("speech")) {
    return false;
  }
  return (
    modelId.includes("gpt") ||
    modelId.includes("codex") ||
    modelId.includes("claude") ||
    modelId.includes("anthropic") ||
    modelId.includes("gemini") ||
    modelId.includes("qwen") ||
    modelId.includes("deepseek")
  );
}

function inferModelProfile(modelId: string) {
  const specialties = new Set<string>();
  const recommendedFor: string[] = [];
  let strength = "standard";
  let reasoningEffortGuidance = "Use none or low for simple tasks; medium for standard tasks.";

  if (modelId.includes("gpt-5.5") || modelId.includes("opus") || modelId.includes("alpha") || modelId.includes("4.7")) {
    strength = "frontier_strongest";
    specialties.add("hard_reasoning");
    specialties.add("hard_coding");
    specialties.add("planning");
    specialties.add("architecture");
    specialties.add("long_context_reasoning");
    recommendedFor.push("hard coding", "architecture planning", "complex reasoning", "repo-wide work", "high-risk review");
    reasoningEffortGuidance = "Use high for difficult analysis; use xhigh for hardest planning, architecture, complex debugging, and repo-wide work.";
  } else if (modelId.includes("gpt-5.4") && !modelId.includes("mini")) {
    strength = "frontier_strong";
    specialties.add("reasoning");
    specialties.add("general");
    specialties.add("coding");
    recommendedFor.push("standard reasoning", "general high-quality work", "moderately difficult coding");
    reasoningEffortGuidance = "Use medium or high for non-trivial reasoning.";
  } else if (modelId.includes("gpt-5.2-pro")) {
    strength = "frontier_strong";
    specialties.add("reasoning");
    specialties.add("long_context_reasoning");
    recommendedFor.push("deep analysis", "hard long-context work");
    reasoningEffortGuidance = "Use high or xhigh for complex reasoning.";
  } else if (modelId.includes("gpt-5.2")) {
    strength = "frontier_general";
    specialties.add("general");
    specialties.add("reasoning");
    recommendedFor.push("standard reasoning", "general high-quality answers");
    reasoningEffortGuidance = "Use medium for standard reasoning; high for difficult reasoning.";
  }

  if (modelId.includes("codex")) {
    specialties.add("coding");
    specialties.add("debugging");
    specialties.add("software_engineering");
    recommendedFor.push("simple coding", "code generation", "debugging", "software engineering");
    if (strength === "standard") {
      strength = "coding_specialist";
    }
  }

  if (modelId.includes("mini") || modelId.includes("nano") || modelId.includes("flash") || modelId.includes("haiku")) {
    specialties.add("low_cost");
    specialties.add("fast");
    recommendedFor.push("simple tasks", "cheap routing", "short answers");
    if (strength === "standard") {
      strength = "low_cost";
    }
  }

  if (modelId.includes("claude") || modelId.includes("anthropic")) {
    specialties.add("writing");
    specialties.add("reasoning");
    specialties.add("coding");
    recommendedFor.push("coding", "analysis", "writing");
  }

  if (recommendedFor.length === 0) {
    recommendedFor.push("general use when the router judges it is the best fit");
  }

  return {
    strength,
    specialties: [...specialties],
    recommendedFor,
    reasoningEffortGuidance
  };
}
