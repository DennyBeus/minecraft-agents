import { Client, Events, GatewayIntentBits, type VoiceBasedChannel } from "discord.js";
import {
  AudioPlayerStatus,
  EndBehaviorType,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  type VoiceConnection,
} from "@discordjs/voice";
import prism from "prism-media";
import { spawn } from "node:child_process";
import { config } from "../config.js";

const MAX_PCM_BYTES = 48_000 * 2 * 2 * 12;
const MIN_PCM_BYTES = 48_000 * 2 * 2 * 0.35;

/** Discord sends 48 kHz stereo PCM after Opus decoding; Whisper accepts 16 kHz mono WAV. */
export function pcmToWav(pcm: Buffer): Buffer {
  const frames = Math.floor(pcm.length / 4 / 3);
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16_000, 24);
  wav.writeUInt32LE(32_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) {
    const offset = i * 12;
    const left = pcm.readInt16LE(offset);
    const right = pcm.readInt16LE(offset + 2);
    wav.writeInt16LE(Math.round((left + right) / 2), 44 + i * 2);
  }
  return wav;
}

export async function transcribeDiscordPcm(pcm: Buffer): Promise<string> {
  const response = await fetch(`${config.openai.baseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.openai.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.discord.sttModel,
      language: "ru",
      input_audio: { data: pcmToWav(pcm).toString("base64"), format: "wav" },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`OpenRouter STT: HTTP ${response.status}`);
  const result = (await response.json()) as { text?: unknown };
  if (typeof result.text !== "string") throw new Error("OpenRouter STT: missing transcript");
  return result.text.trim();
}

async function synthesize(text: string): Promise<Buffer> {
  const response = await fetch(`${config.openai.baseUrl.replace(/\/$/, "")}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.openai.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.discord.ttsModel, input: text.slice(0, 500), voice: config.discord.ttsVoice, response_format: "mp3" }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`OpenRouter TTS: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function playMp3(connection: VoiceConnection, mp3: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", ["-loglevel", "error", "-i", "pipe:0", "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1"], { stdio: ["pipe", "pipe", "pipe"] });
    const player = createAudioPlayer();
    const subscription = connection.subscribe(player);
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      subscription?.unsubscribe();
      ffmpeg.kill();
      if (error) reject(error); else resolve();
    };
    ffmpeg.on("error", finish);
    player.on("error", finish);
    player.on(AudioPlayerStatus.Idle, () => finish());
    ffmpeg.stdin.end(mp3);
    player.play(createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw }));
  });
}

export interface DiscordVoiceBridge { say(text: string): void; stop(): void }

export async function startDiscordVoiceBridge(onTranscript: (text: string) => string | void | Promise<string | void>): Promise<DiscordVoiceBridge | null> {
  const cfg = config.discord;
  if (!cfg.token || !cfg.guildId || !cfg.voiceChannelId || !cfg.userId) {
    console.log("[Discord] Voice bridge disabled; configure token, guild, voice channel and allowed user ID.");
    return null;
  }
  if (!config.openai.apiKey) throw new Error("Discord voice requires the OpenRouter API key");
  if (![cfg.guildId, cfg.voiceChannelId, cfg.userId].every((id) => /^\d{15,25}$/.test(id))) {
    throw new Error("Discord guild, channel and user IDs must be numeric IDs");
  }
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Discord login timed out")), 20_000);
    client.once(Events.ClientReady, () => { clearTimeout(timer); resolve(); });
    client.login(cfg.token).catch((error) => { clearTimeout(timer); reject(error); });
  }).catch((error) => { client.destroy(); throw new Error(`Discord gateway login failed: ${String(error)}`); });
  let connection: VoiceConnection;
  try {
    const guild = await client.guilds.fetch(cfg.guildId);
    const channel = await guild.channels.fetch(cfg.voiceChannelId);
    if (!channel?.isVoiceBased()) throw new Error("Configured Discord channel is not a voice channel");
    connection = joinVoiceChannel({ channelId: (channel as VoiceBasedChannel).id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator, selfDeaf: false });
    connection.on("error", (error) => console.warn(`[Discord] Voice connection error: ${error.message}`));
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch (error) { client.destroy(); throw new Error(`Discord voice connection failed: ${String(error)}`); }

  const playerQueue: { current: Promise<void> } = { current: Promise.resolve() };
  const say = (text: string) => {
    if (stopped || !cfg.ttsEnabled || !text.trim()) return;
    playerQueue.current = playerQueue.current.then(async () => {
      const mp3 = await synthesize(text);
      await playMp3(connection, mp3);
    }).catch((error) => console.warn(`[Discord] Voice reply failed: ${String(error)}`));
  };
  let stopped = false;
  let capturing = false;
  let processing = false;
  let lastAudioAt = Date.now();
  let lastRejoinAt = Date.now();
  let udpPackets = 0;
  let trackedUdp: { on(event: string, listener: () => void): void } | undefined;
  const trackUdp = () => {
    const state = connection.state as { networking?: { state?: { udp?: typeof trackedUdp } } };
    const udp = state.networking?.state?.udp;
    if (!udp || udp === trackedUdp) return;
    trackedUdp = udp;
    udp.on("message", () => { udpPackets++; });
  };
  trackUdp();
  connection.on("stateChange", (oldState, newState) => {
    if (oldState.status !== newState.status) console.log(`[Discord] Voice connection: ${oldState.status} -> ${newState.status}`);
    trackUdp();
  });
  const receiveWatchdog = setInterval(() => {
    if (stopped) return;
    const operatorPresent = client.guilds.cache.get(cfg.guildId)?.voiceStates.cache.get(cfg.userId)?.channelId === cfg.voiceChannelId;
    trackUdp();
    if (operatorPresent) {
      const mapped = Boolean(connection.receiver.ssrcMap.get(cfg.userId));
      console.log(`[Discord] Receive status: ${connection.state.status}, UDP packets: ${udpPackets}, operator SSRC: ${mapped}`);
    }
    if (!operatorPresent || Date.now() - lastAudioAt < 120_000 || Date.now() - lastRejoinAt < 120_000) return;
    lastRejoinAt = Date.now();
    console.warn(`[Discord] No incoming audio for 2 minutes while operator is present; refreshing voice connection`);
    connection.rejoin();
  }, 30_000);
  const pending: Buffer[] = [];
  const processQueue = async () => {
    if (processing) return;
    processing = true;
    while (pending.length) {
      try {
        const text = await transcribeDiscordPcm(pending.shift()!);
        if (stopped) break;
        if (!text) continue;
        console.log(`[Discord] ${cfg.userId}: ${text}`);
        const reply = await onTranscript(text);
        say(reply || "Слышу вас. Передаю задание Атласу.");
      } catch (error) { console.warn(`[Discord] Transcription failed: ${String(error)}`); }
    }
    processing = false;
  };
  connection.receiver.speaking.on("start", (userId) => {
    if (stopped || userId !== cfg.userId || capturing) return;
    lastAudioAt = Date.now();
    capturing = true;
    const opus = connection.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 800 } });
    const decoder = new prism.opus.Decoder({ rate: 48_000, channels: 2, frameSize: 960 });
    const chunks: Buffer[] = [];
    let bytes = 0;
    opus.pipe(decoder);
    decoder.on("data", (chunk: Buffer) => {
      if (bytes + chunk.length > MAX_PCM_BYTES) { opus.destroy(); return; }
      chunks.push(chunk);
      bytes += chunk.length;
    });
    decoder.on("error", (error) => { capturing = false; console.warn(`[Discord] Decode error: ${error.message}`); });
    decoder.on("end", () => {
      capturing = false;
      if (bytes < MIN_PCM_BYTES || pending.length >= 3) return;
      console.log(`[Discord] Captured ${(bytes / 192_000).toFixed(1)}s of speech; transcribing`);
      pending.push(Buffer.concat(chunks, bytes));
      void processQueue();
    });
  });
  console.log(`[Discord] Listening in voice channel ${cfg.voiceChannelId} for user ${cfg.userId}`);
  return { say, stop: () => { if (stopped) return; stopped = true; clearInterval(receiveWatchdog); pending.length = 0; connection.destroy(); client.destroy(); } };
}
