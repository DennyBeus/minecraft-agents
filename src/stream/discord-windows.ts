import "dotenv/config";
import { startDiscordVoiceBridge } from "./discord-voice.js";

const relayUrl = process.env.VOICE_BRIDGE_URL;
const secret = process.env.VOICE_BRIDGE_SECRET;
if (!relayUrl || !secret) throw new Error("Set VOICE_BRIDGE_URL and VOICE_BRIDGE_SECRET in .env");

const healthUrl = new URL("/health", relayUrl);
const health = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
if (!health.ok) throw new Error(`Atlas relay is unavailable: HTTP ${health.status}`);

const bridge = await startDiscordVoiceBridge(async (text) => {
  try {
    const response = await fetch(relayUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = (await response.json()) as { reply?: unknown };
    return typeof result.reply === "string" ? result.reply : "Задание передано Атласу.";
  } catch (error) {
    console.error(`[Discord] Atlas relay failed: ${String(error)}`);
    return "Не удалось связаться с Атласом на Spark.";
  }
});
if (!bridge) throw new Error("Discord voice bridge is not configured");
console.log("[Discord] Windows voice bridge is connected to Atlas on Spark");
const stop = () => { bridge.stop(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
