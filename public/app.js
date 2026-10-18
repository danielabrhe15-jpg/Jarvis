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
    const pref = list.find((v) => /male|männ|google|stefan|markus|conrad|daniel/i.test(v.name));
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

function speak(text) {
  if (!synth || !ttsToggle.checked || !text.trim()) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = LANG;
  u.rate = 1.02;
  u.pitch = 0.9;
  const v = voices.find((x) => x.name === voiceSelect.value);
  if (v) u.voice = v;
  speakQueue++;
  pauseRecognition();
  setState("speaking", "Spricht");
  u.onend = u.onerror = () => {
    speakQueue = Math.max(0, speakQueue - 1);
    if (speakQueue === 0 && !busy) { setState(null); resumeRecognition(); }
  };
  synth.speak(u);
}
function stopSpeaking() { if (synth) { synth.cancel(); speakQueue = 0; } }

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
  let full = "", pending = "";

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
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
          // Ganze Sätze sofort vorlesen, während der Rest noch kommt
          const m = pending.match(/^([\s\S]*[.!?…:])(\s+)([\s\S]*)$/);
          if (m) { speak(m[1]); pending = m[3]; }
        } else if (type === "error") {
          throw new Error(data.message);
        }
      }
    }
    speak(pending);
    history.push({ role: "assistant", content: full });
    save();
  } catch (err) {
    el.remove();
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

// ---------- Spracheingabe ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false, wantListening = false, awaitingCommand = false;

if (!SR) {
  hint.textContent = "Dein Browser unterstützt keine Spracheingabe. Nutze Chrome oder Edge, oder tippe unten.";
  wakeToggle.disabled = true;
} else {
  rec = new SR();
  rec.lang = LANG;
  rec.interimResults = true;

  rec.onstart = () => {
    listening = true;
    if (!busy && speakQueue === 0) setState("listening", wakeToggle.checked && !awaitingCommand ? "Wartet auf „Jarvis“" : "Hört zu");
  };
  rec.onend = () => {
    listening = false;
    if (!busy && speakQueue === 0) setState(null);
    if (wantListening && wakeToggle.checked) setTimeout(resumeRecognition, 300);
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      wantListening = false; wakeToggle.checked = false;
      addMsg("error", "Mikrofonzugriff verweigert. Bitte im Browser erlauben.");
    }
  };
  rec.onresult = (e) => {
    let finalText = "", interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
    }
    if (interim) input.placeholder = interim;
    if (!finalText) return;
    input.placeholder = "Nachricht an Jarvis…";

    if (wakeToggle.checked && !awaitingCommand) {
      const m = finalText.match(/\b(jarvis|dschawis|tschawis|jarwis)\b[,.!?\s]*(.*)$/i);
      if (!m) return;
      const cmd = m[2].trim();
      if (cmd) ask(cmd);
      else { awaitingCommand = true; speak("Ja, Sir?"); }
    } else {
      awaitingCommand = false;
      ask(finalText);
    }
  };
}

function startListening() {
  if (!rec || listening) return;
  stopSpeaking();
  rec.continuous = wakeToggle.checked;
  try { rec.start(); } catch {}
}
function pauseRecognition() { if (rec && listening) { try { rec.abort(); } catch {} } }
function resumeRecognition() {
  if (rec && wantListening && wakeToggle.checked && !listening && !busy && speakQueue === 0) startListening();
}

reactor.addEventListener("click", () => {
  if (!rec) return;
  if (listening && !wakeToggle.checked) { rec.stop(); return; }
  wantListening = true;
  startListening();
});

wakeToggle.addEventListener("change", () => {
  if (wakeToggle.checked) {
    wantListening = true; awaitingCommand = false;
    pauseRecognition();
    setTimeout(startListening, 300);
    hint.textContent = "Sag „Jarvis“ und dann deine Frage, z. B. „Jarvis, wie spät ist es?“";
  } else {
    wantListening = false; pauseRecognition();
    hint.textContent = "Klicke auf den Reaktor oder drücke die Leertaste, um zu sprechen.";
  }
});

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && document.activeElement !== input) {
    e.preventDefault();
    reactor.click();
  }
  if (e.key === "Escape") stopSpeaking();
});
