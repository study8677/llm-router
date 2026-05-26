import { RequestLog } from "./types.js";

export function logEvent(event: RequestLog): void {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
}
