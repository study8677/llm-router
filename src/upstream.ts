import { AppConfig, ChatCompletionRequest, OpenAIModel } from "./types.js";
import { normalizeUpstreamStatus, sanitizeErrorMessage } from "./errors.js";

export class UpstreamError extends Error {
  status: number;
  code: string;
  type: string;
  retryable: boolean;
  body?: unknown;

  constructor(status: number, code: string, message: string, type: string, retryable: boolean, body?: unknown) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
    this.code = code;
    this.type = type;
    this.retryable = retryable;
    this.body = body;
  }
}

export interface UpstreamClient {
  listModels(): Promise<OpenAIModel[]>;
  chatCompletions(body: ChatCompletionRequest, requestId: string): Promise<unknown>;
  chatCompletionsStream(body: ChatCompletionRequest, requestId: string, signal?: AbortSignal): Promise<UpstreamStreamResponse>;
}

export interface UpstreamStreamResponse {
  headers: Headers;
  body: ReadableStream<Uint8Array>;
}

export class FetchUpstreamClient implements UpstreamClient {
  constructor(private readonly config: AppConfig) {}

  async listModels(): Promise<OpenAIModel[]> {
    const response = await this.request("/v1/models", { method: "GET" }, "models");
    const body = await response.json().catch(() => undefined);
    if (!body || typeof body !== "object" || !Array.isArray((body as { data?: unknown }).data)) {
      throw new UpstreamError(502, "upstream_invalid_response", "Upstream /v1/models returned an invalid response", "api_error", false, body);
    }
    return (body as { data: OpenAIModel[] }).data;
  }

  async chatCompletions(body: ChatCompletionRequest, requestId: string): Promise<unknown> {
    const response = await this.request(
      "/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-llm-router-request-id": requestId
        },
        body: JSON.stringify(body)
      },
      requestId
    );
    return response.json().catch(() => {
      throw new UpstreamError(502, "upstream_invalid_response", "Upstream returned invalid JSON", "api_error", false);
    });
  }

  async chatCompletionsStream(body: ChatCompletionRequest, requestId: string, signal?: AbortSignal): Promise<UpstreamStreamResponse> {
    const response = await this.request(
      "/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-llm-router-request-id": requestId
        },
        body: JSON.stringify(body)
      },
      requestId,
      signal
    );

    if (!response.body) {
      throw new UpstreamError(502, "upstream_invalid_response", "Upstream returned an empty stream", "api_error", false);
    }

    return {
      headers: response.headers,
      body: response.body
    };
  }

  private async request(path: string, init: RequestInit, requestId: string, signal?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    const fetchSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
    const timeout = setTimeout(() => controller.abort(), this.config.upstreamTimeoutMs);
    try {
      const response = await fetch(`${this.config.upstreamBaseUrl}${path}`, {
        ...init,
        signal: fetchSignal,
        headers: {
          authorization: `Bearer ${this.config.upstreamApiKey}`,
          ...(init.headers ?? {})
        }
      });

      if (!response.ok) {
        const body = await response.json().catch(() => undefined);
        const details = normalizeUpstreamStatus(response.status);
        throw new UpstreamError(
          response.status,
          details.code,
          sanitizeErrorMessage(extractErrorMessage(body) ?? `Upstream request failed with HTTP ${response.status}`),
          details.type,
          details.retryable,
          body
        );
      }

      return response;
    } catch (error) {
      if (error instanceof UpstreamError) {
        throw error;
      }
      if (signal?.aborted) {
        throw new UpstreamError(499, "client_closed_request", "Client closed request", "api_error", false);
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new UpstreamError(408, "timeout_error", "Upstream request timed out", "timeout_error", true);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new UpstreamError(502, "network_error", sanitizeErrorMessage(message), "api_error", true);
    } finally {
      clearTimeout(timeout);
      void requestId;
    }
  }
}

function extractErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : undefined;
  }
  const message = (body as { message?: unknown }).message;
  return typeof message === "string" ? message : undefined;
}
