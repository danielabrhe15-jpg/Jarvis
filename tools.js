// Werkzeuge, die Jarvis (Gemini) selbst aufrufen kann: Wetter, Nachrichten, Webseiten und Apps öffnen.
// Alle Dienste sind kostenlos und brauchen keinen eigenen Schlüssel.
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TIMEOUT = 8000;
const getJson = async (url, timeout = TIMEOUT) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { "User-Agent": "Jarvis/1.0 (persoenlicher Assistent)" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

const WEATHER_CODES = {
  0: "klar", 1: "überwiegend klar", 2: "teilweise bewölkt", 3: "bedeckt", 45: "Nebel", 48: "Reifnebel",
  51: "leichter Nieselregen", 53: "Nieselregen", 55: "starker Nieselregen", 61: "leichter Regen", 63: "Regen",
  65: "starker Regen", 66: "gefrierender Regen", 67: "starker gefrierender Regen", 71: "leichter Schneefall",
  73: "Schneefall", 75: "starker Schneefall", 77: "Schneegriesel", 80: "leichte Regenschauer", 81: "Regenschauer",
  82: "heftige Regenschauer", 85: "Schneeschauer", 86: "starke Schneeschauer", 95: "Gewitter",
  96: "Gewitter mit Hagel", 99: "schweres Gewitter mit Hagel",
};

// Ort → Koordinaten: erst Open-Meteo, bei Ausfall OpenStreetMap; Ergebnisse werden gemerkt
const geoCache = new Map();
async function geocode(ort) {
  const key = ort.trim().toLowerCase();
  if (geoCache.has(key)) return geoCache.get(key);
  let p = null;
  try {
    const g = await getJson(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=de&name=${encodeURIComponent(ort)}`, 4000);
    const r = g.results?.[0];
    if (r) p = { name: r.name, country: r.country, latitude: r.latitude, longitude: r.longitude };
  } catch {}
  if (!p) {
    const n = (await getJson(`https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=de&q=${encodeURIComponent(ort)}`, 6000))[0];
    if (n) p = { name: n.name || ort, country: n.display_name.split(",").pop().trim(), latitude: Number(n.lat), longitude: Number(n.lon) };
  }
  if (p) geoCache.set(key, p);
  return p;
}

async function wetter({ ort = process.env.CITY || "Berlin" }) {
  const p = await geocode(ort);
  if (!p) return { fehler: `Ort "${ort}" nicht gefunden.` };
  const w = await getJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}&timezone=auto&forecast_days=3` +
      "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
  );
  const d = w.daily;
  return {
    ort: `${p.name}, ${p.country}`,
    jetzt: {
      temperatur_c: w.current.temperature_2m,
      gefuehlt_c: w.current.apparent_temperature,
      wetter: WEATHER_CODES[w.current.weather_code] ?? w.current.weather_code,
      wind_kmh: w.current.wind_speed_10m,
    },
    vorhersage: d.time.map((tag, i) => ({
      tag,
      wetter: WEATHER_CODES[d.weather_code[i]] ?? d.weather_code[i],
      min_c: d.temperature_2m_min[i],
      max_c: d.temperature_2m_max[i],
      regenwahrscheinlichkeit_prozent: d.precipitation_probability_max[i],
    })),
  };
}

async function nachrichten() {
  const j = await getJson("https://www.tagesschau.de/api2u/homepage/");
  const items = (j.news || []).filter((n) => n.title).slice(0, 8);
  return { quelle: "tagesschau.de", meldungen: items.map((n) => ({ titel: n.title, kurz: n.firstSentence || n.topline || "" })) };
}

// Bekannte Seiten per Name, sonst eine Google-Suche
const SITES = {
  youtube: "https://www.youtube.com", google: "https://www.google.com", gmail: "https://mail.google.com",
  netflix: "https://www.netflix.com", amazon: "https://www.amazon.de", instagram: "https://www.instagram.com",
  tiktok: "https://www.tiktok.com", wikipedia: "https://de.wikipedia.org", maps: "https://maps.google.com",
  "google maps": "https://maps.google.com", chatgpt: "https://chatgpt.com", claude: "https://claude.ai",
  whatsapp: "https://web.whatsapp.com", spotify: "https://open.spotify.com", github: "https://github.com",
};

const run = (cmd, args) =>
  new Promise((resolve, reject) => execFile(cmd, args, { timeout: TIMEOUT }, (err) => (err ? reject(err) : resolve())));

function oeffnen(url) {
  if (process.platform !== "darwin") return run(process.platform === "win32" ? "explorer" : "xdg-open", [url]);
  return run("open", [url]);
}

async function webseite_oeffnen({ ziel = "" }) {
  const key = ziel.trim().toLowerCase();
  let url = SITES[key];
  if (!url && /^https?:\/\/\S+$/i.test(ziel.trim())) url = ziel.trim();
  if (!url && /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(key)) url = `https://${key}`;
  if (!url) url = `https://www.google.com/search?q=${encodeURIComponent(ziel)}`;
  // Nur echte Webadressen öffnen, nie Dateien oder andere Programme
  let parsed;
  try { parsed = new URL(url); } catch { return { fehler: "Ungültige Adresse." }; }
  if (!/^https?:$/.test(parsed.protocol)) return { fehler: "Nur Webseiten (http/https) können geöffnet werden." };
  await oeffnen(parsed.href);
  return { geoeffnet: parsed.href };
}

async function youtube_abspielen({ suche = "" }) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(suche)}`;
  await oeffnen(url);
  return { geoeffnet: url, hinweis: "Die Suchergebnisse sind geöffnet, der Nutzer wählt das Video selbst." };
}

// Deutsche Namen der Mac-Apps → Dateiname im Programme-Ordner
const APP_ALIASES = {
  notizen: "Notes", rechner: "Calculator", kalender: "Calendar", erinnerungen: "Reminders", nachrichten: "Messages",
  fotos: "Photos", musik: "Music", karten: "Maps", kontakte: "Contacts", vorschau: "Preview", uhr: "Clock",
  einstellungen: "System Settings", systemeinstellungen: "System Settings", wetter: "Weather", bücher: "Books",
  podcasts: "Podcasts", terminal: "Terminal", textedit: "TextEdit", aktivitätsanzeige: "Activity Monitor",
  chrome: "Google Chrome", word: "Microsoft Word", excel: "Microsoft Excel", powerpoint: "Microsoft PowerPoint",
};

// Nur Apps, die wirklich installiert sind
async function app_oeffnen({ name = "" }) {
  if (process.platform !== "darwin") return { fehler: "Apps öffnen geht nur auf dem Mac." };
  const raw = name.replace(/\.app$/i, "").trim();
  const clean = (APP_ALIASES[raw.toLowerCase()] || raw).replace(/[^\p{L}\p{N} .\-]/gu, "").trim();
  const dirs = ["/Applications", "/System/Applications", "/System/Applications/Utilities", "/System/Library/CoreServices", `${process.env.HOME}/Applications`];
  const found = dirs.map((d) => `${d}/${clean}.app`).find((p) => existsSync(p));
  if (!clean || !found) return { fehler: `App "${name}" ist auf diesem Mac nicht installiert.` };
  await run("open", ["-a", found]);
  return { geoeffnet: clean };
}

// Der Timer läuft im Browser, der Server meldet ihn nur weiter
async function timer_stellen({ sekunden = 0, bezeichnung = "" }, emit) {
  const s = Math.round(Number(sekunden));
  if (!(s > 0 && s <= 24 * 3600)) return { fehler: "Der Timer muss zwischen 1 Sekunde und 24 Stunden liegen." };
  emit?.("timer", { sekunden: s, bezeichnung: String(bezeichnung).slice(0, 60) });
  return { gestellt: true, sekunden: s };
}

// ---------- Gedächtnis: Fakten über den Nutzer, bleiben auch nach einem Neustart ----------
const MEMORY_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "memory.json");
export function loadMemory() {
  try { return JSON.parse(readFileSync(MEMORY_FILE, "utf8")).filter((f) => typeof f === "string"); } catch { return []; }
}
const saveMemory = (facts) => writeFileSync(MEMORY_FILE, JSON.stringify(facts.slice(-50), null, 2));

async function merken({ fakt = "" }) {
  const f = String(fakt).trim().slice(0, 200);
  if (!f) return { fehler: "Nichts zum Merken." };
  const facts = loadMemory().filter((x) => x.toLowerCase() !== f.toLowerCase());
  saveMemory([...facts, f]);
  return { gemerkt: f };
}

async function vergessen({ fakt = "" }) {
  const q = String(fakt).trim().toLowerCase();
  const facts = loadMemory();
  const rest = q && q !== "alles" ? facts.filter((x) => !x.toLowerCase().includes(q)) : [];
  saveMemory(rest);
  return { geloescht: facts.length - rest.length };
}

// ---------- Mac steuern: nur feste AppleScript-Befehle, keine freien Skripte ----------
const osa = (script) => run("osascript", ["-e", script]);

async function lautstaerke({ aktion = "", prozent }) {
  if (process.platform !== "darwin") return { fehler: "Geht nur auf dem Mac." };
  if (aktion === "stumm") { await osa("set volume with output muted"); return { stumm: true }; }
  if (aktion === "ton_an") { await osa("set volume without output muted"); return { stumm: false }; }
  const current = await new Promise((resolve) =>
    execFile("osascript", ["-e", "output volume of (get volume settings)"], { timeout: TIMEOUT }, (e, out) => resolve(Number(out) || 50)));
  let v = Number.isFinite(Number(prozent)) && prozent !== undefined ? Number(prozent)
    : aktion === "lauter" ? current + 15 : aktion === "leiser" ? current - 15 : current;
  v = Math.max(0, Math.min(100, Math.round(v)));
  await osa(`set volume without output muted output volume ${v}`);
  return { lautstaerke_prozent: v };
}

const MUSIC_CMDS = { abspielen: "play", pause: "pause", weiter: "next track", zurueck: "previous track", umschalten: "playpause" };
async function musik({ aktion = "abspielen", suche = "", app = "" }) {
  if (process.platform !== "darwin") return { fehler: "Geht nur auf dem Mac." };
  const player = /musik|music|apple/i.test(app) || !existsSync("/Applications/Spotify.app") ? "Music" : "Spotify";
  if (aktion === "suchen" && suche) {
    if (player !== "Spotify") return { fehler: "Suchen geht nur mit Spotify." };
    await run("open", [`spotify:search:${encodeURIComponent(suche)}`]);
    return { geoeffnet: `Spotify-Suche nach ${suche}`, hinweis: "Der Nutzer wählt das Lied in Spotify selbst aus." };
  }
  const cmd = MUSIC_CMDS[aktion];
  if (!cmd) return { fehler: `Unbekannte Aktion ${aktion}` };
  await osa(`tell application "${player}" to ${cmd}`);
  return { ok: true, player, aktion };
}

// ---------- Präsentation: Folien werden im Browser im Vollbild gezeigt ----------
async function praesentation_erstellen({ titel = "", folien = [] }, emit) {
  const slides = (Array.isArray(folien) ? folien : []).slice(0, 10).map((f) => ({
    titel: String(f?.titel || "").slice(0, 120),
    punkte: (Array.isArray(f?.punkte) ? f.punkte : []).slice(0, 6).map((p) => String(p).slice(0, 200)),
    bildsuche: String(f?.bildsuche || "").slice(0, 80),
  })).filter((f) => f.titel || f.punkte.length);
  if (!slides.length) return { fehler: "Keine Folien angegeben." };
  emit?.("slides", { titel: String(titel).slice(0, 120), folien: slides });
  return { angezeigt: true, folien: slides.length };
}

// Bild zu einem Suchbegriff über Wikipedia (kostenlos, ohne Schlüssel)
const imageCache = new Map();
export async function findImage(q) {
  const key = String(q || "").trim().toLowerCase().slice(0, 80);
  if (!key) return null;
  if (imageCache.has(key)) return imageCache.get(key);
  let url = null;
  for (const lang of ["de", "en"]) {
    try {
      const j = await getJson(
        `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=6` +
          `&prop=pageimages&piprop=thumbnail&pithumbsize=1000&gsrsearch=${encodeURIComponent(key)}`,
      );
      const pages = Object.values(j.query?.pages || {}).sort((a, b) => a.index - b.index);
      url = pages.find((p) => p.thumbnail?.source)?.thumbnail.source || null;
    } catch {}
    if (url) break;
  }
  imageCache.set(key, url);
  return url;
}

export { wetter, nachrichten };

export const toolHandlers = {
  praesentation_erstellen,
  wetter, nachrichten, webseite_oeffnen, youtube_abspielen, app_oeffnen, timer_stellen, merken, vergessen, lautstaerke, musik,
};

export const toolDeclarations = [
  {
    name: "wetter",
    description: "Aktuelles Wetter und Vorhersage für die nächsten 3 Tage an einem Ort.",
    parameters: { type: "object", properties: { ort: { type: "string", description: "Stadt, z. B. Berlin" } } },
  },
  { name: "nachrichten", description: "Die aktuellen Top-Nachrichten aus Deutschland (tagesschau.de)." },
  {
    name: "webseite_oeffnen",
    description: "Öffnet eine Webseite im Browser des Nutzers, z. B. YouTube, Netflix, Gmail, oder sucht etwas bei Google.",
    parameters: {
      type: "object",
      properties: { ziel: { type: "string", description: "Name der Seite (youtube, netflix …), eine Adresse oder ein Suchbegriff" } },
      required: ["ziel"],
    },
  },
  {
    name: "youtube_abspielen",
    description: "Sucht ein Lied, Video oder einen Künstler auf YouTube und öffnet die Ergebnisse.",
    parameters: { type: "object", properties: { suche: { type: "string" } }, required: ["suche"] },
  },
  {
    name: "app_oeffnen",
    description: "Öffnet ein installiertes Programm auf dem Mac, z. B. Spotify, Safari, Notizen, Rechner, Kalender, WhatsApp.",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "Name der App wie im Programme-Ordner, z. B. Spotify, Notes, Calculator" } },
      required: ["name"],
    },
  },
  {
    name: "timer_stellen",
    description: "Stellt einen Timer bzw. Wecker in X Sekunden, z. B. für Nudeln oder eine Pause.",
    parameters: {
      type: "object",
      properties: {
        sekunden: { type: "integer", description: "Dauer in Sekunden (5 Minuten = 300)" },
        bezeichnung: { type: "string", description: "Wofür der Timer ist, z. B. Nudeln" },
      },
      required: ["sekunden"],
    },
  },
  {
    name: "praesentation_erstellen",
    description: "Zeigt dem Nutzer eine bildliche Präsentation (Folien im Vollbild mit Bildern und Stichpunkten). Nutze das, wenn er eine Präsentation, Folien, eine Übersicht oder etwas bildlich erklärt haben möchte.",
    parameters: {
      type: "object",
      properties: {
        titel: { type: "string", description: "Titel der Präsentation" },
        folien: {
          type: "array",
          description: "4 bis 7 Folien",
          items: {
            type: "object",
            properties: {
              titel: { type: "string" },
              punkte: { type: "array", items: { type: "string" }, description: "2 bis 4 kurze Stichpunkte" },
              bildsuche: { type: "string", description: "Wikipedia-Suchbegriff für ein passendes Bild, z. B. „Mars Planet“" },
            },
            required: ["titel", "punkte"],
          },
        },
      },
      required: ["titel", "folien"],
    },
  },
  {
    name: "merken",
    description: "Speichert dauerhaft eine Information über den Nutzer, z. B. seinen Namen, Geburtstag, Vorlieben oder Termine. Nutze es, wenn er sagt „merk dir …“ oder etwas Wichtiges über sich erzählt.",
    parameters: { type: "object", properties: { fakt: { type: "string", description: "Kurzer Satz, z. B. „Der Nutzer heißt Dano“" } }, required: ["fakt"] },
  },
  {
    name: "vergessen",
    description: "Löscht gespeicherte Informationen. fakt = Stichwort, oder „alles“.",
    parameters: { type: "object", properties: { fakt: { type: "string" } }, required: ["fakt"] },
  },
  {
    name: "lautstaerke",
    description: "Ändert die Lautstärke des Macs.",
    parameters: {
      type: "object",
      properties: {
        aktion: { type: "string", enum: ["lauter", "leiser", "stumm", "ton_an", "setzen"] },
        prozent: { type: "integer", description: "Nur bei setzen: 0 bis 100" },
      },
      required: ["aktion"],
    },
  },
  {
    name: "musik",
    description: "Steuert Spotify (oder Apple Musik): abspielen, pause, nächstes oder vorheriges Lied, oder in Spotify nach einem Lied/Künstler suchen.",
    parameters: {
      type: "object",
      properties: {
        aktion: { type: "string", enum: ["abspielen", "pause", "weiter", "zurueck", "umschalten", "suchen"] },
        suche: { type: "string", description: "Nur bei suchen: Lied oder Künstler" },
        app: { type: "string", description: "Optional: Spotify oder Musik" },
      },
      required: ["aktion"],
    },
  },
];

export async function runTool(name, args, emit) {
  const fn = toolHandlers[name];
  if (!fn) return { fehler: `Unbekanntes Werkzeug ${name}` };
  try {
    console.log(`🔧 ${name}`, JSON.stringify(args || {}));
    return await fn(args || {}, emit);
  } catch (err) {
    return { fehler: err?.message || String(err) };
  }
}
