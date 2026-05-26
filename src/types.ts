export const VIRTUAL_MODELS = ["auto", "auto-coding", "auto-longtext"] as const;

export type VirtualModel = (typeof VIRTUAL_MODELS)[number];

export interface AppConfig {
  port: number;
  upstreamBaseUrl: string;
  upstreamApiKey: string;
  routerApiKey?: string;
  runtimeConfigPath: string;
  upstreamTimeoutMs: number;
  autoMaxAttempts: number;
}

export interface OpenAIModel {
  id: string;
  object?: string;
  owned_by?: string;
  [key: string]: unknown;
}

export interface ModelPrice {
  inputUsdPer1MTokens: number;
  outputUsdPer1MTokens: number;
  source: "upstream" | "catalog";
}

export interface PricedModel {
  model: OpenAIModel;
  price?: ModelPrice;
}

export interface RuntimeRouterConfig {
  routerModelId?: string;
}

export interface RuntimeConfigProvider {
  get(): RuntimeRouterConfig;
}

export interface ChatCompletionRequest {
  model?: string;
  messages?: unknown[];
  stream?: boolean;
  [key: string]: unknown;
}

export interface RouterDecision {
  target_model: string;
  confidence: number;
  reason: string;
  task_type?: string;
  difficulty?: string;
  reasoning_effort?: string;
}

export interface RouteAttempt {
  targetModel: string;
  status: "success" | "failed";
  reason?: string;
  reasoningEffort?: string;
  durationMs: number;
}

export interface RequestLog {
  request_id: string;
  event: string;
  original_model?: string;
  router_model?: string;
  target_model?: string;
  attempts?: RouteAttempt[];
  duration_ms?: number;
  error?: string;
  status?: number;
  [key: string]: unknown;
}
