// J.A.R.V.I.S. Frontend: Chat, Spracheingabe (Web Speech API) und Sprachausgabe
const $ = (id) => document.getElementById(id);
const log = $("log"), form = $("form"), input = $("input"), reactor = $("reactor");
const statusEl = $("status"), ttsToggle = $("ttsToggle"), wakeToggle = $("wakeToggle");
const voiceSelect = $("voiceSelect"), hint = $("hint");

const LANG = "de-DE";
const STORAGE_KEY = "jarvis-history";
let history = load();
let busy = false;

// ---------- Verlauf ----------
function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-40))); } catch {}
}
function addMsg(role, text) {
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}
history.forEach((m) => addMsg(m.role, m.content));

function setState(state, label) {
  reactor.classList.remove("listening", "thinking", "speaking");
  if (state) reactor.classList.add(state);
  statusEl.textContent = label || "Bereit";
  statusEl.className = "status" + (state === "error" ? " error" : state ? " active" : "");
}

// ---------- Sprachausgabe ----------
const synth = window.speechSynthesis;
let voices = [];
let speakQueue = 0;

function loadVoices() {
  if (!synth) return;
  voices = synth.getVoices();
  const de = voices.filter((v) => v.lang.toLowerCase().startsWith("de"));
  const list = de.length ? de : voices;
  const saved = localStorage.getItem("jarvis-voice");
  voiceSelect.innerHTML = "";
  voiceSelect.style.display = list.length ? "" : "none";
  list.forEach((v) => {
    const o = document.createElement("option");
    o.value = v.name; o.textContent = `${v.name} (${v.lang})`;
    if (v.name === saved) o.selected = true;
    voiceSelect.appendChild(o);
  });
  // Bevorzugt eine männliche/„Google“-Stimme, falls nichts gespeichert ist
  if (!saved) {
    const pref =
      list.find((v) => /premium|enhanced|erweitert|natural/i.test(v.name)) ||
      list.find((v) => /markus|yannick|anna|petra|helena|martin|katja|conrad/i.test(v.name)) ||
      list.find((v) => /google/i.test(v.name));
    if (pref) voiceSelect.value = pref.name;
  }
}
if (synth) {
  loadVoices();
  synth.onvoiceschanged = loadVoices;
} else {
  ttsToggle.checked = false; ttsToggle.disabled = true;
  voiceSelect.style.display = "none";
}
voiceSelect.onchange = () => localStorage.setItem("jarvis-voice", voiceSelect.value);

// Fish Audio: wird genutzt, wenn der Server einen FISH_API_KEY hat
let fishOn = false;
fetch("/api/health").then((r) => r.json()).then((j) => {
  fishOn = j.tts === "fish";
  if (fishOn) { voiceSelect.style.display = "none"; ttsToggle.disabled = false; }
}).catch(() => {});

let lastSpokeEnd = 0, lastAnswer = "";
let speakGen = 0, currentAudio = null, audioChain = Promise.resolve();

function speakBrowser(text) {
  return new Promise((resolve) => {
    if (!synth) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LANG;
    u.rate = 1.05;
    u.pitch = 1;
    const v = voices.find((x) => x.name === voiceSelect.value);
    if (v) u.voice = v;
    u.onend = u.onerror = () => resolve();
    synth.speak(u);
  });
}

// Spielt eine Audio-Datei ab, sobald genug geladen ist (wartet nicht aufs komplette Laden)
function playAudio(a) {
  return new Promise((resolve, reject) => {
    currentAudio = a;
    a.onended = () => resolve();
    a.onerror = () => reject(new Error("Audio-Fehler"));
    a.play().catch(reject);
  });
}

function speak(text) {
  if (!ttsToggle.checked || !text.trim() || (!fishOn && !synth)) return;
  const gen = speakGen;
  speakQueue++;
  setState("speaking", "Spricht");
  // Fish-Audio sofort anfordern, damit der Satz bereitliegt, wenn er dran ist
  let audio = null;
  if (fishOn) {
    audio = new Audio(`/api/tts?text=${encodeURIComponent(text)}`);
    audio.preload = "auto";
  }
  audioChain = audioChain.then(async () => {
    if (gen !== speakGen) return;
    if (!audio) return speakBrowser(text);
    try { await playAudio(audio); }
    catch (err) { console.warn("Fish Audio:", err.message); if (gen === speakGen) await speakBrowser(text); }
  }).finally(() => {
    if (gen !== speakGen) return;
    speakQueue = Math.max(0, speakQueue - 1);
    if (speakQueue === 0 && !busy) { lastSpokeEnd = Date.now(); setState(null); openFollowUp(); resumeRecognition(); }
  });
}

// Kurzer Ton als Zeichen, dass Jarvis zuhört (schneller als „Ja, Sir?“ vorzulesen)
let audioCtx = null;
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(880, audioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1320, audioCtx.currentTime + 0.12);
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.25);
    o.connect(g).connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.26);
  } catch {}
}

// Nach einer Antwort kurz ohne „Hey Jarvis“ weiterhören, damit man einfach weiterreden kann
function openFollowUp(ms = 8000) {
  if (!wakeToggle.checked) return;
  awaitingCommand = true;
  clearTimeout(awaitTimer);
  awaitTimer = setTimeout(() => { awaitingCommand = false; if (listening) setState("listening", "Wartet auf „Jarvis“"); }, ms);
}
function stopSpeaking() {
  speakGen++;
  if (speakQueue > 0) lastSpokeEnd = Date.now();
  speakQueue = 0;
  if (!busy) setState(null);
  audioChain = Promise.resolve();
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  if (synth) synth.cancel();
}

// ---------- Chat mit Claude (Streaming) ----------
async function ask(text) {
  text = text.trim();
  if (!text || busy) return;
  stopSpeaking();
  busy = true;
  addMsg("user", text);
  history.push({ role: "user", content: text });
  save();
  setState("thinking", "Denkt nach");

  const el = addMsg("assistant", "");
  let full = "", pending = "", spokeFirst = false;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history.slice(-20) }),
    });
    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `Serverfehler ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split("\n\n");
      buf = events.pop();
      for (const ev of events) {
        const type = ev.match(/^event: (.*)$/m)?.[1];
        const data = JSON.parse(ev.match(/^data: (.*)$/m)?.[1] || "{}");
        if (type === "delta") {
          full += data.text; pending += data.text;
          el.textContent = full;
          log.scrollTop = log.scrollHeight;
          // Den ersten Satz sofort vorlesen, danach in größeren Stücken (klingt flüssiger)
          // Den Anfang so früh wie möglich vorlesen (auch an einem Komma), danach in größeren Stücken
          const m = pending.match(/^([\s\S]*[.!?…])(\s+)([\s\S]*)$/) ||
            (!spokeFirst && pending.length > 60 ? pending.match(/^([\s\S]*[,;:])(\s+)([\s\S]*)$/) : null);
          if (m && (!spokeFirst || m[1].length > 160)) { speak(m[1]); pending = m[3]; spokeFirst = true; }
        } else if (type === "timer") {
          startTimer(data.sekunden, data.bezeichnung);
        } else if (type === "error") {
          throw new Error(data.message);
        }
      }
    }
    speak(pending);
    lastAnswer = full;
    history.push({ role: "assistant", content: full });
    save();
  } catch (err) {
    el.remove();
    history.pop(); save();
    addMsg("error", `Fehler: ${err.message}`);
    setState("error", "Fehler");
  } finally {
    busy = false;
    if (speakQueue === 0 && !statusEl.classList.contains("error")) { setState(null); openFollowUp(); resumeRecognition(); }
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const t = input.value; input.value = "";
  ask(t);
});

$("clearBtn").onclick = () => {
  history = []; save(); log.innerHTML = ""; stopSpeaking(); setState(null);
};

// ---------- Diagnose: schreibt Mikrofon-Ereignisse ins Terminal (npm start) ----------
function dbg(event, detail = "") {
  try {
    fetch("/api/debug", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, detail: String(detail).slice(0, 300) }) }).catch(() => {});
  } catch {}
}

// ---------- Spracheingabe ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false, wantListening = false, awaitingCommand = false, awaitTimer = null;
const HINT_WAKE = "Sag „Hey Jarvis“ und dann deine Frage, z. B. „Hey Jarvis, wie spät ist es?“";
const HINT_CLICK = "Klicke auf den Reaktor oder drücke die Leertaste, um zu sprechen.";
try { if (localStorage.getItem("jarvis-wake") === "off") wakeToggle.checked = false; } catch {}

if (!SR) {
  dbg("no-speech-recognition", navigator.userAgent);
  hint.textContent = "Dein Browser unterstützt keine Spracheingabe. Nutze Chrome oder Edge, oder tippe unten.";
  wakeToggle.disabled = true;
} else {
  rec = new SR();
  rec.lang = LANG;
  rec.interimResults = true;

  rec.onstart = () => {
    dbg("start");
    listening = true;
    if (!busy && speakQueue === 0) setState("listening", wakeToggle.checked && !awaitingCommand ? "Wartet auf „Jarvis“" : "Hört zu");
  };
  rec.onend = () => {
    dbg("end");
    listening = false;
    if (!busy && speakQueue === 0) setState(null);
    if (wantListening && wakeToggle.checked) setTimeout(resumeRecognition, 300);
  };
  rec.onerror = (e) => {
    dbg("error", e.error);
    if (e.error === "audio-capture") {
      // Mikrofon da, aber kein Ton: meist hat der Mac Chrome den Zugriff nicht erlaubt
      hint.textContent = "Kein Ton vom Mikrofon. Prüfe unter chrome://settings/content/microphone, dass das eingebaute Mikrofon gewählt ist (nicht das iPhone), und am Mac unter Datenschutz & Sicherheit → Mikrofon, dass Chrome erlaubt ist.";
    }
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      wantListening = false;
      // Der Browser will einmal einen Klick sehen, bevor er das Mikrofon freigibt
      hint.textContent = "Klicke einmal irgendwo auf die Seite und erlaube das Mikrofon, dann hört Jarvis auf „Hey Jarvis“.";
      document.addEventListener("click", () => {
        if (wakeToggle.checked) { wantListening = true; hint.textContent = HINT_WAKE; startListening(); }
      }, { once: true });
    }
  };
  rec.onresult = (e) => {
    let finalText = "", interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
    }
    // Während Jarvis spricht, nur auf „Stopp“ hören, sonst hört er sich selbst
    if (speakQueue > 0 || busy) {
      if (isStopCommand(finalText + " " + interim)) { stopSpeaking(); beep(); openFollowUp(); }
      return;
    }
    // Nachhall der eigenen Stimme kurz nach dem Sprechen ignorieren
    if (finalText && isEcho(finalText)) return;
    if (interim) input.placeholder = interim;
    if (!finalText) return;
    input.placeholder = "Nachricht an Jarvis…";
    showHeard(finalText);
    dbg("heard");

    if (wakeToggle.checked && !awaitingCommand) {
      const cmd = findWakeWord(finalText);
      if (cmd === null) return;
      if (cmd) ask(cmd);
      else {
        // Nur „Hey Jarvis“ gesagt: kurz bestätigen und auf die Frage warten
        openFollowUp(10000);
        beep();
        setState("listening", "Hört zu");
      }
    } else {
      awaitingCommand = false;
      clearTimeout(awaitTimer);
      ask(finalText);
    }
  };
}

// Die deutsche Spracherkennung schreibt „Jarvis“ oft anders (Javis, Dschawis, Charvis …).
// Gibt den Text nach dem Wake-Word zurück, "" wenn nur das Wake-Word kam, sonst null.
const JARVIS_LIKE = /^(j|y|g|dsch|tsch|sch|ch|sh|d|tr)?(a|ä|e|ah)r?(w|v|b|f)(i|ie|e|y)(s|ss|ß|z|ce|ses)?$/;
const HEY_LIKE = /^(hey|hei|hej|hay|he|hi|hallo|ey|okay|ok)$/;
function findWakeWord(text) {
  const words = text.trim().split(/\s+/);
  const norm = (w) => (w || "").toLowerCase().replace(/[^a-zäöüß]/g, "");
  for (let i = 0; i < words.length; i++) {
    const w = norm(words[i]);
    const next = norm(words[i + 1]);
    if (JARVIS_LIKE.test(w) && w.length >= 4) return words.slice(i + 1).join(" ").replace(/^[,.!?\s]+/, "").trim();
    if (HEY_LIKE.test(w) && next && (JARVIS_LIKE.test(next) || /^(j|dsch|tsch|sch|ch|sh|g)/.test(next))) {
      return words.slice(i + 2).join(" ").replace(/^[,.!?\s]+/, "").trim();
    }
  }
  return null;
}

// Zeigt kurz an, was Jarvis verstanden hat (hilft, wenn das Wake-Word nicht klappt)
let heardTimer = null;
function showHeard(text) {
  if (!wakeToggle.checked) return;
  hint.textContent = `Gehört: „${text.trim()}“`;
  clearTimeout(heardTimer);
  heardTimer = setTimeout(() => { hint.textContent = HINT_WAKE; }, 4000);
}

// „Stopp“, „Ruhe“, „Aufhören“ … unterbricht Jarvis, aber nur, wenn er das Wort nicht selbst gerade sagt
const STOP_WORDS = /\b(stopp?|ruhe|aufhören|hör auf|sei still|abbrechen|genug|halt stopp)\b/i;
function isStopCommand(text) {
  const m = text.toLowerCase().match(STOP_WORDS);
  return !!m && !lastAnswerNow().toLowerCase().includes(m[1]);
}
const lastAnswerNow = () => (busy ? log.lastElementChild?.textContent || "" : lastAnswer);
function isEcho(text) {
  if (Date.now() - lastSpokeEnd > 2500) return false;
  const norm = (t) => t.toLowerCase().replace(/[^a-zäöüß0-9 ]/g, "").trim();
  const t = norm(text);
  return !!t && norm(lastAnswer).includes(t);
}

// Timer: läuft im Browser, am Ende drei Töne und eine Ansage
function startTimer(sekunden, bezeichnung) {
  const name = bezeichnung ? `für ${bezeichnung} ` : "";
  setTimeout(() => {
    [0, 400, 800].forEach((ms) => setTimeout(beep, ms));
    const text = `Sir, Ihr Timer ${name}ist abgelaufen.`;
    addMsg("assistant", text);
    setTimeout(() => speak(text), 1200);
  }, sekunden * 1000);
}

function startListening() {
  if (!rec || listening) return;
  rec.continuous = wakeToggle.checked;
  try { rec.start(); } catch (err) { dbg("start-failed", err.message); }
}
function pauseRecognition() { if (rec && listening) { try { rec.abort(); } catch {} } }
function resumeRecognition() {
  if (rec && wantListening && wakeToggle.checked && !listening) startListening();
}

reactor.addEventListener("click", () => {
  if (speakQueue > 0) { stopSpeaking(); return; }
  if (!rec) return;
  if (listening && !wakeToggle.checked) { rec.stop(); return; }
  wantListening = true;
  startListening();
});

wakeToggle.addEventListener("change", () => {
  try { localStorage.setItem("jarvis-wake", wakeToggle.checked ? "on" : "off"); } catch {}
  if (wakeToggle.checked) {
    wantListening = true; awaitingCommand = false;
    pauseRecognition();
    setTimeout(startListening, 300);
    hint.textContent = HINT_WAKE;
  } else {
    wantListening = false; pauseRecognition();
    hint.textContent = HINT_CLICK;
  }
});

// Falls die Erkennung unbemerkt stoppt (z. B. wenn der Tab im Hintergrund war): alle 3 Sekunden neu starten
setInterval(resumeRecognition, 3000);
document.addEventListener("visibilitychange", () => {
  dbg("visibility", document.visibilityState);
  if (document.visibilityState === "visible") resumeRecognition();
});

// Beim Öffnen der Seite sofort auf „Hey Jarvis“ hören
if (rec && wakeToggle.checked) {
  hint.textContent = HINT_WAKE;
  wantListening = true;
  startListening();
} else if (rec) {
  hint.textContent = HINT_CLICK;
}

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && document.activeElement !== input) {
    e.preventDefault();
    reactor.click();
  }
  if (e.key === "Escape") stopSpeaking();
});
