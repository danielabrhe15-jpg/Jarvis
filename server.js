import "dotenv/config";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const USER_NAME = process.env.USER_NAME || "Sir";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("\n❌ ANTHROPIC_API_KEY fehlt. Kopiere .env.example nach .env und trage deinen Key ein.\n");
  process.exit(1);
}

const client = new Anthropic();
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

app.get("/api/health", (_req, res) => res.json({ ok: true, model: MODEL }));

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

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 2048,
    system: systemPrompt(),
    messages,
  });

  res.on("close", () => stream.abort());

  try {
    stream.on("text", (text) => send("delta", { text }));
    await stream.finalMessage();
    send("done", {});
  } catch (err) {
    if (!res.writableEnded) {
      console.error("Claude-Fehler:", err?.message || err);
      send("error", { message: err?.status === 401 ? "Ungültiger API-Key." : (err?.message || "Unbekannter Fehler") });
    }
  } finally {
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`\n🤖 J.A.R.V.I.S. ist online: http://localhost:${PORT}  (Modell: ${MODEL})\n`);
});
