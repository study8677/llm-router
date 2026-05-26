export class RouterError extends Error {
  status: number;
  code: string;
  type: string;

  constructor(status: number, code: string, message: string, type = "invalid_request_error") {
    super(message);
    this.name = "RouterError";
    this.status = status;
    this.code = code;
    this.type = type;
  }
}

export function openAIError(status: number, code: string, message: string, type = "invalid_request_error") {
  return {
    status,
    body: {
      error: {
        message,
        type,
        code
      }
    }
  };
}

export function sanitizeErrorMessage(message: string): string {
  return message.replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-***");
}

export function normalizeUpstreamStatus(status: number): { code: string; type: string; retryable: boolean } {
  if (status === 400) {
    return { code: "invalid_request_error", type: "invalid_request_error", retryable: false };
  }
  if (status === 401) {
    return { code: "authentication_error", type: "authentication_error", retryable: false };
  }
  if (status === 403) {
    return { code: "permission_error", type: "permission_error", retryable: false };
  }
  if (status === 404) {
    return { code: "model_not_found", type: "invalid_request_error", retryable: false };
  }
  if (status === 408) {
    return { code: "timeout_error", type: "timeout_error", retryable: true };
  }
  if (status === 429) {
    return { code: "rate_limit_error", type: "rate_limit_error", retryable: true };
  }
  if (status >= 500) {
    return { code: "upstream_error", type: "server_error", retryable: true };
  }
  return { code: "upstream_error", type: "api_error", retryable: false };
}
