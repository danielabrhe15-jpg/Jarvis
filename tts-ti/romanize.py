"""Tigrinya (Ge'ez-Schrift) → gut vorlesbare lateinische Lautschrift.

Anders als die wissenschaftliche Umschrift (uroman: „aalakxaa“) erzeugt diese Funktion
eine Schreibweise, wie Eritreer sie im Alltag benutzen und wie eine deutsche oder
englische Stimme sie flüssig vorlesen kann:

    ከመይ ኣለኻ?  →  Kemey alekha?
    ሰላም        →  Selam
    ጽቡቕ እዩ     →  tsibuk eyu
"""
import re

# Jede Zeile der Ge'ez-Schrift hat 8 Zeichen: 7 Vokal-Ordnungen + eine „wa“-Form.
# Ordnung:            1    2    3    4    5    6   7
VOWELS = ["e", "u", "i", "a", "e", "", "o"]

# Erstes Zeichen jeder Zeile → Konsonant, je nach Zielsprache der Stimme
CONSONANTS = {
    #       Englisch   Deutsch
    0x1200: ("h", "h"),     # ሀ
    0x1208: ("l", "l"),     # ለ
    0x1210: ("h", "h"),     # ሐ (Rachen-h)
    0x1218: ("m", "m"),     # መ
    0x1220: ("s", "s"),     # ሠ
    0x1228: ("r", "r"),     # ረ
    0x1230: ("s", "ss"),    # ሰ (stimmloses s)
    0x1238: ("sh", "sch"),  # ሸ
    0x1240: ("k", "k"),     # ቀ (q)
    0x1250: ("kh", "ch"),   # ቐ (wie „ach“)
    0x1260: ("b", "b"),     # በ
    0x1268: ("v", "w"),     # ቨ
    0x1270: ("t", "t"),     # ተ
    0x1278: ("ch", "tsch"), # ቸ
    0x1280: ("h", "h"),     # ኀ
    0x1290: ("n", "n"),     # ነ
    0x1298: ("ny", "nj"),   # ኘ
    0x12A8: ("k", "k"),     # ከ
    0x12B8: ("kh", "ch"),   # ኸ (wie „ach“)
    0x12C8: ("w", "w"),     # ወ
    0x12D8: ("z", "s"),     # ዘ (stimmhaftes s)
    0x12E0: ("zh", "sch"),  # ዠ
    0x12E8: ("y", "j"),     # የ
    0x12F0: ("d", "d"),     # ደ
    0x12F8: ("d", "d"),     # ዸ
    0x1300: ("j", "dsch"),  # ጀ
    0x1308: ("g", "g"),     # ገ
    0x1318: ("g", "g"),     # ጘ
    0x1320: ("t", "t"),     # ጠ
    0x1328: ("ch", "tsch"), # ጨ
    0x1330: ("p", "p"),     # ጰ
    0x1338: ("ts", "z"),    # ጸ
    0x1340: ("ts", "z"),    # ፀ
    0x1348: ("f", "f"),     # ፈ
    0x1350: ("p", "p"),     # ፐ
}
# Zeilen ohne Konsonant: አ (Kehlkopf-Einsatz) und ዐ (Rachenlaut) → nur Vokal
VOWEL_ROWS = {0x12A0, 0x12D0}
VOWEL_ROW_SIXTH = "e"  # እ / ዕ
# Zeilen mit gerundetem Konsonanten (ቈ, ኰ …): Konsonant + w
LABIAL_ROWS = {0x1248: 0x1240, 0x1258: 0x1250, 0x1288: 0x1280, 0x12B0: 0x12A8, 0x12C0: 0x12B8, 0x1310: 0x1308}

PUNCT = {"።": ".", "፣": ",", "፤": ";", "፥": ":", "፦": ":", "፧": "?", "፡": " ", "፨": "."}


def _syllable(ch: str, style: int):
    """Zerlegt ein Ge'ez-Zeichen in (Konsonant, Vokal). None, wenn es kein Ge'ez-Buchstabe ist."""
    cp = ord(ch)
    if not 0x1200 <= cp <= 0x135A:
        return None
    row, order = cp & ~7, cp & 7
    if row in VOWEL_ROWS:
        return "", (VOWEL_ROW_SIXTH if order == 5 else VOWELS[order] if order < 7 else "wa")
    if row in LABIAL_ROWS:
        base = CONSONANTS[LABIAL_ROWS[row]][style]
        return base + ("u" if style else "w"), {0: "e", 2: "i", 3: "a", 4: "e", 5: ""}.get(order, "a")
    if row not in CONSONANTS:
        return None
    cons = CONSONANTS[row][style]
    if order == 7:  # ሏ, ሟ … = Konsonant + wa
        return cons, ("ua" if style else "wa")
    return cons, VOWELS[order]


def romanize_tigrinya(text: str, style: str = "en") -> str:
    """Wandelt Tigrinya-Text in lateinische Lautschrift um.

    style="en": eritreische Alltagsschreibweise (für englische/multilinguale Stimmen)
    style="de": deutsche Lautschrift (sch, ch, z …) für deutsche Stimmen
    Lateinische Wörter (z. B. Ortsnamen) und Zahlen bleiben unverändert.
    """
    st = 1 if style == "de" else 0
    out = []
    chars = list(text)
    for i, ch in enumerate(chars):
        if ch in PUNCT:
            out.append(PUNCT[ch])
            continue
        syl = _syllable(ch, st)
        if syl is None:
            out.append(ch)
            continue
        cons, vowel = syl
        if vowel == "" and cons:
            # 6. Ordnung = Konsonant ohne Vokal. Am Wortanfang oder zwischen zwei Konsonanten
            # sprechen Tigrinya-Sprecher ein kurzes „i“ (ጽቡቕ = tsibuk, ሕጂ = hiji),
            # sonst bleibt der Konsonant allein (ሰላም = selam, ከመይ = kemey).
            nxt = _syllable(chars[i + 1], st) if i + 1 < len(chars) else None
            prev_is_vowel = bool(out) and out[-1][-1:].lower() in "aeiou"
            word_start = not out or not out[-1][-1:].isalpha()
            if nxt is not None and nxt[0] and (word_start or not prev_is_vowel):
                vowel = "i"
        out.append(cons + vowel)
    result = "".join(out)
    if st:
        result = re.sub(r"\bss", "s", result)  # deutsch: „ss“ nur im Wort, am Anfang reicht „s“
    result = re.sub(r"\s+([.,;:?!])", r"\1", result)
    result = re.sub(r"\s{2,}", " ", result).strip()
    # Satzanfänge groß schreiben, das hilft der Stimme bei der Betonung
    return re.sub(r"(^|[.?!]\s+)([a-zäöü])", lambda m: m.group(1) + m.group(2).upper(), result)


# ---------- Zahlen auf Tigrinya ----------
# Jarvis schreibt Zahlen bewusst als Ziffern (das Sprachmodell übersetzt Zahlen oft falsch);
# hier werden sie zuverlässig in Tigrinya-Wörter umgewandelt.
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
    text = re.sub(r"ሰዓት\s*(?=\d{1,2}:\d{2})", "", text)  # „ሰዓት 21:53“ nicht doppelt „Uhr“ sagen
    text = re.sub(r"(\d{1,2}):(\d{2})", lambda m: f"{num_to_ti(int(m.group(1)))} ሰዓት" + (f" {num_to_ti(int(m.group(2)))} ደቒቕ" if int(m.group(2)) else ""), text)
    text = re.sub(r"(\d+)[.,](\d+)", lambda m: f"{num_to_ti(int(m.group(1)))} ነጥቢ {' '.join(num_to_ti(int(d)) for d in m.group(2))}", text)
    text = re.sub(r"(\d+)\s*%", lambda m: f"{num_to_ti(int(m.group(1)))} ሚእታዊት", text)
    return re.sub(r"\d+", lambda m: num_to_ti(int(m.group(0))), text)


def clean(text: str) -> str:
    """Nur Ge'ez-, lateinische Buchstaben, Ziffern und Satzzeichen behalten."""
    # Abkürzungen mit Punkten wie „እ.ኤ.አ.“ (Zeitrechnung) würden als „Punkt Punkt“ vorgelesen
    text = re.sub(r"(?:[ሀ-፿]\.){2,}", "", text)
    return re.sub(r"[^ሀ-᎟ⶀ-⷟A-Za-zÄÖÜäöüß0-9\s.,!?:;%°'\-፡።፣፤፥፦፧]", "", text)


if __name__ == "__main__":
    for t in ["ከመይ ኣለኻ?", "ሰላም፡ ሎሚ ኣየር ጽቡቕ እዩ።", "ሕጂ ሰዓት 20:42 እዩ፣ ሸፍ።", "እንታይ ደሊኻ?", "ኣብ Berlin ዝለዓለ ሙቐት 12 °C እዩ።", "እወ ሸፍ?", "የቐንየለይ"]:
        print(t, "→", romanize_tigrinya(numbers_to_words(t)), "|", romanize_tigrinya(numbers_to_words(t), "de"))
