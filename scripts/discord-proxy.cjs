// The ws package used by discord.js does not read HTTPS_PROXY itself.
// Route Discord WebSocket handshakes through the host's HTTPS proxy when set.
const https = require("node:https");
const { HttpsProxyAgent } = require("https-proxy-agent");

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
if (proxyUrl) {
  const agent = new HttpsProxyAgent(proxyUrl);
  const originalRequest = https.request;
  https.request = function requestWithDiscordProxy(input, options, callback) {
    const opts = typeof input === "object" && !(input instanceof URL) ? input : options;
    const host = opts?.hostname || opts?.host || (input instanceof URL ? input.hostname : "");
    if (typeof host === "string" && /(^|\.)discord(?:\.com|\.gg|\.media)$/.test(host) && !opts?.agent) {
      if (typeof input === "object" && !(input instanceof URL)) input = { ...input, agent };
      else options = { ...options, agent };
    }
    return originalRequest.call(this, input, options, callback);
  };
}
