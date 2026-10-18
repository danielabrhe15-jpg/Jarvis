"""Tigrinya (Ge'ez-Schrift) in lateinische Lautschrift umschreiben, z. B. „ከመይ ኣለኻ“ → „kemey alekha“.

So kann eine deutsche oder englische Fish-Audio-Stimme Tigrinya flüssig vorlesen.
Nur Standardbibliothek, läuft mit jedem python3.

  python3 romanize.py "ከመይ ኣለኻ"   → kemey alekha
  python3 romanize.py --serve      → liest JSON-Zeilen {"id":…, "text":…} von stdin (für server.js)
"""
import json
import re
import sys

# ---------- Zahlen ----------
# Jarvis schreibt Zahlen bewusst als Ziffern, weil das Sprachmodell beim
# Ausschreiben oft Fehler macht; hier wird es zuverlässig auf Tigrinya umgewandelt.
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


# ---------- Lautschrift ----------
# Jede Zeile der Ge'ez-Schrift hat 8 Zeichen: ein Konsonant mit 7 Vokalen (+ „wa“-Form).
# Die Schreibweise ist so gewählt, dass eine deutsche oder englische Stimme sie richtig liest.
CONSONANTS = {
    0x1200: "h", 0x1208: "l", 0x1210: "h", 0x1218: "m", 0x1220: "s", 0x1228: "r", 0x1230: "s",
    0x1238: "sh", 0x1240: "k", 0x1250: "kh", 0x1260: "b", 0x1268: "v", 0x1270: "t", 0x1278: "ch",
    0x1280: "h", 0x1290: "n", 0x1298: "ny", 0x12A0: "", 0x12A8: "k", 0x12B8: "kh", 0x12C8: "w",
    0x12D0: "", 0x12D8: "z", 0x12E0: "zh", 0x12E8: "y", 0x12F0: "d", 0x12F8: "d", 0x1300: "j",
    0x1308: "g", 0x1318: "ng", 0x1320: "t", 0x1328: "ch", 0x1330: "p", 0x1338: "ts", 0x1340: "ts",
    0x1348: "f", 0x1350: "p",
}
# Zeilen mit „w“-Laut (ቈ ቊ ቋ ቌ ቍ …): andere Belegung der 8 Plätze
LABIAL = {0x1248: "kw", 0x1258: "khw", 0x1288: "hw", 0x12B0: "kw", 0x12C0: "khw", 0x1310: "gw"}
VOWELS = ["e", "u", "i", "a", "e", None, "o", "wa"]  # Platz 6 (None) = kein oder kurzer Vokal
LABIAL_VOWELS = ["e", None, "i", "a", "e", None, None, None]  # Platz 1 und 5: ohne Vokal
PUNCT = {"።": ".", "፣": ",", "፤": ";", "፥": ":", "፦": ":", "፧": "?", "፡": " ", "፠": " "}


def _syllable(ch):
    """Gibt (Konsonant, Vokal) zurück, Vokal None = 6. Form; oder None, wenn kein Ge'ez-Zeichen."""
    cp = ord(ch)
    if not 0x1200 <= cp <= 0x135A:
        return None
    row, pos = cp - (cp - 0x1200) % 8, (cp - 0x1200) % 8
    if row in LABIAL:
        return LABIAL[row], LABIAL_VOWELS[pos]
    if row in CONSONANTS:
        return CONSONANTS[row], VOWELS[pos]
    return None


def romanize(text: str) -> str:
    """Ge'ez-Schrift → lateinische Lautschrift. Lateinische Wörter und Satzzeichen bleiben."""
    text = numbers_to_words(text)
    out, prev_bare = [], False
    chars = list(text)
    for i, ch in enumerate(chars):
        if ch in PUNCT:
            out.append(PUNCT[ch])
            prev_bare = False
            continue
        syl = _syllable(ch)
        if syl is None:
            out.append(ch)
            prev_bare = False
            continue
        cons, vowel = syl
        if vowel is not None:
            out.append(cons + vowel)
            prev_bare = False
            continue
        # 6. Form: bei Kehllauten (እ, ዕ) immer „i“. Sonst „i“ nur am Wortanfang oder nach einem
        # Konsonanten ohne Vokal, damit keine unaussprechbaren Konsonantenhaufen entstehen
        nxt = chars[i + 1] if i + 1 < len(chars) else " "
        word_start = i == 0 or _syllable(chars[i - 1]) is None
        word_end = _syllable(nxt) is None
        if cons == "":
            out.append("i")
            prev_bare = False
        elif not word_end and (word_start or prev_bare):
            out.append(cons + "i")
            prev_bare = False
        else:
            out.append(cons)
            prev_bare = True
    result = "".join(out)
    result = re.sub(r"(?<=[aeiou])(?=[aeiou])", "'", result)  # zwei Vokale hintereinander trennen
    return re.sub(r"[ \t]+", " ", result).strip()


def _serve():
    for line in sys.stdin:
        try:
            req = json.loads(line)
            res = {"id": req.get("id"), "text": romanize(str(req.get("text", "")))}
        except Exception as e:  # noqa: BLE001
            res = {"id": None, "error": str(e)}
        sys.stdout.write(json.dumps(res, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    if sys.argv[1:] == ["--serve"]:
        _serve()
    else:
        print(romanize(" ".join(sys.argv[1:]) or sys.stdin.read()))
