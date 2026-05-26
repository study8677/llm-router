import { loadConfig } from "../src/config.js";
import { ModelRegistry } from "../src/modelRegistry.js";
import { RouterEngine } from "../src/routerEngine.js";
import { FetchUpstreamClient } from "../src/upstream.js";

interface EvalCase {
  id: string;
  model: "auto" | "auto-coding" | "auto-longtext";
  prompt: string;
}

interface EvalResult {
  id: string;
  virtual_model: string;
  target_model: string;
  task_type: string;
  difficulty: string;
  reasoning_effort: string;
  confidence: number | "";
  reason: string;
  ok: boolean;
}

const cases: EvalCase[] = [
  { id: "general_simple_qa", model: "auto", prompt: "Reply exactly: ok. What is 2+2?" },
  { id: "translation", model: "auto", prompt: "Translate to English, reply only the translation: 我今天要测试路由器。" },
  { id: "rewrite", model: "auto", prompt: "Rewrite this sentence to be clearer, reply in one sentence: This API thing maybe can be more better for users." },
  { id: "simple_summary", model: "auto", prompt: "Summarize in 8 words: The router uses a cheap model to choose the best target model, then forwards the original request to that selected model." },
  { id: "complex_reasoning", model: "auto", prompt: "A system has three fallback providers, two rate-limit policies, and inconsistent user quotas. Reply exactly: ok after deciding which model should handle a multi-step root-cause analysis." },
  { id: "simple_coding", model: "auto-coding", prompt: "Write a tiny TypeScript add(a,b) function. Reply only with code." },
  { id: "api_usage_coding", model: "auto-coding", prompt: "Show a minimal fetch POST request in TypeScript. Reply only with code." },
  { id: "standard_debug", model: "auto-coding", prompt: "Find the bug in this function and reply with a one-line fix: function sum(xs){ return xs.reduce((a,b)=>a-b,0) }" },
  { id: "repo_planning", model: "auto-coding", prompt: "Plan a difficult repo-wide TypeScript migration from REST handlers to a policy-driven routing architecture. Reply exactly: ok." },
  { id: "architecture_design", model: "auto-coding", prompt: "Design a robust architecture for multi-provider LLM fallback, observability, and billing reconciliation. Reply exactly: ok." },
  { id: "security_review", model: "auto-coding", prompt: "Review a payment webhook auth flow for subtle security risks and replay attacks. Reply exactly: ok." },
  { id: "production_incident_debug", model: "auto-coding", prompt: "Debug an intermittent production race condition across queue workers, database writes, and webhook retries. Reply exactly: ok." },
  { id: "longtext_extract", model: "auto-longtext", prompt: "Extract the three action items from this text and reply as short bullets: Alice owns docs. Bob owns tests. Carol owns deploy. The meeting ended." },
  { id: "longtext_complex_analysis", model: "auto-longtext", prompt: "Given a long contract with conflicting liability clauses and implementation obligations, choose a model for careful contradiction analysis. Reply exactly: ok." },
  { id: "creative_copy", model: "auto", prompt: "Write a short product tagline for an LLM router. Reply with one line." },
  { id: "math_reasoning", model: "auto", prompt: "Solve a tricky combinatorics proof planning task. Reply exactly: ok." },
  { id: "data_extraction", model: "auto", prompt: "Extract JSON with name and date from: Jingwen met Alex on 2026-05-26. Reply only JSON." },
  { id: "ambiguous_high_risk", model: "auto", prompt: "A user asks to change billing logic in production but requirements are ambiguous. Choose a model for risk-aware planning. Reply exactly: ok." }
];

const originalWrite = process.stdout.write.bind(process.stdout);
const events: Array<Record<string, unknown>> = [];

process.stdout.write = (chunk, ...args) => {
  const text = String(chunk);
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed.event) {
        events.push(parsed);
      }
    } catch {
      // Suppress structured engine logs so the eval output stays readable.
    }
  }
  void args;
  return true;
};

try {
  const config = loadConfig();
  config.autoMaxAttempts = 1;

  const upstream = new FetchUpstreamClient(config);
  const models = await upstream.listModels();
  const registry = new ModelRegistry(models);
  const engine = new RouterEngine(config, upstream, registry);
  const results: EvalResult[] = [];

  for (const testCase of cases) {
    const requestId = `live_eval_${testCase.id}_${Date.now()}`;
    const eventStart = events.length;

    try {
      const result = await engine.handleChatCompletion(
        {
          model: testCase.model,
          temperature: 0,
          max_tokens: 12,
          messages: [{ role: "user", content: testCase.prompt }]
        },
        requestId
      );

      const newEvents = events.slice(eventStart).filter((event) => event.request_id === requestId);
      const decision = newEvents.find((event) => event.event === "auto_route_decision") ?? {};
      const applied = newEvents.find((event) => event.event === "auto_route_applied") ?? {};

      results.push({
        id: testCase.id,
        virtual_model: testCase.model,
        target_model: result.targetModel,
        task_type: stringField(decision.task_type),
        difficulty: stringField(decision.difficulty),
        reasoning_effort: stringField(applied.reasoning_effort ?? decision.reasoning_effort),
        confidence: numberField(decision.confidence),
        reason: stringField(decision.reason),
        ok: true
      });
    } catch (error) {
      results.push({
        id: testCase.id,
        virtual_model: testCase.model,
        target_model: "",
        task_type: "",
        difficulty: "",
        reasoning_effort: "",
        confidence: "",
        reason: error instanceof Error ? error.message : String(error),
        ok: false
      });
    }
  }

  process.stdout.write = originalWrite;
  printReport(models.length, registry.cheapestPricedModel()?.model.id ?? "", results);
} finally {
  process.stdout.write = originalWrite;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberField(value: unknown): number | "" {
  return typeof value === "number" ? value : "";
}

function printReport(modelCount: number, routerModel: string, results: EvalResult[]): void {
  originalWrite(`Live routing eval\n`);
  originalWrite(`Models: ${modelCount}\n`);
  originalWrite(`Router model: ${routerModel}\n\n`);
  originalWrite(`| Case | Virtual | Target | Difficulty | Effort | Confidence |\n`);
  originalWrite(`| --- | --- | --- | --- | --- | --- |\n`);
  for (const result of results) {
    originalWrite(
      `| ${result.id} | ${result.virtual_model} | ${result.target_model || "ERROR"} | ${result.difficulty || "-"} | ${result.reasoning_effort || "-"} | ${result.confidence || "-"} |\n`
    );
  }
  originalWrite(`\nDetails:\n`);
  originalWrite(`${JSON.stringify(results, null, 2)}\n`);
}
