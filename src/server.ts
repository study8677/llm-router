import { loadConfig } from "./config.js";
import { createAppState, createHttpServer } from "./httpServer.js";
import { logEvent } from "./logger.js";

async function main() {
  const config = loadConfig();
  const state = await createAppState(config);
  const server = createHttpServer(state);
  server.listen(config.port, () => {
    logEvent({
      request_id: "startup",
      event: "server_started",
      port: config.port,
      upstream_base_url: config.upstreamBaseUrl,
      models: state.registry.allIds().length
    });
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  logEvent({ request_id: "startup", event: "server_failed", error: message });
  process.exit(1);
});
