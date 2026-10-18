# 🤖 J.A.R.V.I.S.

Dein persönlicher, sprachgesteuerter KI-Assistent im Iron-Man-Stil. Läuft **kostenlos** mit Google Gemini oder Ollama, oder mit **Claude** (Anthropic).

- 🎙️ **Spracheingabe** auf Deutsch (Klick auf den Reaktor oder Leertaste)
- 🔊 **Sprachausgabe**: Jarvis liest seine Antworten vor, schon während er noch schreibt
- 🗣️ **Wake-Word-Modus**: sag einfach „Jarvis, wie spät ist es?“
- ⚡ **Live-Streaming** der Antworten
- 💾 Gesprächsverlauf bleibt im Browser gespeichert
- 🌌 Arc-Reactor-Oberfläche im Jarvis-Look

## Schritt für Schritt (kostenlos)

1. **Node.js installieren:** <https://nodejs.org> (LTS-Version), Standardeinstellungen.
2. **Kostenlosen Key holen:** <https://aistudio.google.com/apikey> mit deinem Google-Konto öffnen, auf „API-Schlüssel erstellen“ klicken und den Key kopieren. Keine Kreditkarte nötig.
3. **Jarvis herunterladen:** Oben auf dieser Seite auf den grünen Button **Code** und dann **Download ZIP**. Die ZIP entpacken.
4. **Key eintragen:** Im Ordner die Datei `.env.example` kopieren und die Kopie in `.env` umbenennen. Mit dem Editor öffnen und den Key hinter `GEMINI_API_KEY=` einfügen, speichern.
   (Die Datei ist evtl. versteckt: Windows-Explorer „Ansicht“ → „Ausgeblendete Elemente“, Mac `Cmd + Shift + .`)
5. **Terminal im Ordner öffnen:** Windows: in die Adressleiste des Ordners `cmd` tippen und Enter. Mac: Rechtsklick auf den Ordner → „Neues Terminal beim Ordner“.
6. **Installieren und starten:**
   ```bash
   npm install
   npm start
   ```
7. **Öffnen:** <http://localhost:3000> in **Chrome** oder **Edge**, Mikrofon erlauben, auf den Reaktor klicken und sprechen.

## KI-Anbieter

| Anbieter | Kosten | Was du brauchst |
|---|---|---|
| **Google Gemini** (Standard) | kostenlos (mit Nutzungslimit pro Minute/Tag) | Key von <https://aistudio.google.com/apikey> in `GEMINI_API_KEY` |
| **Ollama** | kostenlos, offline, unbegrenzt | <https://ollama.com> installieren, `ollama pull llama3.2`, in `.env` `PROVIDER=ollama` setzen. Braucht einen halbwegs starken PC. |
| **Claude** | kostenpflichtig | Key von <https://console.anthropic.com> in `ANTHROPIC_API_KEY` |

## Bedienung

| Aktion | So geht's |
|---|---|
| Sprechen | Auf den leuchtenden Reaktor klicken oder **Leertaste** drücken |
| Schreiben | Text unten eingeben und **Senden** |
| Wake-Word | Haken bei „Wake-Word Jarvis“ setzen, dann „Jarvis, …“ sagen |
| Vorlesen stoppen | **Esc** |
| Stimme wählen | Dropdown unten (zeigt die deutschen Stimmen deines Systems) |

## Einstellungen (`.env`)

| Variable | Standard | Bedeutung |
|---|---|---|
| `PROVIDER` | automatisch | `gemini`, `ollama` oder `claude` |
| `GEMINI_API_KEY` | (leer) | Kostenloser Google-Key |
| `GEMINI_MODEL` | `gemini-flash-latest` | Gemini-Modell |
| `OLLAMA_MODEL` | `llama3.2` | Lokales Modell für Ollama |
| `OLLAMA_URL` | `http://localhost:11434` | Adresse von Ollama |
| `ANTHROPIC_API_KEY` | (leer) | Claude-Key |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Claude-Modell, z. B. `claude-sonnet-5-5` |
| `PORT` | `3000` | Port des Servers |
| `USER_NAME` | `Sir` | Wie Jarvis dich anspricht |

## Projektstruktur

```
jarvis/
├── server.js        # Express-Server, spricht mit Gemini, Ollama oder Claude (Streaming)
├── public/
│   ├── index.html   # Oberfläche
│   ├── style.css    # Jarvis-Design
│   └── app.js       # Chat, Spracheingabe und Sprachausgabe
├── .env.example     # Vorlage für deine Einstellungen
└── package.json
```

## Hinweise

- Dein API-Key bleibt auf deinem Rechner (in `.env`) und wird nie an den Browser geschickt.
- Beim kostenlosen Gemini-Zugang kann Google deine Eingaben zur Verbesserung seiner Dienste nutzen. Für private Gespräche ist Ollama die bessere Wahl.
- Die Stimme hängt von deinem Betriebssystem und Browser ab. In Chrome klingen die „Google Deutsch“-Stimmen meist am besten.

## Lizenz

MIT
