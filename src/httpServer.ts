import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { AppConfig, ChatCompletionRequest, OpenAIModel, VIRTUAL_MODELS } from "./types.js";
import { RouterEngine } from "./routerEngine.js";
import { ModelRegistry } from "./modelRegistry.js";
import { FetchUpstreamClient, UpstreamClient, UpstreamError, UpstreamStreamResponse } from "./upstream.js";
import { openAIError, RouterError, sanitizeErrorMessage } from "./errors.js";
import { logEvent } from "./logger.js";
import { RuntimeConfigStore } from "./runtimeConfig.js";
import { adminPageHtml } from "./adminPage.js";

export interface AppState {
  config: AppConfig;
  upstream: UpstreamClient;
  registry: ModelRegistry;
  runtimeConfig: RuntimeConfigStore;
  engine: RouterEngine;
}

export async function createAppState(config: AppConfig, upstream: UpstreamClient = new FetchUpstreamClient(config)): Promise<AppState> {
  const runtimeConfig = new RuntimeConfigStore(config.runtimeConfigPath);
  await runtimeConfig.load();
  const models = await upstream.listModels();
  const registry = new ModelRegistry(models);
  return {
    config,
    upstream,
    registry,
    runtimeConfig,
    engine: new RouterEngine(config, upstream, registry, runtimeConfig)
  };
}

export function createHttpServer(state: AppState) {
  return createServer(async (req, res) => {
    const requestId = randomUUID();
    const started = Date.now();
    res.setHeader("x-llm-router-request-id", requestId);

    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/admin" || url.pathname === "/config")) {
        sendHtml(res, 200, adminPageHtml());
        return;
      }

      if (!authorize(req, state.config)) {
        sendJson(res, 401, openAIError(401, "authentication_error", "Invalid router API key", "authentication_error").body);
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { status: "ok", models: state.registry.allIds().length });
        return;
      }

      if (req.method === "GET" && (url.pathname === "/admin/config" || url.pathname === "/config/runtime")) {
        sendJson(res, 200, adminConfigResponse(state));
        return;
      }

      if ((req.method === "POST" || req.method === "PUT") && (url.pathname === "/admin/config" || url.pathname === "/config/runtime")) {
        const body = await readJson(req);
        const routerModelId = parseRouterModelId(body);
        if (routerModelId && !state.registry.hasModel(routerModelId)) {
          throw new RouterError(400, "invalid_router_model", `Router model '${routerModelId}' was not found in upstream model list`);
        }
        await state.runtimeConfig.update(routerModelId ? { routerModelId } : {});
        logEvent({
          request_id: requestId,
          event: "admin_config_updated",
          router_model: routerModelId ?? "automatic"
        });
        sendJson(res, 200, adminConfigResponse(state));
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/models") {
        sendJson(res, 200, modelsResponse(state.registry.all().map((entry) => entry.model)));
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
        const body = (await readJson(req)) as ChatCompletionRequest;
        const originalModel = typeof body.model === "string" ? body.model : undefined;
        if (body.stream === true) {
          const abortController = new AbortController();
          req.on("close", () => {
            if (!res.writableEnded) {
              abortController.abort();
            }
          });
          res.on("close", () => {
            if (!res.writableEnded) {
              abortController.abort();
            }
          });
          const result = await state.engine.handleChatCompletionStream(body, requestId, abortController.signal);
          res.setHeader("x-llm-router-original-model", originalModel ?? "");
          res.setHeader("x-llm-router-target-model", result.targetModel);
          await sendEventStream(res, result.stream, abortController);
          logEvent({
            request_id: requestId,
            event: "request_completed",
            original_model: originalModel,
            target_model: result.targetModel,
            attempts: result.attempts,
            duration_ms: Date.now() - started,
            stream: true
          });
          return;
        }

        const result = await state.engine.handleChatCompletion(body, requestId);
        res.setHeader("x-llm-router-original-model", originalModel ?? "");
        res.setHeader("x-llm-router-target-model", result.targetModel);
        sendJson(res, 200, result.response);
        logEvent({
          request_id: requestId,
          event: "request_completed",
          original_model: originalModel,
          target_model: result.targetModel,
          attempts: result.attempts,
          duration_ms: Date.now() - started
        });
        return;
      }

      sendJson(res, 404, openAIError(404, "not_found", "Route not found").body);
    } catch (error) {
      const normalized = normalizeError(error);
      if (res.headersSent) {
        logEvent({
          request_id: requestId,
          event: "request_failed_after_headers",
          duration_ms: Date.now() - started,
          status: normalized.status,
          error: normalized.body.error.code
        });
        if (!res.writableEnded) {
          res.destroy(error instanceof Error ? error : undefined);
        }
        return;
      }
      sendJson(res, normalized.status, normalized.body);
      logEvent({
        request_id: requestId,
        event: "request_failed",
        duration_ms: Date.now() - started,
        status: normalized.status,
        error: normalized.body.error.code
      });
    }
  });
}

function authorize(req: IncomingMessage, config: AppConfig): boolean {
  if (!config.routerApiKey) {
    return true;
  }
  const header = req.headers.authorization;
  const keyHeader = req.headers["x-router-api-key"];
  return header === `Bearer ${config.routerApiKey}` || keyHeader === config.routerApiKey;
}

function modelsResponse(upstreamModels: OpenAIModel[]) {
  return {
    object: "list",
    data: [
      ...VIRTUAL_MODELS.map((id) => ({
        id,
        object: "model",
        owned_by: "llm-router"
      })),
      ...upstreamModels
    ]
  };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    throw new RouterError(400, "invalid_request_error", "Request body must be JSON");
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new RouterError(400, "invalid_request_error", "Request body must be valid JSON");
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function sendHtml(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(body);
}

function adminConfigResponse(state: AppState) {
  const current = state.runtimeConfig.get();
  const automaticRouterModel = state.registry.cheapestPricedModel();
  const configuredRouterModel = current.routerModelId ? state.registry.get(current.routerModelId) : undefined;
  const effectiveRouterModel = current.routerModelId ? configuredRouterModel : automaticRouterModel;

  return {
    router_model_mode: current.routerModelId ? "manual" : "automatic",
    router_model_id: current.routerModelId ?? null,
    automatic_router_model_id: automaticRouterModel?.model.id ?? null,
    effective_router_model_id: effectiveRouterModel?.model.id ?? null,
    configured_router_model_available: current.routerModelId ? Boolean(configuredRouterModel) : true,
    models: state.registry.all().map((entry) => ({
      id: entry.model.id,
      price: entry.price
        ? {
            input_usd_per_1m_tokens: entry.price.inputUsdPer1MTokens,
            output_usd_per_1m_tokens: entry.price.outputUsdPer1MTokens,
            source: entry.price.source
          }
        : null,
      is_automatic_router_model: entry.model.id === automaticRouterModel?.model.id,
      is_effective_router_model: entry.model.id === effectiveRouterModel?.model.id
    }))
  };
}

function parseRouterModelId(body: unknown): string | undefined {
  if (!body || typeof body !== "object") {
    throw new RouterError(400, "invalid_request_error", "Request body must be a JSON object");
  }

  const value = (body as { router_model_id?: unknown; routerModelId?: unknown }).router_model_id ?? (body as { routerModelId?: unknown }).routerModelId;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new RouterError(400, "invalid_request_error", "router_model_id must be a string or null");
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

async function sendEventStream(res: ServerResponse, stream: UpstreamStreamResponse, abortController: AbortController): Promise<void> {
  res.statusCode = 200;
  res.setHeader("content-type", stream.headers.get("content-type") ?? "text/event-stream; charset=utf-8");
  res.setHeader("cache-control", stream.headers.get("cache-control") ?? "no-cache");
  res.setHeader("connection", "keep-alive");
  res.setHeader("x-accel-buffering", "no");

  try {
    for await (const chunk of stream.body as unknown as AsyncIterable<Uint8Array>) {
      if (res.writableEnded || abortController.signal.aborted) {
        break;
      }
      if (!res.write(Buffer.from(chunk))) {
        await once(res, "drain");
      }
    }
  } finally {
    if (res.writableEnded || res.destroyed) {
      abortController.abort();
    }
  }

  if (!res.writableEnded) {
    res.end();
  }
}

function normalizeError(error: unknown) {
  if (error instanceof RouterError) {
    return openAIError(error.status, error.code, error.message, error.type);
  }
  if (error instanceof UpstreamError) {
    return openAIError(error.status, error.code, sanitizeErrorMessage(error.message), error.type);
  }
  const message = error instanceof Error ? error.message : String(error);
  return openAIError(500, "internal_error", sanitizeErrorMessage(message), "server_error");
}
