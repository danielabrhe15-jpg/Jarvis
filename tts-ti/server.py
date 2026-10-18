"""Lokale Tigrinya-Stimme für Jarvis (Meta MMS-TTS, Modell facebook/mms-tts-tir).

Läuft nur auf diesem Rechner (127.0.0.1) und wird von server.js automatisch gestartet.
GET /tts?text=... liefert eine WAV-Datei.
"""
import io
import os
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np
import scipy.io.wavfile
import torch
from transformers import AutoTokenizer, VitsModel

PORT = int(os.environ.get("TTS_TI_PORT", "5055"))
MODEL_ID = "facebook/mms-tts-tir"

torch.set_num_threads(max(1, (os.cpu_count() or 4) // 2))
tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
model = VitsModel.from_pretrained(MODEL_ID).eval()
lock = threading.Lock()

uroman = None
if getattr(tokenizer, "is_uroman", False):
    # Manche MMS-Modelle erwarten lateinische Umschrift statt der Ge'ez-Schrift
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "uroman-src"))
    import uroman as ur

    uroman = ur.Uroman()


# Zahlen auf Tigrinya ausschreiben (die Stimme kann keine Ziffern lesen).
# Jarvis schreibt Zahlen bewusst als Ziffern, weil das Sprachmodell beim
# Ausschreiben oft Fehler macht; hier wird es zuverlässig umgewandelt.
ONES = ["", "ሓደ", "ክልተ", "ሰለስተ", "ኣርባዕተ", "ሓሙሽተ", "ሽዱሽተ", "ሸውዓተ", "ሸሞንተ", "ትሽዓተ"]
TENS = ["", "ዓሰርተ", "ዕስራ", "ሰላሳ", "ኣርብዓ", "ሓምሳ", "ሱሳ", "ሰብዓ", "ሰማንያ", "ቴስዓ"]


def _join(parts):
    # Mehrteilige Zahlen werden mit „-ን“ verbunden: 25 = ዕስራን ሓሙሽተን
    return parts[0] if len(parts) == 1 else " ".join(p + "ን" for p in parts)


def num_to_ti(n: int) -> str:
    if n == 0:
        return "ዜሮ"
    if n >= 1_000_000:
        return " ".join(ONES[int(d)] or "ዜሮ" for d in str(n))  # sehr große Zahlen Ziffer für Ziffer
    parts = []
    if n >= 1000:
        k = n // 1000
        parts.append("ሽሕ" if k == 1 else f"{num_to_ti(k)} ሽሕ")
        n %= 1000
    if n >= 100:
        h = n // 100
        parts.append("ሚእቲ" if h == 1 else f"{ONES[h]} ሚእቲ")
        n %= 100
    if n >= 10:
        parts.append(TENS[n // 10])
        n %= 10
    if n:
        parts.append(ONES[n])
    return _join(parts)


def numbers_to_words(text: str) -> str:
    text = re.sub(r"\s*°\s*C?", " ዲግሪ", text)
    text = re.sub(r"(\d{1,2}):(\d{2})", lambda m: f"{num_to_ti(int(m.group(1)))} ሰዓት" + (f" {num_to_ti(int(m.group(2)))} ደቒቕ" if int(m.group(2)) else ""), text)
    text = re.sub(r"(\d+)[.,](\d+)", lambda m: f"{num_to_ti(int(m.group(1)))} ነጥቢ {' '.join(num_to_ti(int(d)) for d in m.group(2))}", text)
    text = re.sub(r"(\d+)\s*%", lambda m: f"{num_to_ti(int(m.group(1)))} ሚእታዊት", text)
    return re.sub(r"\d+", lambda m: num_to_ti(int(m.group(0))), text)


def synth(text: str) -> bytes:
    # Nur Ge'ez-, lateinische Buchstaben, Ziffern und Satzzeichen behalten
    text = re.sub(r"[^ሀ-᎟ⶀ-⷟A-Za-zÄÖÜäöüß0-9\s.,!?:;%°'\-፡።፣፤፥፦፧]", "", text)
    text = numbers_to_words(text)
    if uroman:
        text = uroman.romanize_string(text)
    inputs = tokenizer(text, return_tensors="pt")
    with lock, torch.no_grad():
        wav = model(**inputs).waveform[0].numpy()
    pcm = (np.clip(wav, -1, 1) * 32767).astype(np.int16)
    buf = io.BytesIO()
    scipy.io.wavfile.write(buf, model.config.sampling_rate, pcm)
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/health":
            return self._send(200, b"ok", "text/plain")
        if url.path != "/tts":
            return self._send(404, b"not found", "text/plain")
        text = (parse_qs(url.query).get("text") or [""])[0].strip()[:1000]
        if not text:
            return self._send(400, b"kein Text", "text/plain")
        try:
            self._send(200, synth(text), "audio/wav")
        except Exception as e:  # noqa: BLE001
            self._send(500, str(e).encode(), "text/plain")

    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


if __name__ == "__main__":
    print(f"Tigrinya-Stimme bereit auf 127.0.0.1:{PORT}", file=sys.stderr, flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
