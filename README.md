# 🤖 J.A.R.V.I.S.

Dein persönlicher, sprachgesteuerter KI-Assistent im Iron-Man-Stil, angetrieben von **Claude** (Anthropic).

- 🎙️ **Spracheingabe** auf Deutsch (Klick auf den Reaktor oder Leertaste)
- 🔊 **Sprachausgabe**: Jarvis liest seine Antworten vor, schon während er noch schreibt
- 🗣️ **Wake-Word-Modus**: sag einfach „Jarvis, wie spät ist es?“
- ⚡ **Live-Streaming** der Antworten
- 💾 Gesprächsverlauf bleibt im Browser gespeichert
- 🌌 Arc-Reactor-Oberfläche im Jarvis-Look

## Voraussetzungen

- [Node.js](https://nodejs.org) Version 18 oder neuer
- Ein Anthropic API-Key: <https://console.anthropic.com/settings/keys>
- Für Spracheingabe: **Google Chrome** oder **Microsoft Edge** (Firefox unterstützt keine Spracherkennung)

## Installation

```bash
git clone https://github.com/danielabrhe15-jpg/jarvis.git
cd jarvis
npm install
```

Dann die Konfigurationsdatei anlegen:

```bash
# macOS / Linux
cp .env.example .env
# Windows (PowerShell)
copy .env.example .env
```

Öffne `.env` und trage deinen API-Key ein:

```
ANTHROPIC_API_KEY=sk-ant-dein-key
```

## Starten

```bash
npm start
```

Öffne danach **<http://localhost:3000>** im Browser und erlaube den Mikrofonzugriff.

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
| `ANTHROPIC_API_KEY` | (leer) | Dein API-Key (Pflicht) |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Claude-Modell, z. B. `claude-sonnet-5-5` (schneller, günstiger) oder `claude-haiku-5-5` |
| `PORT` | `3000` | Port des Servers |
| `USER_NAME` | `Sir` | Wie Jarvis dich anspricht |

## Projektstruktur

```
jarvis/
├── server.js        # Express-Server, spricht mit der Claude API (Streaming)
├── public/
│   ├── index.html   # Oberfläche
│   ├── style.css    # Jarvis-Design
│   └── app.js       # Chat, Spracheingabe und Sprachausgabe
├── .env.example     # Vorlage für deine Einstellungen
└── package.json
```

## Hinweise

- Dein API-Key bleibt auf deinem Rechner (in `.env`) und wird nie an den Browser geschickt.
- Die API-Nutzung kostet je nach Modell Geld, siehe <https://www.anthropic.com/pricing>.
- Die Stimme hängt von deinem Betriebssystem und Browser ab. In Chrome klingen die „Google Deutsch“-Stimmen meist am besten.

## Lizenz

MIT
