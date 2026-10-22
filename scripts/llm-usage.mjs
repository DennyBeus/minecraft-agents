// Summarize provider-reported usage from the existing episode event log.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.env.DATASET_EVENT_DIR || "logs/episode-events-v1");
const eventsDir = path.join(root, "events");
const files = fs.existsSync(eventsDir) ? fs.readdirSync(eventsDir).filter((name) => name.endsWith(".jsonl")) : [];
const summary = { requests: 0, responses: 0, errors: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, usageUnavailable: 0, models: {} };

for (const file of files) {
  for (const line of fs.readFileSync(path.join(eventsDir, file), "utf8").split("\n")) {
    if (!line) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.kind === "model_request") { summary.requests++; continue; }
    const match = /^sha256:([a-f0-9]{64})$/.exec(event.payloadRef || "");
    if (event.kind !== "model_response" || !match) continue;
    const hash = match[1];
    const payloadPath = path.join(root, "payloads", hash.slice(0, 2), `${hash}.json`);
    if (!fs.existsSync(payloadPath)) continue;
    let payload;
    try { payload = JSON.parse(fs.readFileSync(payloadPath, "utf8")); } catch { continue; }
    summary.responses++;
    if (!payload.ok) summary.errors++;
    const model = payload.metadata?.model || "unknown";
    const entry = summary.models[model] ||= { requests: 0, errors: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, latencyMs: 0 };
    entry.requests++;
    if (!payload.ok) entry.errors++;
    if (Number.isFinite(payload.metadata?.durationMs)) entry.latencyMs += payload.metadata.durationMs;
    const usage = payload.metadata?.usage || {};
    if (usage.totalTokens === null || usage.totalTokens === undefined) summary.usageUnavailable++;
    for (const key of ["inputTokens", "outputTokens", "totalTokens"]) {
      if (Number.isFinite(usage[key])) { summary[key] += usage[key]; entry[key] += usage[key]; }
    }
  }
}
for (const entry of Object.values(summary.models)) {
  entry.averageLatencyMs = Math.round(entry.latencyMs / entry.requests);
  delete entry.latencyMs;
}
console.log(JSON.stringify(summary, null, 2));
console.log("Стоимость: см. OpenRouter Activity; локально она не оценивается.");
