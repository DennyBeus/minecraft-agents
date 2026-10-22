import "dotenv/config";

export type LLMProvider = "ollama" | "openai";

/** Which LLM backend to talk to. Defaults to ollama so existing setups are
 *  unaffected by the addition of the OpenAI path. */
const llmProvider = (process.env.LLM_PROVIDER || "ollama").toLowerCase() as LLMProvider;

const ollamaConfig = {
  host: process.env.OLLAMA_HOST || "http://localhost:11434",
  // qwen3.6:35b-a3b is an MoE (~3B active params): 35B-class quality at ~150 tok/s
  // on a single 32GB GPU. One model for both strategic and fast paths avoids
  // VRAM eviction thrash between two resident models.
  model: process.env.OLLAMA_MODEL || "qwen3.6:35b-a3b",
  fastModel: process.env.OLLAMA_FAST_MODEL || process.env.OLLAMA_MODEL || "qwen3.6:35b-a3b",
};

/** Any OpenAI-compatible endpoint: OpenAI itself, OpenRouter, Groq, Together,
 *  vLLM, LiteLLM, LM Studio. Only the base URL and key change.
 *
 *  No default model, deliberately. A pinned name goes stale — this shipped with
 *  `gpt-4o-mini`, which OpenAI had already deprecated in favour of the GPT-5.x
 *  family — and a stale default fails as a confusing model_not_found on the
 *  first decision rather than as a configuration error at startup. Model choice
 *  also can't have a sane cross-provider default when the same setting has to
 *  serve OpenAI, OpenRouter, Groq and a self-hosted vLLM. Make the user name it.
 */
const openaiConfig = {
  baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  apiKey: process.env.OPENAI_API_KEY || "",
  model: process.env.OPENAI_MODEL || "",
  fastModel: process.env.OPENAI_FAST_MODEL || process.env.OPENAI_MODEL || "",
};

export function parseCommandWhitelist(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((player) => player.trim())
    .filter(Boolean);
}

export const config = {
  discord: {
    token: process.env.DISCORD_BOT_TOKEN || "",
    guildId: process.env.DISCORD_GUILD_ID || "",
    voiceChannelId: process.env.DISCORD_VOICE_CHANNEL_ID || "",
    userId: process.env.DISCORD_ALLOWED_USER_ID || "",
    sttModel: process.env.DISCORD_STT_MODEL || "openai/whisper-large-v3",
    ttsEnabled: process.env.DISCORD_TTS_ENABLED === "true",
    ttsModel: process.env.DISCORD_TTS_MODEL || "mistralai/voxtral-mini-tts-3-0",
    ttsVoice: process.env.DISCORD_TTS_VOICE || "voice_3150",
  },
  mc: {
    host: process.env.MC_HOST || "localhost",
    port: parseInt(process.env.MC_PORT || "25565"),
    username: process.env.MC_USERNAME || "AIBot",
    version: process.env.MC_VERSION || "1.21.11",
    auth: (process.env.MC_AUTH || "offline") as "offline" | "microsoft",
  },
  ollama: ollamaConfig,
  openai: openaiConfig,
  /** Resolved per provider, so call sites never branch on which backend is live. */
  llm: {
    provider: llmProvider,
    model: llmProvider === "openai" ? openaiConfig.model : ollamaConfig.model,
    fastModel: llmProvider === "openai" ? openaiConfig.fastModel : ollamaConfig.fastModel,
    maxRequestsPerRun: parseInt(process.env.LLM_MAX_REQUESTS_PER_RUN || "0"),
  },
  twitch: {
    channel: process.env.TWITCH_CHANNEL || "",
    botUsername: process.env.TWITCH_BOT_USERNAME || "",
    oauthToken: process.env.TWITCH_OAUTH_TOKEN || "",
    enabled: !!process.env.TWITCH_CHANNEL,
  },
  bot: {
    name: process.env.BOT_NAME || "Atlas",
    decisionIntervalMs: parseInt(process.env.BOT_DECISION_INTERVAL_MS || "500"),
    chatCooldownMs: parseInt(process.env.BOT_CHAT_COOLDOWN_MS || "3000"),
    /** Players allowed to control bots through in-game `!` commands. */
    commandWhitelist: parseCommandWhitelist(process.env.BOT_COMMAND_WHITELIST),
    /**
     * When false (default): NO interventions that act for the bots or hand them
     * unearned resources — deterministic skill overrides, survival rations, and
     * safety teleports are all disabled. The LLM decides everything and the
     * bots use only their own skills/navigation. Set ALLOW_INTERVENTIONS=true
     * to re-enable the scaffolding (e.g. for reliability demos).
     */
    allowInterventions: process.env.ALLOW_INTERVENTIONS === "true",
    /**
     * Deterministic strategy pushes (forcing setup_stash / build_farm /
     * strip_mine on cooldown). These choose ACTIONS; they never touch world
     * state, so they are not cheats — but they shared the interventions gate
     * and died with it, collapsing skill invocations to 22 per hour across
     * five bots while explore and eat soaked up 500+. Default ON.
     */
    allowStrategyOverrides: process.env.ALLOW_STRATEGY_OVERRIDES !== "false",
    /** Idle interval for event-driven brain — how often to re-plan when nothing happens. */
    idleIntervalMs: parseInt(process.env.BOT_IDLE_INTERVAL_MS || "10000"),
    /** Enable the critic step after each action (uses an extra LLM call per action). */
    criticEnabled: process.env.BOT_CRITIC_ENABLED !== "false",
    ttsEnabled: process.env.ENABLE_TTS !== "false",
    neuralServerEnabled: process.env.ENABLE_NEURAL_SERVER !== "false",
  },
  multiBot: {
    enabled: process.env.ENABLE_MULTI_BOT === "true",
    count: parseInt(process.env.BOT_COUNT || "1"),
  },
  generatedSkills: {
    /** Model-authored code is inert unless an operator enables its isolated runtime. */
    enabled: process.env.GENERATED_SKILLS_ENABLED === "true",
    storeDir: process.env.GENERATED_SKILLS_DIR || "",
    bwrapPath: process.env.GENERATED_SKILLS_BWRAP || "/usr/bin/bwrap",
    nodePath: process.env.GENERATED_SKILLS_NODE || process.execPath,
  },
};
