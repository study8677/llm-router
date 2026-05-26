import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { AppConfig, ChatCompletionRequest, OpenAIModel, VIRTUAL_MODELS } from "./types.js";
import { RouterEngine } from "./routerEngine.js";
import { ModelRegistry } from "./modelRegistry.js";
import { FetchUpstreamClient, UpstreamClient, UpstreamError, UpstreamStreamResponse } from "./upstream.js";
import { openAIError, RouterError, sanitizeErrorMessage } from "./errors.js";
import { logEvent } from "./logger.js";

export interface AppState {
  config: AppConfig;
  upstream: UpstreamClient;
  registry: ModelRegistry;
  engine: RouterEngine;
}

export async function createAppState(config: AppConfig, upstream: UpstreamClient = new FetchUpstreamClient(config)): Promise<AppState> {
  const models = await upstream.listModels();
  const registry = new ModelRegistry(models);
  return {
    config,
    upstream,
    registry,
    engine: new RouterEngine(config, upstream, registry)
  };
}

export function createHttpServer(state: AppState) {
  return createServer(async (req, res) => {
    const requestId = randomUUID();
    const started = Date.now();
    res.setHeader("x-llm-router-request-id", requestId);

    try {
      if (!authorize(req, state.config)) {
        sendJson(res, 401, openAIError(401, "authentication_error", "Invalid router API key", "authentication_error").body);
        return;
      }

      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { status: "ok", models: state.registry.allIds().length });
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
  return header === `Bearer ${config.routerApiKey}`;
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
