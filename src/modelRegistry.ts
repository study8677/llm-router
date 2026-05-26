import { resolveModelPrice, totalPrice } from "./priceCatalog.js";
import { OpenAIModel, PricedModel } from "./types.js";

export class ModelRegistry {
  private pricedModels: PricedModel[];

  constructor(models: OpenAIModel[]) {
    this.pricedModels = models
      .filter((model) => typeof model.id === "string" && model.id.trim() !== "")
      .map((model) => ({ model, price: resolveModelPrice(model) }));
  }

  all(): PricedModel[] {
    return this.pricedModels;
  }

  allIds(): string[] {
    return this.pricedModels.map((entry) => entry.model.id);
  }

  hasModel(id: string): boolean {
    return this.pricedModels.some((entry) => entry.model.id === id);
  }

  cheapestPricedModel(excluded = new Set<string>()): PricedModel | undefined {
    return this.pricedModels
      .filter((entry) => entry.price && !excluded.has(entry.model.id))
      .sort((a, b) => totalPrice(a.price!) - totalPrice(b.price!))[0];
  }
}
