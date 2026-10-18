import "dotenv/config";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const USER_NAME = process.env.USER_NAME || "Sir";

// Anbieter wählen: gemini (kostenlos), ollama (kostenlos, offline) oder claude (kostenpflichtig).
// Ohne PROVIDER wird automatisch der Anbieter genommen, für den ein Key eingetragen ist.
const PROVIDER = (
  process.env.PROVIDER ||
  (process.env.GEMINI_API_KEY ? "gemini" : process.env.ANTHROPIC_API_KEY ? "claude" : "gemini")
).toLowerCase();

const MODELS = {
  gemini: process.env.GEMINI_MODEL || "gemini-flash-lite-latest",
  claude: process.env.CLAUDE_MODEL || "claude-opus-5-5",
  ollama: process.env.OLLAMA_MODEL || "llama3.2",
};
const MODEL = MODELS[PROVIDER];
const OLLAMA_URL = (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/$/, "");

if (!MODEL) {
  console.error(`\n❌ Unbekannter PROVIDER "${PROVIDER}". Erlaubt: gemini, ollama, claude.\n`);
  process.exit(1);
}
if (PROVIDER === "gemini" && !process.env.GEMINI_API_KEY) {
  console.error("\n❌ GEMINI_API_KEY fehlt. Hol dir kostenlos einen unter https://aistudio.google.com/apikey und trag ihn in .env ein.\n");
  process.exit(1);
}
if (PROVIDER === "claude" && !process.env.ANTHROPIC_API_KEY) {
  console.error("\n❌ ANTHROPIC_API_KEY fehlt. Trag deinen Key in .env ein.\n");
  process.exit(1);
}

const anthropic = PROVIDER === "claude" ? new Anthropic() : null;
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function systemPrompt() {
  const now = new Date().toLocaleString("de-DE", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: process.env.TZ || "Europe/Berlin",
  });
  return `Du bist J.A.R.V.I.S. (Just A Rather Very Intelligent System), der persönliche KI-Assistent von ${USER_NAME}, im Stil des Assistenten aus Iron Man.
Persönlichkeit: höflich, loyal, ruhig, präzise, mit trockenem britischem Humor. Du sprichst den Nutzer mit "${USER_NAME}" an.
Deine Antworten werden laut vorgelesen. Halte dich deshalb kurz (meist 1 bis 3 Sätze), es sei denn, es wird ausdrücklich mehr verlangt.
Verwende keine Markdown-Formatierung, keine Aufzählungszeichen, keine Emojis und keine Codeblöcke, außer der Nutzer bittet ausdrücklich um Code.
Antworte in der Sprache, in der du angesprochen wirst (standardmäßig Deutsch).
Aktuelles Datum und Uhrzeit: ${now}.`;
}

// Nachrichten säubern: nur user/assistant mit Text, maximal die letzten 40
function sanitize(messages) {
  if (!Array.isArray(messages)) return [];
  const clean = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, 20000) }))
    .slice(-40);
  while (clean.length && clean[0].role !== "user") clean.shift();
  return clean;
}

// Liest einen Antwort-Stream Zeile für Zeile
async function* lines(body) {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      yield buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
    }
  }
  if (buf.trim()) yield buf.trim();
}

class ProviderError extends Error {}

// ---------- Anbieter: jeder liefert Textstücke ----------
async function* streamClaude(messages, signal) {
  const stream = anthropic.messages.stream(
    { model: MODEL, max_tokens: 2048, system: systemPrompt(), messages },
    { signal },
  );
  try {
    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") yield ev.delta.text;
    }
  } catch (err) {
    if (err?.status === 401) throw new ProviderError("Ungültiger Anthropic API-Key.");
    throw err;
  }
}

async function* streamGemini(messages, signal) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:streamGenerateContent?alt=sse`;
  const request = (fast) =>
    fetch(url, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt() }] },
        contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        // "Nachdenken" aus: Jarvis antwortet dadurch deutlich schneller
        generationConfig: { maxOutputTokens: 2048, ...(fast && { thinkingConfig: { thinkingBudget: 0 } }) },
      }),
    });
  let res = await request(true);
  // Manche Modelle erlauben das Abschalten nicht, dann ohne erneut versuchen
  if (res.status === 400) {
    const text = await res.clone().text();
    if (!/api key/i.test(text)) res = await request(false);
  }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    const msg = j?.error?.message || `HTTP ${res.status}`;
    if (res.status === 400 && /api key/i.test(msg)) throw new ProviderError("Ungültiger Gemini API-Key.");
    if (res.status === 429) throw new ProviderError("Kostenloses Gemini-Limit kurz erreicht. Warte eine Minute und versuch es nochmal.");
    if (res.status === 404) throw new ProviderError(`Gemini-Modell "${MODEL}" nicht gefunden. Setze GEMINI_MODEL in .env auf ein anderes Modell.`);
    throw new ProviderError(`Gemini-Fehler: ${msg}`);
  }
  for await (const line of lines(res.body)) {
    if (!line.startsWith("data:")) continue;
    const data = JSON.parse(line.slice(5));
    for (const part of data?.candidates?.[0]?.content?.parts || []) {
      if (part.text && !part.thought) yield part.text;
    }
  }
}

async function* streamOllama(messages, signal) {
  let res;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        messages: [{ role: "system", content: systemPrompt() }, ...messages],
      }),
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new ProviderError("Ollama läuft nicht. Installiere es von https://ollama.com und starte es.");
  }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    if (res.status === 404) throw new ProviderError(`Modell "${MODEL}" fehlt. Führe einmal "ollama pull ${MODEL}" aus.`);
    throw new ProviderError(`Ollama-Fehler: ${j.error || res.status}`);
  }
  for await (const line of lines(res.body)) {
    if (!line) continue;
    const data = JSON.parse(line);
    if (data.error) throw new ProviderError(`Ollama-Fehler: ${data.error}`);
    if (data.message?.content) yield data.message.content;
  }
}

const providers = { claude: streamClaude, gemini: streamGemini, ollama: streamOllama };

// Optional: natürlichere Stimme über Fish Audio (https://fish.audio), sonst liest der Browser vor
const FISH = process.env.FISH_API_KEY
  ? { model: process.env.FISH_MODEL || "s2.1-pro-free", voice: process.env.FISH_VOICE_ID || null }
  : null;

app.get("/api/health", (_req, res) => res.json({ ok: true, provider: PROVIDER, model: MODEL, tts: FISH ? "fish" : "browser" }));

// GET erlaubt dem Browser, das Audio schon abzuspielen, während es noch lädt
app.get("/api/tts", (req, res) => tts(String(req.query.text || ""), res));
app.post("/api/tts", (req, res) => tts(typeof req.body?.text === "string" ? req.body.text : "", res));

async function tts(rawText, res) {
  const text = rawText.trim().slice(0, 2000);
  if (!FISH) return res.status(404).json({ error: "Fish Audio ist nicht eingerichtet (FISH_API_KEY fehlt in .env)." });
  if (!text) return res.status(400).json({ error: "Kein Text." });

  const controller = new AbortController();
  res.on("close", () => controller.abort());
  try {
    const r = await fetch("https://api.fish.audio/v1/tts", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.FISH_API_KEY}`, model: FISH.model },
      body: JSON.stringify({ text, reference_id: FISH.voice, format: "mp3", latency: "balanced", language: "de" }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      const msg =
        r.status === 401 ? "Ungültiger Fish-Audio-Key." :
        r.status === 402 ? "Fish-Audio-Guthaben aufgebraucht." :
        `Fish-Audio-Fehler: ${j.message || r.status}`;
      console.error(msg);
      return res.status(502).json({ error: msg });
    }
    res.setHeader("Content-Type", "audio/mpeg");
    for await (const chunk of r.body) res.write(chunk);
    res.end();
  } catch (err) {
    if (!controller.signal.aborted) {
      console.error("Fish-Audio-Fehler:", err?.message || err);
      if (!res.headersSent) res.status(502).json({ error: "Fish Audio nicht erreichbar." });
      else res.end();
    }
  }
}

// Diagnose: Mikrofon-Ereignisse aus dem Browser im Terminal anzeigen
app.post("/api/debug", (req, res) => {
  const { event = "", detail = "" } = req.body || {};
  console.log(`[Mikrofon] ${new Date().toLocaleTimeString("de-DE")} ${String(event).slice(0, 40)} ${String(detail).slice(0, 300)}`);
  res.json({ ok: true });
});

app.post("/api/chat", async (req, res) => {
  const messages = sanitize(req.body?.messages);
  if (!messages.length || messages.at(-1).role !== "user") {
    return res.status(400).json({ error: "Keine gültige Nachricht erhalten." });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const controller = new AbortController();
  res.on("close", () => controller.abort());

  try {
    for await (const text of providers[PROVIDER](messages, controller.signal)) send("delta", { text });
    send("done", {});
  } catch (err) {
    if (!controller.signal.aborted) {
      console.error("Fehler:", err?.message || err);
      send("error", { message: err instanceof ProviderError ? err.message : (err?.message || "Unbekannter Fehler") });
    }
  } finally {
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`\n🤖 J.A.R.V.I.S. ist online: http://localhost:${PORT}  (Anbieter: ${PROVIDER}, Modell: ${MODEL})\n`);
});
