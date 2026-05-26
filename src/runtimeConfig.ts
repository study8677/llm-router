import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { RuntimeConfigProvider, RuntimeRouterConfig } from "./types.js";

export class RuntimeConfigStore implements RuntimeConfigProvider {
  private config: RuntimeRouterConfig = {};
  private readonly path: string;

  constructor(path: string) {
    this.path = resolve(process.cwd(), path);
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.path, "utf8");
      this.config = normalizeRuntimeConfig(JSON.parse(raw));
    } catch (error) {
      if (isNotFound(error)) {
        this.config = {};
        return;
      }
      throw error;
    }
  }

  get(): RuntimeRouterConfig {
    return { ...this.config };
  }

  async update(next: RuntimeRouterConfig): Promise<RuntimeRouterConfig> {
    this.config = normalizeRuntimeConfig(next);
    await this.save();
    return this.get();
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tempPath = `${this.path}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(this.config, null, 2)}\n`, "utf8");
    await rename(tempPath, this.path);
  }
}

function normalizeRuntimeConfig(value: unknown): RuntimeRouterConfig {
  if (!value || typeof value !== "object") {
    return {};
  }

  const routerModelId = (value as { routerModelId?: unknown; router_model_id?: unknown }).routerModelId ?? (value as { router_model_id?: unknown }).router_model_id;
  if (typeof routerModelId !== "string") {
    return {};
  }

  const trimmed = routerModelId.trim();
  return trimmed ? { routerModelId: trimmed } : {};
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT";
}
