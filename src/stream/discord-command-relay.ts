import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

/** Receive transcripts from the Discord voice process running on Windows. */
export function startDiscordCommandRelay(
  secret: string,
  port: number,
  onCommand: (text: string) => string,
): () => void {
  if (secret.length < 32) throw new Error("VOICE_BRIDGE_SECRET must contain at least 32 characters");
  const expected = Buffer.from(secret);
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method !== "POST" || req.url !== "/voice-command") {
      res.writeHead(404).end();
      return;
    }
    const supplied = Buffer.from((req.headers.authorization || "").replace(/^Bearer /i, ""));
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.writeHead(401).end();
      return;
    }
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk.toString("utf8");
        if (body.length > 4096) {
          res.writeHead(413).end();
          return;
        }
      }
      const parsed = JSON.parse(body) as { text?: unknown };
      if (typeof parsed.text !== "string" || !parsed.text.trim() || parsed.text.length > 1000) {
        res.writeHead(400).end();
        return;
      }
      console.log(`[Discord relay] Operator: ${parsed.text}`);
      const reply = onCommand(parsed.text);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ reply }));
    } catch (error) {
      console.warn(`[Discord relay] Request failed: ${String(error)}`);
      if (!res.headersSent) res.writeHead(400).end();
    }
  });
  server.listen(port, "0.0.0.0", () => console.log(`[Discord relay] Listening on port ${port}`));
  server.on("error", (error) => console.error(`[Discord relay] Server error: ${error.message}`));
  return () => server.close();
}
