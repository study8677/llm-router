import { ModelPrice, OpenAIModel } from "./types.js";

interface CatalogEntry {
  aliases: string[];
  inputUsdPer1MTokens: number;
  outputUsdPer1MTokens: number;
}

const CATALOG: CatalogEntry[] = [
  { aliases: ["gpt-4.1-nano", "openai/gpt-4.1-nano"], inputUsdPer1MTokens: 0.1, outputUsdPer1MTokens: 0.4 },
  { aliases: ["gpt-4.1-mini", "openai/gpt-4.1-mini"], inputUsdPer1MTokens: 0.4, outputUsdPer1MTokens: 1.6 },
  { aliases: ["gpt-4o-mini", "openai/gpt-4o-mini"], inputUsdPer1MTokens: 0.15, outputUsdPer1MTokens: 0.6 },
  { aliases: ["gpt-4o", "openai/gpt-4o"], inputUsdPer1MTokens: 2.5, outputUsdPer1MTokens: 10 },
  { aliases: ["gpt-4.1", "openai/gpt-4.1"], inputUsdPer1MTokens: 2, outputUsdPer1MTokens: 8 },
  { aliases: ["gpt-5", "openai/gpt-5", "gpt-5-chat-latest"], inputUsdPer1MTokens: 1.25, outputUsdPer1MTokens: 10 },
  { aliases: ["gpt-5-mini", "openai/gpt-5-mini"], inputUsdPer1MTokens: 0.25, outputUsdPer1MTokens: 2 },
  { aliases: ["gpt-5-nano", "openai/gpt-5-nano"], inputUsdPer1MTokens: 0.05, outputUsdPer1MTokens: 0.4 },
  {
    aliases: ["gpt-5.2", "openai/gpt-5.2", "gpt-5.2-2025-12-11", "gpt-5.2-chat-latest"],
    inputUsdPer1MTokens: 1.75,
    outputUsdPer1MTokens: 14
  },
  {
    aliases: ["gpt-5.2-pro", "openai/gpt-5.2-pro", "gpt-5.2-pro-2025-12-11"],
    inputUsdPer1MTokens: 21,
    outputUsdPer1MTokens: 168
  },
  { aliases: ["gpt-5.3-codex", "openai/gpt-5.3-codex"], inputUsdPer1MTokens: 1.75, outputUsdPer1MTokens: 14 },
  {
    aliases: ["gpt-5.4", "openai/gpt-5.4", "gpt-5.4-2026-03-05"],
    inputUsdPer1MTokens: 2.5,
    outputUsdPer1MTokens: 15
  },
  { aliases: ["gpt-5.4-mini", "openai/gpt-5.4-mini"], inputUsdPer1MTokens: 0.75, outputUsdPer1MTokens: 4.5 },
  { aliases: ["gpt-5.5", "openai/gpt-5.5"], inputUsdPer1MTokens: 5, outputUsdPer1MTokens: 30 },
  { aliases: ["deepseek-chat", "deepseek/deepseek-chat"], inputUsdPer1MTokens: 0.27, outputUsdPer1MTokens: 1.1 },
  { aliases: ["deepseek-reasoner", "deepseek/deepseek-reasoner"], inputUsdPer1MTokens: 0.55, outputUsdPer1MTokens: 2.19 },
  { aliases: ["deepseek-coder", "deepseek/deepseek-coder"], inputUsdPer1MTokens: 0.14, outputUsdPer1MTokens: 0.28 },
  { aliases: ["claude-3-5-haiku", "anthropic/claude-3.5-haiku", "claude-3.5-haiku"], inputUsdPer1MTokens: 0.8, outputUsdPer1MTokens: 4 },
  { aliases: ["claude-3-haiku", "anthropic/claude-3-haiku"], inputUsdPer1MTokens: 0.25, outputUsdPer1MTokens: 1.25 },
  { aliases: ["claude-sonnet-4", "anthropic/claude-sonnet-4", "claude-3-7-sonnet", "anthropic/claude-3.7-sonnet"], inputUsdPer1MTokens: 3, outputUsdPer1MTokens: 15 },
  { aliases: ["gemini-2.0-flash", "google/gemini-2.0-flash"], inputUsdPer1MTokens: 0.1, outputUsdPer1MTokens: 0.4 },
  { aliases: ["gemini-2.5-flash", "google/gemini-2.5-flash"], inputUsdPer1MTokens: 0.3, outputUsdPer1MTokens: 2.5 },
  { aliases: ["gemini-2.5-pro", "google/gemini-2.5-pro"], inputUsdPer1MTokens: 1.25, outputUsdPer1MTokens: 10 },
  { aliases: ["qwen2.5-coder-32b-instruct", "qwen/qwen2.5-coder-32b-instruct"], inputUsdPer1MTokens: 0.2, outputUsdPer1MTokens: 0.2 },
  { aliases: ["qwen2.5-7b-instruct", "qwen/qwen2.5-7b-instruct"], inputUsdPer1MTokens: 0.05, outputUsdPer1MTokens: 0.05 },
  { aliases: ["llama-3.1-8b-instruct", "meta-llama/llama-3.1-8b-instruct"], inputUsdPer1MTokens: 0.05, outputUsdPer1MTokens: 0.05 },
  { aliases: ["llama-3.1-70b-instruct", "meta-llama/llama-3.1-70b-instruct"], inputUsdPer1MTokens: 0.35, outputUsdPer1MTokens: 0.4 }
];

function numberFromUnknown(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function getPath(source: unknown, path: string[]): unknown {
  let current = source;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function maybePerTokenToPerMillion(value: number): number {
  return value > 0 && value < 0.001 ? value * 1_000_000 : value;
}

function priceFromUpstream(model: OpenAIModel): ModelPrice | undefined {
  const inputCandidates = [
    getPath(model, ["pricing", "prompt"]),
    getPath(model, ["pricing", "input"]),
    getPath(model, ["pricing", "input_price"]),
    getPath(model, ["input_price"]),
    getPath(model, ["input_cost_per_million"]),
    getPath(model, ["prompt_price"])
  ];
  const outputCandidates = [
    getPath(model, ["pricing", "completion"]),
    getPath(model, ["pricing", "output"]),
    getPath(model, ["pricing", "output_price"]),
    getPath(model, ["output_price"]),
    getPath(model, ["output_cost_per_million"]),
    getPath(model, ["completion_price"])
  ];

  const input = inputCandidates.map(numberFromUnknown).find((value) => value !== undefined);
  const output = outputCandidates.map(numberFromUnknown).find((value) => value !== undefined);

  if (input === undefined || output === undefined) {
    return undefined;
  }

  return {
    inputUsdPer1MTokens: maybePerTokenToPerMillion(input),
    outputUsdPer1MTokens: maybePerTokenToPerMillion(output),
    source: "upstream"
  };
}

function normalizeModelId(id: string): string {
  return id.toLowerCase().replace(/[:@].*$/, "").replace(/[_\s]+/g, "-");
}

function priceFromCatalog(modelId: string): ModelPrice | undefined {
  const normalized = normalizeModelId(modelId);
  const match = CATALOG.find((entry) =>
    entry.aliases.some((alias) => normalized === normalizeModelId(alias) || normalized.endsWith(`/${normalizeModelId(alias)}`))
  );

  if (!match) {
    return undefined;
  }

  return {
    inputUsdPer1MTokens: match.inputUsdPer1MTokens,
    outputUsdPer1MTokens: match.outputUsdPer1MTokens,
    source: "catalog"
  };
}

export function resolveModelPrice(model: OpenAIModel): ModelPrice | undefined {
  return priceFromUpstream(model) ?? priceFromCatalog(model.id);
}

export function totalPrice(price: ModelPrice): number {
  return price.inputUsdPer1MTokens + price.outputUsdPer1MTokens;
}
