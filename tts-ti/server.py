"""Tigrinya-Stimme für Jarvis. Läuft nur auf diesem Rechner (127.0.0.1) und wird von
server.js automatisch gestartet.

GET /fish?text=...  Tigrinya → lateinische Lautschrift (romanize.py) → Fish Audio
                    (s2.1-pro-free, latency „balanced“), MP3 wird direkt weitergestreamt
GET /tts?text=...   lokale Stimme von Meta (MMS-TTS, facebook/mms-tts-tir), WAV;
                    dient als Ausweichlösung, wenn Fish Audio nicht erreichbar ist
GET /romanize?text= nur die Lautschrift (zum Testen)
"""
import asyncio
import io
import os
import sys

import aiohttp
from aiohttp import web

from romanize import clean, numbers_to_words, romanize_tigrinya

PORT = int(os.environ.get("TTS_TI_PORT", "5055"))
FISH_KEY = os.environ.get("FISH_API_KEY", "")
FISH_MODEL = os.environ.get("FISH_MODEL", "s2.1-pro-free")
FISH_VOICE = os.environ.get("FISH_VOICE_ID") or None
# Lautschrift passend zur Basisstimme: "de" für deutsche Stimmen (sch, ch, z …), "en" für englische
TI_STYLE = os.environ.get("TI_ROMAN_STYLE", "de")


def speakable(text: str, style: str = TI_STYLE) -> str:
    """Tigrinya-Antwort → Text, den eine deutsche/englische Stimme flüssig vorlesen kann."""
    return romanize_tigrinya(numbers_to_words(clean(text)), style)


# ---------- Fish Audio (asynchron) ----------
session = None


async def fish(request: web.Request) -> web.StreamResponse:
    text = request.query.get("text", "").strip()[:1000]
    if not text:
        return web.Response(status=400, text="kein Text")
    if not FISH_KEY:
        return web.Response(status=503, text="FISH_API_KEY fehlt")
    style = request.query.get("style", TI_STYLE)
    voice = request.query.get("voice") or FISH_VOICE
    speed = request.query.get("speed")
    body = {
        "text": speakable(text, style),
        "reference_id": voice,
        "format": "mp3",
        "latency": "balanced",
        "language": "de" if style == "de" else "en",
    }
    if speed:
        body["prosody"] = {"speed": max(0.7, min(1.5, float(speed)))}
    headers = {"Authorization": f"Bearer {FISH_KEY}", "model": FISH_MODEL}
    try:
        async with session.post("https://api.fish.audio/v1/tts", json=body, headers=headers,
                                timeout=aiohttp.ClientTimeout(total=30)) as r:
            if r.status != 200:
                return web.Response(status=502, text=f"Fish Audio: HTTP {r.status} {(await r.text())[:200]}")
            # Audio weiterreichen, sobald die ersten Bytes da sind (Browser spielt sofort ab)
            out = web.StreamResponse(headers={"Content-Type": "audio/mpeg", "X-Romanized": body["text"].encode("ascii", "replace").decode()})
            await out.prepare(request)
            async for chunk in r.content.iter_chunked(4096):
                await out.write(chunk)
            await out.write_eof()
            return out
    except (aiohttp.ClientError, asyncio.TimeoutError) as e:
        return web.Response(status=502, text=f"Fish Audio nicht erreichbar: {e}")


async def romanize(request: web.Request) -> web.Response:
    text = request.query.get("text", "")
    return web.json_response({"de": speakable(text, "de"), "en": speakable(text, "en")})


# ---------- Lokale Ausweich-Stimme (Meta MMS-TTS) ----------
# Wird erst beim ersten Bedarf geladen, damit der Start schnell geht.
_mms = None
_mms_lock = asyncio.Lock()


def _load_mms():
    import torch
    from transformers import AutoTokenizer, VitsModel

    torch.set_num_threads(max(1, (os.cpu_count() or 4) // 2))
    tok = AutoTokenizer.from_pretrained("facebook/mms-tts-tir")
    model = VitsModel.from_pretrained("facebook/mms-tts-tir").eval()
    uroman = None
    if getattr(tok, "is_uroman", False):
        # Das MMS-Modell erwartet die wissenschaftliche Umschrift von uroman
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "uroman-src"))
        import uroman as ur

        uroman = ur.Uroman()
    return torch, tok, model, uroman


def _synth_mms(text: str) -> bytes:
    import numpy as np
    import scipy.io.wavfile

    torch, tok, model, uroman = _mms
    text = numbers_to_words(clean(text))
    if uroman:
        text = uroman.romanize_string(text)
    with torch.no_grad():
        wav = model(**tok(text, return_tensors="pt")).waveform[0].numpy()
    buf = io.BytesIO()
    scipy.io.wavfile.write(buf, model.config.sampling_rate, (np.clip(wav, -1, 1) * 32767).astype(np.int16))
    return buf.getvalue()


async def mms(request: web.Request) -> web.Response:
    global _mms
    text = request.query.get("text", "").strip()[:1000]
    if not text:
        return web.Response(status=400, text="kein Text")
    loop = asyncio.get_running_loop()
    async with _mms_lock:
        if _mms is None:
            _mms = await loop.run_in_executor(None, _load_mms)
        audio = await loop.run_in_executor(None, _synth_mms, text)
    return web.Response(body=audio, content_type="audio/wav")


async def health(_request):
    return web.Response(text="ok")


async def on_startup(_app):
    global session
    session = aiohttp.ClientSession()


async def on_cleanup(_app):
    await session.close()


if __name__ == "__main__":
    app = web.Application()
    app.router.add_get("/health", health)
    app.router.add_get("/fish", fish)
    app.router.add_get("/tts", mms)
    app.router.add_get("/romanize", romanize)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    print(f"Tigrinya-Stimme bereit auf 127.0.0.1:{PORT}", file=sys.stderr, flush=True)
    web.run_app(app, host="127.0.0.1", port=PORT, print=None, access_log=None)
