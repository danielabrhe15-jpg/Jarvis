// J.A.R.V.I.S. Frontend: Chat, Spracheingabe (Web Speech API) und Sprachausgabe
const $ = (id) => document.getElementById(id);
const log = $("log"), form = $("form"), input = $("input"), reactor = $("reactor");
const statusEl = $("status"), ttsToggle = $("ttsToggle"), wakeToggle = $("wakeToggle");
const voiceSelect = $("voiceSelect"), hint = $("hint"), heardEl = $("heard");
const NAME = "Chef"; // so spricht Jarvis den Nutzer in festen Sätzen an

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

// ---------- Oberfläche: Uhr, Einstellungen, Tastatur ----------
function tick() {
  const now = new Date();
  $("clock").textContent = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  $("date").textContent = now.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
}
tick(); setInterval(tick, 10000);
$("settingsBtn").onclick = (e) => {
  e.stopPropagation();
  $("settings").classList.toggle("hidden");
  $("settingsBtn").classList.toggle("on", !$("settings").classList.contains("hidden"));
};
document.addEventListener("click", (e) => {
  if (!$("settings").contains(e.target) && e.target !== $("settingsBtn")) {
    $("settings").classList.add("hidden"); $("settingsBtn").classList.remove("on");
  }
});
$("kbdBtn").onclick = () => {
  const hidden = form.classList.toggle("hidden");
  $("kbdBtn").classList.toggle("on", !hidden);
  if (!hidden) input.focus();
};

// Zeigt kurz an, was gefragt wurde (statt eines Chatverlaufs)
let heardHide = null;
function showQuestion(text) {
  heardEl.textContent = `„${text}“`;
  heardEl.classList.add("show");
  clearTimeout(heardHide);
  heardHide = setTimeout(() => heardEl.classList.remove("show"), 6000);
}

// Antworttext nur anzeigen, wenn ausdrücklich gewünscht (oder ohne Sprachausgabe)
const TEXT_WANTED = /\b(zeig|zeige|zeigen|anzeigen|schreib|schreibe|aufschreiben|notier|als text|text davon|auf dem bildschirm|liste)\b/i;

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
let audioCtx = null;
let fishOn = false;

function loadVoices() {
  if (!synth || fishOn) return;
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
voiceSelect.onchange = () => {
  localStorage.setItem(fishOn ? "jarvis-fish-voice" : "jarvis-voice", voiceSelect.value);
  stopSpeaking(); speak(`Guten Tag, ${NAME}. So klinge ich jetzt.`);
};

// Fish Audio: wird genutzt, wenn der Server einen FISH_API_KEY hat. Dann gibt es eine
// Auswahl an Fish-Stimmen und ein Sprechtempo, beides wird im Browser gespeichert.
const speedSelect = document.createElement("select");
speedSelect.title = "Sprechtempo";
[["0.9", "Tempo langsam"], ["1", "Tempo normal"], ["1.1", "Tempo zügig"], ["1.2", "Tempo schnell"], ["1.35", "Tempo sehr schnell"]]
  .forEach(([v, t]) => speedSelect.add(new Option(t, v)));
speedSelect.value = localStorage.getItem("jarvis-speed") || "1.1";
speedSelect.style.display = "none";
speedSelect.onchange = () => {
  localStorage.setItem("jarvis-speed", speedSelect.value);
  stopSpeaking(); speak(`So schnell spreche ich jetzt, ${NAME}.`);
  preloadAck();
};
voiceSelect.after(speedSelect);

fetch("/api/health").then((r) => r.json()).then(async (j) => {
  fishOn = j.tts === "fish";
  if (!fishOn) return;
  ttsToggle.disabled = false;
  speedSelect.style.display = "";
  const { voices: list = [], default: def } = await fetch("/api/voices").then((r) => r.json()).catch(() => ({}));
  if (!list.length) { voiceSelect.style.display = "none"; return; }
  voiceSelect.innerHTML = "";
  if (def && !list.some((v) => v.id === def)) list.unshift({ id: def, name: "Standard-Stimme" });
  list.forEach((v) => voiceSelect.add(new Option(v.id === def ? `${v.name} (Standard)` : v.name, v.id)));
  voiceSelect.value = localStorage.getItem("jarvis-fish-voice") || def || list[0].id;
  voiceSelect.style.display = "";
  preloadAck();
}).catch(() => {});
// „Ja, Chef?“ vorab laden, damit es ohne Verzögerung kommt
// ---------- Sprache: Deutsch oder Tigrinya ----------
const langSelect = $("langSelect"), langBtn = $("langBtn");
let lang = "de";
try { lang = localStorage.getItem("jarvis-lang") === "ti" ? "ti" : "de"; } catch {}
const ACKS = { de: `Ja, ${NAME}?`, ti: "እወ ሸፍ?" };
let ACK = ACKS[lang];
function setLang(l) {
  lang = l === "ti" ? "ti" : "de";
  ACK = ACKS[lang];
  langSelect.value = lang;
  langBtn.textContent = lang === "ti" ? "ትግ" : "DE";
  langBtn.classList.toggle("on", lang === "ti");
  try { localStorage.setItem("jarvis-lang", lang); } catch {}
  preloadAck();
}
langSelect.onchange = () => setLang(langSelect.value);
langBtn.onclick = (e) => { e.stopPropagation(); setLang(lang === "ti" ? "de" : "ti"); stopSpeaking(); speak(ACK); };

const ttsCache = new Map();
function preloadAck() {
  if (!fishOn && lang !== "ti") return;
  const url = ttsUrl(ACK);
  if (ttsCache.has(url)) return;
  fetch(url).then((r) => (r.ok ? r.blob() : null)).then((b) => b && ttsCache.set(url, URL.createObjectURL(b))).catch(() => {});
}
voiceSelect.addEventListener("change", preloadAck);
const ttsUrl = (text) =>
  `/api/tts?text=${encodeURIComponent(text)}&speed=${speedSelect.value}` + (voiceSelect.value ? `&voice=${voiceSelect.value}` : "");

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
// Der Reaktor pulsiert mit der Lautstärke der Stimme. Nur wenn der Audio-Kontext läuft,
// sonst bliebe die Stimme stumm (Chrome startet ihn erst nach einem Klick).
let analyser = null, levelLoop = 0;
function visualize(a) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state !== "running") { audioCtx.resume().catch(() => {}); return; }
    if (!analyser) { analyser = audioCtx.createAnalyser(); analyser.fftSize = 256; analyser.connect(audioCtx.destination); }
    audioCtx.createMediaElementSource(a).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    cancelAnimationFrame(levelLoop);
    const step = () => {
      analyser.getByteFrequencyData(data);
      const level = Math.min(1, data.reduce((x, y) => x + y, 0) / data.length / 90);
      document.documentElement.style.setProperty("--level", a.paused ? 0 : level.toFixed(3));
      if (!a.paused && !a.ended) levelLoop = requestAnimationFrame(step);
    };
    a.addEventListener("playing", () => { levelLoop = requestAnimationFrame(step); }, { once: true });
  } catch {}
}
function playAudio(a, text = "") {
  return new Promise((resolve, reject) => {
    currentAudio = a;
    visualize(a);
    // Sicherheitsnetz: hängt der Ton (Netz weg, Stream bricht ab), nach einer
    // großzügigen Zeit aufgeben, sonst würde Jarvis danach nicht mehr zuhören
    const limit = 8000 + text.length * 120;
    const watchdog = setTimeout(() => { dbg("audio-watchdog"); a.pause(); resolve(); }, limit);
    const done = (fn) => (...x) => { clearTimeout(watchdog); document.documentElement.style.setProperty("--level", 0); fn(...x); };
    a.onended = done(resolve);
    a.onerror = done(() => reject(new Error("Audio-Fehler")));
    a.play().catch(done(reject));
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
    const url = ttsUrl(text);
    audio = new Audio(ttsCache.get(url) || url);
    audio.preload = "auto";
  }
  audioChain = audioChain.then(async () => {
    if (gen !== speakGen) return;
    if (!audio) return speakBrowser(text);
    try { await playAudio(audio, text); }
    catch (err) { console.warn("Fish Audio:", err.message); if (gen === speakGen) await speakBrowser(text); }
  }).finally(() => {
    if (gen !== speakGen) return;
    speakQueue = Math.max(0, speakQueue - 1);
    if (speakQueue === 0 && !busy) { lastSpokeEnd = Date.now(); setState(null); resumeRecognition(); }
  });
}

// Kurzer Ton (z. B. nach „Stopp“ und beim Timer)
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

// Nach einem bloßen „Jarvis“ kurz auf die Frage warten
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
  showQuestion(text);
  history.push({ role: "user", content: text });
  save();
  setState("thinking", "Denkt nach");

  const showText = !ttsToggle.checked || TEXT_WANTED.test(text);
  log.innerHTML = "";
  const el = showText ? addMsg("assistant", "") : null;
  let full = "", pending = "", spokeFirst = false;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history.slice(-20), lang }),
      signal: AbortSignal.timeout(30000),
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
          if (el) { el.textContent = full; log.scrollTop = log.scrollHeight; }
          // Den ersten Satz sofort vorlesen, danach in größeren Stücken (klingt flüssiger)
          // Den Anfang so früh wie möglich vorlesen (auch an einem Komma), danach in größeren Stücken
          const m = pending.match(/^([\s\S]*[.!?…])(\s+)([\s\S]*)$/) ||
            (!spokeFirst && pending.length > 60 ? pending.match(/^([\s\S]*[,;:])(\s+)([\s\S]*)$/) : null);
          if (m && (!spokeFirst || m[1].length > 160)) { speak(m[1]); pending = m[3]; spokeFirst = true; }
        } else if (type === "slides") {
          openSlides(data);
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
    el?.remove();
    history.pop(); save();
    addMsg("error", `Fehler: ${err.message}`);
    setState("error", "Fehler");
  } finally {
    busy = false;
    if (speakQueue === 0 && !statusEl.classList.contains("error")) { setState(null); resumeRecognition(); }
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
let rec = null, listening = false, wantListening = false, awaitingCommand = false, awaitTimer = null, ackTimer = null, ackActive = false;
const HINT_WAKE = "Sag „Jarvis“ und dann deine Frage, z. B. „Jarvis, wie spät ist es?“";
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
    if (wantListening && wakeToggle.checked) setTimeout(resumeRecognition, 50);
  };
  rec.onerror = (e) => {
    dbg("error", e.error);
    if (e.error === "audio-capture") {
      // Mikrofon da, aber kein Ton: meist hat der Mac Chrome den Zugriff nicht erlaubt
      hint.textContent = "Kein Ton vom Mikrofon. Ist der MacBook-Deckel zu (z. B. mit externem Bildschirm)? Dann ist das eingebaute Mikrofon aus. Sonst unter chrome://settings/content/microphone das MacBook-Mikrofon wählen.";
    }
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      wantListening = false;
      // Der Browser will einmal einen Klick sehen, bevor er das Mikrofon freigibt
      hint.textContent = "Klicke einmal irgendwo auf die Seite und erlaube das Mikrofon, dann hört Jarvis auf seinen Namen.";
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
    // Folien steuern („weiter“, „zurück“, „schließen“) geht auch, während Jarvis spricht
    if (finalText && slideVoiceCommand(finalText)) { if (speakQueue > 0) stopSpeaking(); return; }
    // Während Jarvis spricht, nur auf „Stopp“ hören, sonst hört er sich selbst
    if (finalText && /^\s*ja,?\s*chef\W*$/i.test(finalText)) return; // eigenes „Ja, Chef?“
    if ((speakQueue > 0 && !ackActive) || busy) {
      if (isStopCommand(finalText + " " + interim)) { stopSpeaking(); beep(); return; }
      // Neue Frage mit „Jarvis …“, während er noch redet: aufhören und die neue Frage beantworten
      const cmd = !busy && finalText && !/jarvis/i.test(lastAnswerNow()) ? findWakeWord(finalText) : null;
      if (cmd) { dbg("unterbrochen"); stopSpeaking(); collect(cmd); return; }
      if (finalText) dbg(busy ? "ignoriert-denkt" : "ignoriert-spricht");
      return;
    }
    // Nachhall der eigenen Stimme kurz nach dem Sprechen ignorieren
    if (finalText && isEcho(finalText)) return;
    if (tiCapturing) return; // Tigrinya-Aufnahme läuft, Chrome-Text wird nicht gebraucht
    // Nach „Jarvis“ wird gesammelt, bis du eine kurze Pause machst – so kannst du ausreden
    if (collecting) {
      if (finalText) cmdBuf = `${cmdBuf} ${finalText}`.trim();
      showLive(`${cmdBuf} ${interim}`.trim());
      armSilence();
      return;
    }
    // Redet der Nutzer nach „Jarvis“ weiter, keine Bestätigung
    if (interim || finalText) clearTimeout(ackTimer);
    if (interim) input.placeholder = interim;
    if (!finalText) return;
    input.placeholder = "Nachricht an Jarvis…";
    showHeard(finalText);
    dbg("heard");

    if (wakeToggle.checked && !awaitingCommand) {
      const cmd = findWakeWord(finalText);
      if (cmd === null) return;
      dbg("wake", cmd ? "mit Frage" : "nur Name");
      if (lang === "ti") { tiCapture(true); return; }
      if (cmd) collect(cmd);
      else {
        // Nur „Jarvis“ gesagt: auf die Frage warten. Kommt kurz nichts, „Ja, Chef?“ sagen
        openFollowUp(10000);
        setState("listening", "Hört zu");
        clearTimeout(ackTimer);
        ackTimer = setTimeout(() => {
          if (!awaitingCommand || busy) return;
          ackActive = true; setTimeout(() => (ackActive = false), 2500);
          speak(ACK);
        }, 900);
      }
    } else {
      awaitingCommand = false; ackActive = false;
      clearTimeout(awaitTimer);
      if (speakQueue > 0) stopSpeaking(); // „Ja, Chef?“ abbrechen, die Frage ist da
      collect(finalText);
    }
  };
}

// ---------- Ausreden lassen ----------
// Chrome schließt einen Satzteil schon bei kleinen Pausen ab. Deshalb sammelt Jarvis nach
// seinem Namen alles Gesagte und fragt erst, wenn du SILENCE_MS lang nichts mehr sagst.
const SILENCE_MS = 1300;
let collecting = false, cmdBuf = "", silenceTimer = null;
function collect(text) {
  collecting = true;
  cmdBuf = text.trim();
  clearTimeout(ackTimer);
  setState("listening", "Hört zu");
  showLive(cmdBuf);
  armSilence();
}
function armSilence() {
  clearTimeout(silenceTimer);
  silenceTimer = setTimeout(() => {
    const q = cmdBuf.trim();
    collecting = false; cmdBuf = "";
    if (q) ask(q); else setState(null);
  }, SILENCE_MS);
}
function showLive(text) {
  heardEl.textContent = text ? `„${text} …“` : "";
  heardEl.classList.toggle("show", !!text);
}

// ---------- Tigrinya-Spracheingabe ----------
// Chrome kann kein Tigrinya erkennen. Deshalb nimmt Jarvis nach seinem Namen die Frage
// selbst auf (bis du eine Pause machst) und lässt sie von Gemini aufschreiben.
let tiCapturing = false, micStream = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function tiCapture(withAck) {
  if (tiCapturing || busy) return;
  tiCapturing = true;
  try {
    if (withAck) {
      speak(ACK);
      for (let i = 0; i < 60 && speakQueue > 0; i++) await sleep(100); // erst ausreden lassen, sonst nimmt er sich selbst auf
    }
    setState("listening", "ይሰምዕ ኣሎ … (Tigrinya)");
    const blob = await recordUntilSilence();
    if (!blob) { setState(null); return; }
    setState("thinking", "Versteht …");
    const wav = await toWav16k(blob);
    const r = await fetch("/api/transcribe?lang=ti", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
    const { text = "", error } = await r.json();
    if (error) throw new Error(error);
    dbg("ti-transkript", text ? "ok" : "leer");
    setState(null);
    if (text.trim()) ask(text.trim());
    else showQuestion("Nicht verstanden – bitte nochmal.");
  } catch (err) {
    dbg("ti-fehler", err.message);
    setState(null);
    showQuestion(`Aufnahme-Fehler: ${err.message}`);
  } finally {
    tiCapturing = false;
  }
}

// Nimmt auf, bis nach dem Sprechen 1,2 s Stille ist (max. 15 s; ohne Sprache nach 7 s Abbruch)
async function recordUntilSilence() {
  micStream = micStream || await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const an = ctx.createAnalyser(); an.fftSize = 1024;
  ctx.createMediaStreamSource(micStream).connect(an);
  const buf = new Float32Array(an.fftSize);
  const rec2 = new MediaRecorder(micStream), chunks = [];
  rec2.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec2.start(250);
  const t0 = Date.now();
  let floor = 0.004, spoke = false, lastVoice = Date.now();
  while (true) {
    await sleep(60);
    an.getFloatTimeDomainData(buf);
    const rms = Math.sqrt(buf.reduce((a, x) => a + x * x, 0) / buf.length);
    if (Date.now() - t0 < 300) { floor = Math.max(floor, rms); continue; } // Grundrauschen messen
    if (rms > Math.max(0.012, floor * 2.5)) { spoke = true; lastVoice = Date.now(); }
    const elapsed = Date.now() - t0;
    if (spoke && Date.now() - lastVoice > 1200) break;
    if (!spoke && elapsed > 7000) break;
    if (elapsed > 15000) break;
  }
  await new Promise((r) => { rec2.onstop = r; rec2.stop(); });
  ctx.close();
  return spoke ? new Blob(chunks, { type: rec2.mimeType || "audio/webm" }) : null;
}

// Wandelt die Aufnahme in WAV (16 kHz, mono) um, das versteht Gemini sicher
async function toWav16k(blob) {
  const decoded = await new OfflineAudioContext(1, 16000, 16000).decodeAudioData(await blob.arrayBuffer());
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const view = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (o, t) => [...t].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); view.setUint32(4, 36 + pcm.length * 2, true); str(8, "WAVE"); str(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, "data"); view.setUint32(40, pcm.length * 2, true);
  pcm.forEach((x, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x)) * 0x7fff, true));
  return new Blob([view], { type: "audio/wav" });
}

// Die deutsche Spracherkennung schreibt „Jarvis“ oft anders (Javis, Dschawis, Charvis …).
// Gibt den Text nach dem Wake-Word zurück, "" wenn nur das Wake-Word kam, sonst null.
const JARVIS_LIKE = /^(j|y|g|dsch|tsch|sch|ch|sh|d|tr)?(a|ä|e|ah)r?(w|v|b|f)(i|ie|e|y)(s|ss|ß|z|ce|ses)?$/;
const HEY_LIKE = /^(hey|hei|hej|hay|he|hi|hallo|ey|okay|ok)$/;
function findWakeWord(text) {
  const words = text.trim().split(/\s+/);
  const norm = (w) => (w || "").toLowerCase().replace(/[^a-zäöüß]/g, "");
  const clean = (ws) => ws.join(" ").replace(/^[,.!?\s]+|[,\s]+$/g, "").trim();
  for (let i = 0; i < words.length; i++) {
    const w = norm(words[i]);
    if (!(JARVIS_LIKE.test(w) && w.length >= 4)) continue;
    const after = clean(words.slice(i + 1));
    if (after) return after;
    // „Wie spät ist es, Jarvis?“: Name am Ende, Frage davor
    const before = clean(words.slice(0, i).filter((x) => !HEY_LIKE.test(norm(x))));
    return before.split(" ").length >= 2 ? before : "";
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
const timers = [];
function startTimer(sekunden, bezeichnung) {
  const name = bezeichnung ? `für ${bezeichnung} ` : "";
  const t = { label: bezeichnung || "Timer", end: Date.now() + sekunden * 1000 };
  timers.push(t); renderTimers();
  setTimeout(() => {
    timers.splice(timers.indexOf(t), 1); renderTimers();
    [0, 400, 800].forEach((ms) => setTimeout(beep, ms));
    const text = `${NAME}, Ihr Timer ${name}ist abgelaufen.`;
    showQuestion(text);
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
  if (lang === "ti") { tiCapture(false); return; } // Tigrinya: Klick = sofort aufnehmen
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

setLang(lang);

// Beim Öffnen der Seite sofort auf „Jarvis“ hören
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

// ---------- HUD: Skala um den Reaktor, Live-Daten, Timer, Nachrichten ----------
(function drawTicks() {
  const g = $("ticks"), ns = "http://www.w3.org/2000/svg";
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2, major = i % 10 === 0, r1 = major ? 140 : 145, r2 = 150;
    const l = document.createElementNS(ns, "line");
    l.setAttribute("x1", 200 + r1 * Math.cos(a)); l.setAttribute("y1", 200 + r1 * Math.sin(a));
    l.setAttribute("x2", 200 + r2 * Math.cos(a)); l.setAttribute("y2", 200 + r2 * Math.sin(a));
    if (major) l.setAttribute("class", "major");
    g.appendChild(l);
  }
})();

const setBar = (id, pct) => { $(id).style.width = `${Math.max(0, Math.min(100, pct))}%`; };
function setKv(id, text, cls = "") { const el = $(id); el.textContent = text; el.className = cls; }

async function refreshHud() {
  try {
    const h = await fetch("/api/hud").then((r) => r.json());
    if (h.wetter) {
      $("wxTemp").textContent = `${h.wetter.temp}°`;
      $("wxText").textContent = h.wetter.text;
      $("wxMeta").textContent = `${h.wetter.ort} · ${h.wetter.min}° / ${h.wetter.max}°`;
    } else { $("wxText").textContent = "nicht verfügbar"; }
    if (h.akku) {
      setBar("battBar", h.akku.prozent);
      $("battText").textContent = `${h.akku.prozent} %${h.akku.laedt ? " · lädt" : ""}`;
    } else { $("battText").textContent = "Netzbetrieb"; setBar("battBar", 100); }
    if (h.lautstaerke !== null) { setBar("volBar", h.lautstaerke); $("volText").textContent = `Lautstärke ${h.lautstaerke} %`; }
    setKv("sysModel", (h.modell || "–").replace(/^gemini-/, "Gemini "));
  } catch {}
  setKv("sysNet", navigator.onLine ? "online" : "offline", navigator.onLine ? "ok" : "warn");
}
refreshHud(); setInterval(refreshHud, 30000);

function refreshSys() {
  setKv("sysVoice", fishOn ? (voiceSelect.selectedOptions[0]?.text || "Fish Audio").replace(" (Standard)", "") : "Browser");
  setKv("sysMic", !rec ? "nicht verfügbar" : listening ? "aktiv" : "aus", listening ? "ok" : "warn");
}
setInterval(refreshSys, 1000);

async function refreshNews() {
  try {
    const { schlagzeilen = [] } = await fetch("/api/news").then((r) => r.json());
    const el = $("tickerText");
    el.innerHTML = "";
    schlagzeilen.forEach((t) => { const b = document.createElement("b"); b.textContent = "◆"; el.append(b, t); });
  } catch {}
}
refreshNews(); setInterval(refreshNews, 10 * 60_000);

function renderTimers() {
  const ul = $("timerList");
  ul.innerHTML = "";
  if (!timers.length) { ul.innerHTML = '<li class="muted small">Keine aktiven Timer</li>'; return; }
  for (const t of timers) {
    const left = Math.max(0, Math.round((t.end - Date.now()) / 1000));
    const li = document.createElement("li"), span = document.createElement("span"), b = document.createElement("b");
    span.textContent = t.label;
    b.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    li.append(span, b); ul.appendChild(li);
  }
}
setInterval(() => timers.length && renderTimers(), 1000);

// ---------- Präsentation ----------
let deck = null, slideIdx = 0;
function openSlides(data) {
  deck = data; slideIdx = 0;
  $("slidesTitle").textContent = data.titel || "Präsentation";
  $("slideDots").innerHTML = "";
  data.folien.forEach((_, i) => { const d = document.createElement("i"); d.onclick = () => showSlide(i); $("slideDots").appendChild(d); });
  // Bilder schon vorab suchen, damit das Blättern flüssig ist
  data.folien.forEach((f) => {
    f.bild = f.bildsuche ? fetch(`/api/image?q=${encodeURIComponent(f.bildsuche)}`).then((r) => r.json()).then((j) => j.url).catch(() => null) : Promise.resolve(null);
  });
  $("slides").classList.remove("hidden");
  showSlide(0);
}
async function showSlide(i) {
  if (!deck) return;
  slideIdx = Math.max(0, Math.min(deck.folien.length - 1, i));
  const f = deck.folien[slideIdx], slide = document.querySelector(".slide");
  slide.classList.remove("anim"); void slide.offsetWidth; slide.classList.add("anim");
  $("slideHead").textContent = f.titel;
  $("slidePoints").innerHTML = "";
  f.punkte.forEach((p, k) => { const li = document.createElement("li"); li.textContent = p; li.style.animationDelay = `${0.15 + k * 0.12}s`; $("slidePoints").appendChild(li); });
  $("slidesCount").textContent = `${slideIdx + 1} / ${deck.folien.length}`;
  [...$("slideDots").children].forEach((d, k) => d.classList.toggle("on", k === slideIdx));
  const img = $("slideImg"), media = img.parentElement, shown = slideIdx;
  img.removeAttribute("src"); media.classList.add("noimg");
  const url = await f.bild;
  if (url && shown === slideIdx) { img.src = url; img.alt = f.bildsuche; media.classList.remove("noimg"); }
}
function closeSlides() { deck = null; $("slides").classList.add("hidden"); }
$("slidePrev").onclick = () => showSlide(slideIdx - 1);
$("slideNext").onclick = () => showSlide(slideIdx + 1);
$("slidesClose").onclick = closeSlides;
document.addEventListener("keydown", (e) => {
  if (!deck) return;
  if (e.key === "ArrowRight" || e.key === "PageDown") showSlide(slideIdx + 1);
  if (e.key === "ArrowLeft" || e.key === "PageUp") showSlide(slideIdx - 1);
  if (e.key === "Escape") closeSlides();
});
// Sprachsteuerung der Folien (ohne „Jarvis“): gibt true zurück, wenn ein Befehl erkannt wurde
function slideVoiceCommand(text) {
  if (!deck) return false;
  const t = text.toLowerCase().trim();
  if (/^(weiter|nächste|nächste folie|vor|vorwärts)\b/.test(t)) { showSlide(slideIdx + 1); return true; }
  if (/^(zurück|vorherige|vorherige folie)\b/.test(t)) { showSlide(slideIdx - 1); return true; }
  if (/^(schließen|beenden|ende|fertig|präsentation schließen|präsentation beenden)\b/.test(t)) { closeSlides(); return true; }
  return false;
}
