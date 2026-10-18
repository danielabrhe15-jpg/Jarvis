# 🤖 J.A.R.V.I.S.

Dein persönlicher, sprachgesteuerter KI-Assistent im Iron-Man-Stil. Läuft **kostenlos** mit Google Gemini oder Ollama, oder mit **Claude** (Anthropic).

- 🎙️ **Spracheingabe** auf Deutsch (Klick auf den Reaktor oder Leertaste)
- 🔊 **Sprachausgabe**: Jarvis liest seine Antworten vor, schon während er noch schreibt
- 🗣️ **„Jarvis“**: hört automatisch zu, ohne Klick. Sag einfach „Jarvis, wie spät ist es?“ oder „Wie spät ist es, Jarvis?“
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

## Was Jarvis kann

| Sag zum Beispiel | Was passiert |
|---|---|
| „Jarvis, wie wird das Wetter morgen in Berlin?“ | Aktuelle Vorhersage (Open-Meteo) |
| „Was gibt's Neues?“ | Schlagzeilen von tagesschau.de |
| „Stell einen Timer auf 5 Minuten für Nudeln.“ | Timer mit Ton und Ansage |
| „Öffne YouTube“ / „Such bei Google nach …“ | Öffnet die Seite im Browser |
| „Spiel Musik von Drake auf YouTube“ | Öffnet die YouTube-Suche |
| „Öffne Spotify“ / „Öffne Notizen“ | Öffnet eine installierte Mac-App |
| „Merk dir, dass ich am 5. März Geburtstag habe.“ | Jarvis merkt sich das dauerhaft (in `memory.json`, nur auf deinem Rechner) |
| „Mach lauter“ / „Lautstärke auf 30 Prozent“ | Ändert die Mac-Lautstärke |
| „Spiel Musik“ / „Nächstes Lied“ | Steuert Spotify oder Apple Musik |
| „Stopp“ / „Ruhe“ (während er spricht) | Jarvis ist sofort still |

Jarvis reagiert nur, wenn du seinen Namen sagst, damit er nicht in Gespräche hineinredet. Wetter und Nachrichten brauchen keinen eigenen Key. Werkzeuge gibt es derzeit mit Gemini.

## Natürlichere Stimme mit Fish Audio (optional)

Trag in `.env` deinen Key von <https://fish.audio/app/api-keys> als `FISH_API_KEY` ein und als `FISH_VOICE_ID` die ID einer Stimme (das Ende der Adresse `fish.audio/m/…`). Ohne Fish Audio oder wenn das Guthaben leer ist, liest der Browser vor.

Mit Fish Audio gibt es unten auf der Seite ein Stimmen-Menü (deutsche Jarvis-Stimmen, mit Probesatz) und ein Tempo-Menü. Die Auswahl merkt sich der Browser. Das Standard-Tempo stellst du mit `FISH_SPEED` ein.

## Bedienung

| Aktion | So geht's |
|---|---|
| Sprechen | Auf den leuchtenden Reaktor klicken oder **Leertaste** drücken |
| Schreiben | Text unten eingeben und **Senden** |
| Jarvis rufen | Einfach „Jarvis, …“ sagen, Jarvis hört automatisch zu, sobald die Seite offen ist (abschaltbar unten per Haken) |
| Vorlesen stoppen | **Esc** |
| Stimme und Tempo | Menüs unten (mit Fish Audio die Fish-Stimmen, sonst die deutschen Stimmen deines Systems) |

## Einstellungen (`.env`)

| Variable | Standard | Bedeutung |
|---|---|---|
| `PROVIDER` | automatisch | `gemini`, `ollama` oder `claude` |
| `GEMINI_API_KEY` | (leer) | Kostenloser Google-Key |
| `GEMINI_MODEL` | `gemini-flash-lite-latest` | Gemini-Modell (`gemini-flash-latest` ist etwas klüger, aber langsamer) |
| `OLLAMA_MODEL` | `llama3.2` | Lokales Modell für Ollama |
| `OLLAMA_URL` | `http://localhost:11434` | Adresse von Ollama |
| `ANTHROPIC_API_KEY` | (leer) | Claude-Key |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Claude-Modell, z. B. `claude-sonnet-5-5` |
| `PORT` | `3000` | Port des Servers |
| `USER_NAME` | `Sir` | Wie Jarvis dich anspricht |
| `GEMINI_FALLBACKS` | `gemini-3.1-flash-lite,…` | Ausweich-Modelle, wenn das Gratis-Limit eines Modells voll ist |
| `FISH_SPEED` | `1.1` | Sprechtempo der Fish-Stimme |

## Autostart auf dem Mac (optional)

Damit Jarvis beim Einschalten von selbst startet, legst du in `~/Library/LaunchAgents/` eine Datei `com.jarvis.server.plist` an, die `node server.js` im Jarvis-Ordner mit `RunAtLoad` und `KeepAlive` startet. Wichtig: Lege den Jarvis-Ordner dafür nicht in „Dokumente“, „Schreibtisch“ oder „Downloads“, sonst blockiert macOS den Zugriff beim Start. Neu starten: `launchctl kickstart -k gui/$(id -u)/com.jarvis.server`. Abschalten: `launchctl bootout gui/$(id -u)/com.jarvis.server` und die Datei löschen.

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
