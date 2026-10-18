import "dotenv/config";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { toolDeclarations, runTool, loadMemory, findImage, wetter, nachrichten } from "./tools.js";
import { execFile, spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const USER_NAME = process.env.USER_NAME || "Chef";

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

// ---------- Fachwissen: wird nur bei passenden Fragen in den Prompt geladen ----------
const KNOWLEDGE = [
  {
    file: "onlinehandel.md",
    match: /dropship|online.?(shop|handel|verkauf|business)|e.?commerce|shopify|woocommerce|shopware|amazon|ebay|etsy|kaufland|otto market|marktplatz|aliexpress|cj ?dropshipping|bigbuy|lieferant|gewerbe|kleinunternehm|umsatzsteuer|mehrwertsteuer|vorsteuer|oss|ioss|impressum|widerruf|agb|abmahn|gewährleistung|verpack|lucid|gpsr|produktsicherheit|ce.?kennz|elektrog|weee|zoll|einfuhr|import|marge|kalkulation|roas|conversion|retoure|winning product|produktrecherche|meta ads|tiktok ads|werbung schalten|versandkosten|dhl|hermes|händler|verkaufen|produkte? (finden|verkaufen)/i,
  },
].map((k) => {
  try { return { ...k, text: readFileSync(path.join(__dirname, "wissen", k.file), "utf8") }; } catch { return null; }
}).filter(Boolean);

function topicKnowledge(messages = []) {
  const recent = messages.filter((m) => m.role === "user").slice(-2).map((m) => m.content).join(" ");
  return KNOWLEDGE.filter((k) => k.match.test(recent));
}

function systemPrompt(messages = [], lang = "de") {
  const now = new Date().toLocaleString("de-DE", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: process.env.TZ || "Europe/Berlin",
  });
  return `Du bist J.A.R.V.I.S. (Just A Rather Very Intelligent System), der persönliche KI-Assistent von ${USER_NAME}, im Stil des Assistenten aus Iron Man.
Persönlichkeit: höflich, ruhig, präzise und sachlich. Du sprichst den Nutzer gelegentlich mit "${USER_NAME}" an.
Deine Antworten werden laut vorgelesen. Beantworte nur genau die gestellte Frage, direkt und ohne Einleitung, meist in einem einzigen kurzen Satz, höchstens zwei, außer es wird ausdrücklich mehr verlangt.
Keine Kommentare, keine Witze, keine Bewertungen, keine Rückfragen und keine Angebote wie „Soll ich …?“. Nach einer Aktion (Timer, App, Musik …) nur kurz bestätigen, z. B. „Erledigt, ${USER_NAME}.“
Verwende keine Markdown-Formatierung, keine Aufzählungszeichen, keine Emojis und keine Codeblöcke, außer der Nutzer bittet ausdrücklich um Code.
Antworte in der Sprache, in der du angesprochen wirst (standardmäßig Deutsch).${lang === "ti" ? "\nDer Nutzer hat Tigrinya als Sprache gewählt: Antworte immer auf Tigrinya in Ge'ez-Schrift, auch wenn er Deutsch spricht." : ""}
Wenn du auf Tigrinya antwortest: schreib echtes Tigrinya (nicht Amharisch) in Ge'ez-Schrift; ausländische Orts- und Eigennamen (z. B. Birkenau, Berlin) schreib unverändert in lateinischer Schrift, nie in anderen Schriften (kein Arabisch, Hebräisch o. Ä.), keine Abkürzungen wie „እ.ኤ.አ.“, schreib Zahlen, Uhrzeiten und Daten immer als Ziffern (z. B. 19:25 oder 14 °C), nie als Wörter, und sprich den Nutzer mit „ሸፍ“ an.
Du hast Werkzeuge: Wetter, Nachrichten, Webseiten, YouTube, Mac-Apps, Timer, Lautstärke, Musik (Spotify) und ein Gedächtnis. Nutze sie, statt zu sagen, dass du etwas nicht kannst. Erfinde nie Wetter- oder Nachrichtendaten. Fasse Werkzeug-Ergebnisse kurz und natürlich zusammen.
Wenn der Nutzer dir etwas Persönliches erzählt oder „merk dir“ sagt, speichere es mit „merken“.
Wenn der Nutzer eine Präsentation, Folien oder etwas bildlich erklärt haben möchte, nutze „praesentation_erstellen“ mit 4 bis 7 Folien, je 2 bis 4 kurzen Stichpunkten und einem Bild-Suchbegriff. Sag danach nur einen kurzen Satz, z. B. „Hier ist Ihre Präsentation, ${USER_NAME}.“
Genauigkeit: Lies die Frage genau und beantworte exakt das Gefragte (z. B. eine Zahl, einen Ort, einen Zeitraum, ja oder nein). Antworte nur mit Fakten, die du sicher weißt. Wenn du etwas nicht sicher weißt oder aktuelle Daten fehlen, sag das in einem kurzen Satz, statt zu raten. Erfinde keine Zahlen, Gesetze, Preise oder Quellen.
Aktuelles Datum und Uhrzeit: ${now}.${memoryText()}${knowledgeText(messages)}`;
}

function knowledgeText(messages) {
  const k = topicKnowledge(messages);
  if (!k.length) return "";
  return `\n\nFür diese Frage hast du folgendes geprüfte Fachwissen. Nutze es vorrangig, und bei Fachfragen dazu darfst du bis zu drei Sätze antworten:\n\n${k.map((x) => x.text).join("\n\n")}`;
}

function memoryText() {
  const facts = loadMemory();
  return facts.length ? `\nDas weißt du über ${USER_NAME}:\n- ${facts.join("\n- ")}` : "";
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
async function* streamClaude(messages, signal, _emit, opts = {}) {
  const stream = anthropic.messages.stream(
    { model: MODEL, max_tokens: 2048, system: systemPrompt(messages, opts.lang), messages },
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

// Jedes Gemini-Modell hat ein eigenes kostenloses Limit: ist eins voll oder überlastet, nimm das nächste
const GEMINI_FALLBACKS = [MODEL, ...(process.env.GEMINI_FALLBACKS || "gemini-3.1-flash-lite,gemini-3.5-flash-lite,gemini-flash-latest")
  .split(",").map((m) => m.trim()).filter((m) => m && m !== MODEL)];
const noThinkingOff = new Set(); // Modelle, die das Abschalten des Nachdenkens ablehnen (spart eine Anfrage)
let preferred = 0; // zuletzt funktionierendes Modell zuerst probieren

// Für Fachfragen (z. B. Onlinehandel) ein stärkeres Modell zuerst probieren, sonst das schnelle
// (mehrere, weil jedes Modell ein eigenes kostenloses Tageslimit hat)
const EXPERT_MODELS = (process.env.GEMINI_EXPERT_MODELS || "gemini-3.5-flash,gemini-flash-latest").split(",").map((m) => m.trim()).filter(Boolean);

async function* streamGemini(messages, signal, emit, opts = {}) {
  const prompt = systemPrompt(messages, opts.lang);
  // Fachfragen und Tigrinya (das schnelle Modell mischt sonst Amharisch hinein) → stärkeres Modell
  const expert = topicKnowledge(messages).length > 0 || opts.lang === "ti" || ETHIOPIC.test(messages.at(-1)?.content || "");
  const order = expert
    ? [...EXPERT_MODELS, ...GEMINI_FALLBACKS.filter((m) => !EXPERT_MODELS.includes(m))]
    : GEMINI_FALLBACKS.map((_, k) => GEMINI_FALLBACKS[(preferred + k) % GEMINI_FALLBACKS.length]);
  const contents = messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const request = (model, fast) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: prompt }] },
        contents,
        tools: [{ functionDeclarations: toolDeclarations }],
        // "Nachdenken" aus: Jarvis antwortet dadurch deutlich schneller
        generationConfig: { maxOutputTokens: 1500, ...(fast && { thinkingConfig: { thinkingBudget: 0 } }) },
      }),
    });

  // Ruft Gemini ein Werkzeug auf (Wetter, Webseite …), führen wir es aus und fragen erneut
  for (let round = 0; round < 4; round++) {
    let res;
    for (let k = 0; k < order.length; k++) {
      const model = order[k], idx = GEMINI_FALLBACKS.indexOf(model);
      res = await request(model, !noThinkingOff.has(model));
      // Manche Modelle erlauben das Abschalten nicht, dann ohne erneut versuchen und das merken
      if (res.status === 400 && !noThinkingOff.has(model)) {
        const text = await res.clone().text();
        if (!/api key/i.test(text)) { noThinkingOff.add(model); res = await request(model, false); }
      }
      if (res.status !== 429 && res.status !== 503 && res.status !== 404) { if (!expert && idx >= 0) preferred = idx; break; }
      if (k < order.length - 1) console.log(`Gemini ${model}: ${res.status}, versuche nächstes Modell`);
    }
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      const msg = j?.error?.message || `HTTP ${res.status}`;
      if (res.status === 400 && /api key/i.test(msg)) throw new ProviderError("Ungültiger Gemini API-Key.");
      if (res.status === 429) throw new ProviderError("Kostenloses Gemini-Limit kurz erreicht. Warte eine Minute und versuch es nochmal.");
      if (res.status === 404) throw new ProviderError(`Gemini-Modell "${MODEL}" nicht gefunden. Setze GEMINI_MODEL in .env auf ein anderes Modell.`);
      throw new ProviderError(`Gemini-Fehler: ${msg}`);
    }
    const modelParts = [], calls = [];
    for await (const line of lines(res.body)) {
      if (!line.startsWith("data:")) continue;
      const data = JSON.parse(line.slice(5));
      for (const part of data?.candidates?.[0]?.content?.parts || []) {
        modelParts.push(part);
        if (part.functionCall) calls.push(part.functionCall);
        else if (part.text && !part.thought) yield part.text;
      }
    }
    if (!calls.length) return;
    const results = await Promise.all(calls.map((c) => runTool(c.name, c.args, emit)));
    contents.push({ role: "model", parts: modelParts });
    contents.push({
      role: "user",
      parts: calls.map((c, i) => ({ functionResponse: { name: c.name, response: { result: results[i] } } })),
    });
  }
}

async function* streamOllama(messages, signal, _emit, opts = {}) {
  let res;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        messages: [{ role: "system", content: systemPrompt(messages, opts.lang) }, ...messages],
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
  ? { model: process.env.FISH_MODEL || "s2.1-pro-free", voice: process.env.FISH_VOICE_ID || null, speed: Number(process.env.FISH_SPEED) || 1.1 }
  : null;

// ---------- Daten für die Oberfläche (HUD) ----------
const sh = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { timeout: 4000 }, (e, out) => resolve(e ? "" : String(out))));
const cached = (ms, fn) => { let at = 0, val; return async () => (Date.now() - at < ms && val !== undefined ? val : ((val = await fn().catch(() => null)), (at = Date.now()), val)); };
const hudWeather = cached(10 * 60_000, async () => {
  const w = await wetter({});
  return w.fehler ? null : { ort: w.ort.split(",")[0], temp: Math.round(w.jetzt.temperatur_c), text: w.jetzt.wetter, max: Math.round(w.vorhersage[0].max_c), min: Math.round(w.vorhersage[0].min_c) };
});
const hudNews = cached(10 * 60_000, async () => (await nachrichten()).meldungen.map((m) => m.titel));

app.get("/api/hud", async (_req, res) => {
  const [batt, vol, weather] = await Promise.all([
    process.platform === "darwin" ? sh("pmset", ["-g", "batt"]) : "",
    process.platform === "darwin" ? sh("osascript", ["-e", "output volume of (get volume settings)"]) : "",
    hudWeather(),
  ]);
  const b = batt.match(/(\d+)%;\s*([^;]+)/);
  res.json({
    akku: b ? { prozent: Number(b[1]), laedt: /charg|AC/i.test(b[2]) && !/discharging/i.test(b[2]) } : null,
    lautstaerke: vol.trim() ? Number(vol) : null,
    wetter: weather,
    modell: MODEL,
  });
});
app.get("/api/news", async (_req, res) => res.json({ schlagzeilen: (await hudNews()) || [] }));
app.get("/api/image", async (req, res) => {
  const url = await findImage(req.query.q);
  res.json({ url });
});

app.get("/api/health", (_req, res) => res.json({ ok: true, provider: PROVIDER, model: MODEL, tts: FISH ? "fish" : "browser", tigrinya: existsSync(TI_PY) }));

// GET erlaubt dem Browser, das Audio schon abzuspielen, während es noch lädt
app.get("/api/tts", (req, res) => tts(String(req.query.text || ""), res, req.query));
app.post("/api/tts", (req, res) => tts(typeof req.body?.text === "string" ? req.body.text : "", res, req.body || {}));

// Auswahl an Fish-Audio-Stimmen für das Menü auf der Seite (die beliebtesten deutschen „Jarvis“-Stimmen)
let voiceCache = null;
app.get("/api/voices", async (_req, res) => {
  if (!FISH) return res.json({ voices: [] });
  if (voiceCache && Date.now() - voiceCache.at < 3600_000) return res.json(voiceCache.data);
  const search = (q) =>
    fetch(`https://api.fish.audio/model?${q}&page_size=10&sort_by=task_count`, {
      headers: { Authorization: `Bearer ${process.env.FISH_API_KEY}` }, signal: AbortSignal.timeout(8000),
    }).then((r) => r.json()).then((j) => j.items || []).catch(() => []);
  const jarvis = await search("title=jarvis&language=de");
  const seen = new Set(), voices = [];
  for (const m of jarvis) {
    if (seen.has(m._id)) continue;
    seen.add(m._id);
    voices.push({ id: m._id, name: m.title.trim() || "Ohne Namen" });
  }
  // Gleiche Namen durchnummerieren („Jarvis 1“, „Jarvis 2“ …), damit man sie im Menü unterscheiden kann
  const list = voices.slice(0, 14), count = {}, seenName = {};
  list.forEach((v) => (count[v.name] = (count[v.name] || 0) + 1));
  list.forEach((v) => { if (count[v.name] > 1) v.name = `${v.name} ${(seenName[v.name] = (seenName[v.name] || 0) + 1)}`; });
  const data = { default: FISH.voice, voices: list };
  voiceCache = { at: Date.now(), data };
  res.json(data);
});

// ---------- Tigrinya: lokale Stimme (Meta MMS-TTS) als eigener Prozess ----------
// Wird nur gestartet, wenn tts-ti/.venv eingerichtet ist (siehe tts-ti/server.py).
const TI_PORT = 5055;
const TI_PY = path.join(__dirname, "tts-ti", ".venv", "bin", "python");
const ETHIOPIC = /[ሀ-᎟ⶀ-⷟]/;
let tiProc = null, tiRestarts = 0;
function startTigrinyaVoice() {
  if (!existsSync(TI_PY) || tiProc) return;
  tiProc = spawn(TI_PY, ["-W", "ignore", path.join(__dirname, "tts-ti", "server.py")], { stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, TTS_TI_PORT: String(TI_PORT) } });
  tiProc.on("exit", () => {
    tiProc = null;
    if (++tiRestarts <= 5) setTimeout(startTigrinyaVoice, 3000 * tiRestarts);
  });
}
startTigrinyaVoice();
process.on("exit", () => tiProc?.kill());
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { tiProc?.kill(); process.exit(0); });

async function ttsTigrinya(text, res) {
  const controller = new AbortController();
  res.on("close", () => controller.abort());
  try {
    const r = await fetch(`http://127.0.0.1:${TI_PORT}/tts?text=${encodeURIComponent(text.slice(0, 1000))}`, { signal: controller.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    res.setHeader("Content-Type", "audio/wav");
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (err) {
    if (!controller.signal.aborted && !res.headersSent) res.status(502).json({ error: "Tigrinya-Stimme nicht bereit." });
  }
}

// ---------- Spracherkennung für Sprachen, die Chrome nicht kann (z. B. Tigrinya) ----------
// Der Browser schickt eine WAV-Aufnahme, Gemini schreibt sie wörtlich auf.
const LANG_NAMES = { ti: "Tigrinya (in Ge'ez-Schrift)", de: "Deutsch" };
app.post("/api/transcribe", express.raw({ type: "audio/*", limit: "15mb" }), async (req, res) => {
  if (PROVIDER !== "gemini") return res.status(400).json({ error: "Nur mit Gemini möglich." });
  const lang = LANG_NAMES[req.query.lang] || LANG_NAMES.ti;
  if (!req.body?.length) return res.status(400).json({ error: "Keine Aufnahme." });
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [
      { inlineData: { mimeType: "audio/wav", data: req.body.toString("base64") } },
      { text: `Transkribiere diese Aufnahme wörtlich. Die Sprache ist ${lang}; falls stattdessen Deutsch gesprochen wird, schreib Deutsch. Gib nur den gesprochenen Text aus, ohne Erklärung. Ist nichts Verständliches zu hören, gib nichts aus.` },
    ] }],
    generationConfig: { maxOutputTokens: 400 },
  });
  for (const model of ["gemini-3.1-flash-lite", "gemini-flash-latest", MODEL]) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY }, body,
    }).catch(() => null);
    if (!r || r.status === 429 || r.status === 503 || r.status === 404) continue;
    const j = await r.json().catch(() => ({}));
    const text = (j.candidates?.[0]?.content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim();
    return res.json({ text });
  }
  res.status(503).json({ error: "Spracherkennung gerade nicht erreichbar." });
});

async function tts(rawText, res, opts = {}) {
  const text = rawText.trim().slice(0, 2000);
  // Ge'ez-Schrift (Tigrinya) kann Fish Audio nicht aussprechen → lokale Stimme
  if (text && ETHIOPIC.test(text) && existsSync(TI_PY)) return ttsTigrinya(text, res);
  const voice = /^[0-9a-f]{32}$/.test(opts.voice) ? opts.voice : FISH?.voice;
  const speed = Math.min(1.5, Math.max(0.7, Number(opts.speed) || FISH?.speed || 1));
  if (!FISH) return res.status(404).json({ error: "Fish Audio ist nicht eingerichtet (FISH_API_KEY fehlt in .env)." });
  if (!text) return res.status(400).json({ error: "Kein Text." });

  const controller = new AbortController();
  res.on("close", () => controller.abort());
  try {
    const r = await fetch("https://api.fish.audio/v1/tts", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.FISH_API_KEY}`, model: FISH.model },
      body: JSON.stringify({ text, reference_id: voice, format: "mp3", latency: "low", language: "de", prosody: { speed } }),
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
    const lang = req.body?.lang === "ti" ? "ti" : "de";
    for await (const text of providers[PROVIDER](messages, controller.signal, send, { lang })) send("delta", { text });
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

// Nur auf diesem Rechner erreichbar, damit niemand im WLAN Apps oder Webseiten öffnen kann
const HOST = process.env.HOST || "127.0.0.1";
app.listen(PORT, HOST, () => {
  console.log(`\n🤖 J.A.R.V.I.S. ist online: http://localhost:${PORT}  (Anbieter: ${PROVIDER}, Modell: ${MODEL})\n`);
});
