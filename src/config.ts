import { AppConfig } from "./types.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnvFile(): void {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) {
    return;
  }

  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = unquote(trimmed.slice(separator + 1).trim());
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function intEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim() === "") {
    return defaultValue;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "");
}

export function loadConfig(): AppConfig {
  loadDotEnvFile();

  return {
    port: intEnv("PORT", 8787),
    upstreamBaseUrl: normalizeBaseUrl(requiredEnv("UPSTREAM_BASE_URL")),
    upstreamApiKey: requiredEnv("UPSTREAM_API_KEY"),
    routerApiKey: process.env.ROUTER_API_KEY?.trim() || undefined,
    runtimeConfigPath: process.env.LLM_ROUTER_CONFIG_PATH?.trim() || ".llm-router.local.json",
    upstreamTimeoutMs: intEnv("UPSTREAM_TIMEOUT_MS", 30_000),
    autoMaxAttempts: intEnv("AUTO_MAX_ATTEMPTS", 2)
  };
}
