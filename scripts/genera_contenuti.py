#!/usr/bin/env python3
"""Scrive nelle pagine le foto che il cliente cambia dall'area riservata.

- data/gallerie.json: le gallerie «Gli album della linea» (e «I modelli», «Le fotografie»):
  per ogni pagina un elenco di {foto, titolo, alt?, provvisoria?} nell'ordine scelto.
  Vanno fra <!-- galleria:inizio --> e <!-- galleria:fine --> della pagina (quel tratto non
  si modifica a mano). Se «alt» manca si scrive «Modello <titolo> della Linea …».
  «provvisoria» è la foto mostrata finché il file vero non c'è (data-fallback).
- data/immagini.json: le immagini fisse; ogni <img data-slot="id"> prende foto e testo
  alternativo (e data-fallback se la voce ha «provvisoria»).
- data/testi.json: i testi delle pagine; ogni elemento con data-testo="id" prende il suo testo.
  tipo «testo»: si riscrive tutto il contenuto dell'elemento, con queste regole:
      a capo = <br>, **parole** = grassetto, ==parole== = evidenziato, `parole` = codice,
      [parole](indirizzo) = testo cliccabile (non dentro un elemento che è già un link).
  tipo «semplice»: si cambia solo il testo dell'elemento e restano com'erano le parti fisse
      (icone, frecce, numeri, campi del modulo); niente regole, una sola riga.
  Se la voce ha «link» l'elemento è un <a> e il suo href diventa quell'indirizzo.

Uso:  python3 scripts/genera_contenuti.py           (scrive i file)
      python3 scripts/genera_contenuti.py --check   (esce con errore se i file non sono aggiornati)
"""
import html, json, os, re, sys

RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INIZIO, FINE = "<!-- galleria:inizio -->", "<!-- galleria:fine -->"

# galleria (= nome della pagina senza .html) → linea per il testo alternativo e se ha la didascalia.
# Le stesse gallerie sono in area-riservata.html (GALLERIE).
GALLERIE = {
    "linea-fashion": ("Linea Fashion", True),
    "linea-glamour": ("Linea Glamour", True),
    "linea-trendy": ("Linea Trendy", True),
    "linea-cuoio-fiorentino": ("Linea Cuoio Fiorentino", True),
    "album-bambini-deluxe": ("Linea Deluxe", True),
    "album-bambini-baby": ("Linea Baby", True),
    "album-bambini-new-born": ("Linea New Born", True),
    "album-comunione": ("Linea Comunione", True),
    "album-eventi": (None, False),  # foto di eventi: niente didascalia, il titolo fa da testo alternativo
}


def att(t): return html.escape(t, quote=True)
def txt(t): return html.escape(t, quote=False)
def esiste(foto): return os.path.exists(os.path.join(RADICE, foto.split("?")[0]))


def alt_predefinito(titolo, linea):
    if not linea:
        return titolo
    modello = titolo if titolo.lower().startswith("modello") else "Modello " + titolo
    return f"{modello} della {linea}"


def righe_galleria(nome, voci, rientro):
    linea, didascalia = GALLERIE[nome]
    righe = []
    for n, v in enumerate(voci, 1):
        foto = str(v.get("foto") or "").strip().lstrip("/")
        titolo = str(v.get("titolo") or "").strip()
        prov = str(v.get("provvisoria") or "").strip().lstrip("/")
        if not foto or not titolo:
            print(f"avviso: {nome} n. {n} saltata (manca la foto o il titolo)", file=sys.stderr)
            continue
        if not esiste(foto) and not (prov and esiste(prov)):
            print(f"avviso: {nome} n. {n} saltata, la foto {foto} non esiste", file=sys.stderr)
            continue
        alt = str(v.get("alt") or "").strip() or alt_predefinito(titolo, linea)
        fb = f' data-fallback="{att(prov)}"' if prov else ""
        cap = f"<figcaption>{txt(titolo)}</figcaption>" if didascalia else ""
        righe.append(f'{rientro}<figure class="ph"><img src="{att(foto)}"{fb} alt="{att(alt)}" loading="lazy">{cap}</figure>')
    return righe


def gallerie(pagine):
    with open(os.path.join(RADICE, "data", "gallerie.json"), encoding="utf-8") as f:
        dati = json.load(f)
    for nome, voci in dati.items():
        if nome not in GALLERIE:
            print(f"avviso: galleria sconosciuta {nome}", file=sys.stderr)
            continue
        pagina = nome + ".html"
        s = pagine.leggi(pagina)
        a, b = s.index(INIZIO), s.index(FINE)
        rientro = s[s.rfind("\n", 0, a) + 1:a]
        a += len(INIZIO)
        nuovo = s[:a] + "\n" + "\n".join(righe_galleria(nome, voci, rientro)) + "\n" + rientro + s[b:]
        pagine.scrivi(pagina, nuovo)


def immagini(pagine):
    with open(os.path.join(RADICE, "data", "immagini.json"), encoding="utf-8") as f:
        voci = json.load(f)
    for v in voci:
        foto = str(v.get("foto") or "").strip().lstrip("/")
        prov = str(v.get("provvisoria") or "").strip().lstrip("/")
        if not foto or (not esiste(foto) and not (prov and esiste(prov))):
            print(f"avviso: immagine {v.get('id')} saltata, la foto {foto} non esiste", file=sys.stderr)
            continue
        nome = v["pagina"]
        s = pagine.leggi(nome)
        segno = f'<img data-slot="{v["id"]}" '
        a = s.find(segno)
        if a < 0:
            print(f"avviso: in {nome} manca l'immagine {v['id']}", file=sys.stderr)
            continue
        b = s.index(">", a)
        tag = s[a:b]
        tag = re.sub(r' src="[^"]*"', f' src="{att(foto)}"', tag, count=1)
        tag = re.sub(r' alt="[^"]*"', f' alt="{att(str(v.get("alt") or "").strip())}"', tag, count=1)
        if prov:
            if " data-fallback=" in tag:
                tag = re.sub(r' data-fallback="[^"]*"', f' data-fallback="{att(prov)}"', tag, count=1)
            else:
                tag = tag.replace(' alt="', f' data-fallback="{att(prov)}" alt="', 1)
        else:
            tag = re.sub(r' data-fallback="[^"]*"', "", tag, count=1)
        pagine.scrivi(nome, s[:a] + tag + s[b:])


LINK_VALIDO = re.compile(r"^(https?://[^\s<>\"']+|mailto:[^\s<>\"']+|tel:\+?[0-9 ()./-]+|#[A-Za-z0-9_-]*|(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._/-]*(#[A-Za-z0-9_-]*)?)$")
MARCHE = re.compile(r"\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*(.+?)\*\*|==(.+?)==|`(.+?)`", re.S)


def link_ok(u): return bool(LINK_VALIDO.match(u or ""))


def attributi_link(u):
    if u.startswith(("mailto:", "tel:", "#")):
        return ""
    return ' target="_blank" rel="noopener noreferrer"' if u.startswith("http") else ' target="_blank"'


def html_testo(t, link_ammessi=True):
    """testo con le regole (**grassetto**, [testo](link), a capo…) → HTML sicuro"""
    out, i = [], 0
    for m in MARCHE.finditer(t):
        out.append(txt(t[i:m.start()]).replace("\n", "<br>"))
        testo_link, url, gr, ev, cod = m.groups()
        if testo_link is not None:
            dentro = html_testo(testo_link, False)
            out.append(f'<a href="{att(url)}"{attributi_link(url)}>{dentro}</a>' if link_ammessi and link_ok(url) else txt(m.group(0)))
        elif gr is not None:
            out.append(f"<strong>{html_testo(gr, link_ammessi)}</strong>")
        elif ev is not None:
            out.append(f"<mark>{html_testo(ev, link_ammessi)}</mark>")
        else:
            out.append(f"<code>{txt(cod)}</code>")
        i = m.end()
    out.append(txt(t[i:]).replace("\n", "<br>"))
    return "".join(out)


VUOTI = {"br", "img", "input", "meta", "link", "hr", "source", "wbr", "path", "circle", "rect"}
ETICHETTA = re.compile(r"<(/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(/?)>|<!--.*?-->", re.S)


def elemento(s, vid):
    """posizioni di <tag data-testo="vid" …>contenuto</tag>: (inizio, inizio contenuto, fine contenuto, nome)"""
    k = s.find(f' data-testo="{vid}"')
    if k < 0:
        return None
    a = s.rfind("<", 0, k)
    nome = re.match(r"<([a-zA-Z0-9]+)", s[a:]).group(1).lower()
    c = s.index(">", k) + 1
    prof = 1
    for m in ETICHETTA.finditer(s, c):
        if m.group(2) is None or m.group(2).lower() != nome or m.group(2).lower() in VUOTI or m.group(3):
            continue
        prof += -1 if m.group(1) else 1
        if prof == 0:
            return a, c, m.start(), nome
    return None


def solo_testo_diretto(contenuto, nuovo):
    """sostituisce l'unico pezzo di testo diretto (non dentro altri elementi) tenendo gli spazi attorno"""
    pezzi, prof, i = [], 0, 0
    for m in ETICHETTA.finditer(contenuto):
        if prof == 0 and contenuto[i:m.start()].strip():
            pezzi.append((i, m.start()))
        if m.group(2) and m.group(2).lower() not in VUOTI and not m.group(3):
            prof += -1 if m.group(1) else 1
        i = m.end()
    if prof == 0 and contenuto[i:].strip():
        pezzi.append((i, len(contenuto)))
    if len(pezzi) != 1:
        return None
    a, b = pezzi[0]
    vecchio = contenuto[a:b]
    prima = vecchio[:len(vecchio) - len(vecchio.lstrip())]
    dopo = vecchio[len(vecchio.rstrip()):]
    return contenuto[:a] + prima + txt(nuovo) + dopo + contenuto[b:]


def testi(pagine):
    with open(os.path.join(RADICE, "data", "testi.json"), encoding="utf-8") as f:
        voci = json.load(f)
    for v in voci:
        nome, vid = v["pagina"], v["id"]
        t = str(v.get("testo") or "").replace("\r\n", "\n").strip()
        if not t:
            print(f"avviso: testo {vid} vuoto, lasciato com'era", file=sys.stderr)
            continue
        s = pagine.leggi(nome)
        pos = elemento(s, vid)
        if not pos:
            print(f"avviso: in {nome} manca il testo {vid}", file=sys.stderr)
            continue
        a, c, e, tag = pos
        if v.get("tipo") == "semplice":
            nuovo = solo_testo_diretto(s[c:e], " ".join(t.split()))
            if nuovo is None:
                print(f"avviso: testo {vid} non sostituibile", file=sys.stderr)
                continue
        else:
            nuovo = html_testo(t, tag != "a")
        apertura = s[a:c]
        if "link" in v:
            u = str(v.get("link") or "").strip()
            if link_ok(u):
                apertura = re.sub(r' href="[^"]*"', f' href="{att(u)}"', apertura, count=1)
            else:
                print(f"avviso: link non valido per {vid}: {u}", file=sys.stderr)
        pagine.scrivi(nome, s[:a] + apertura + nuovo + s[e:])


class Pagine:
    def __init__(self):
        self.testi, self.originali = {}, {}

    def leggi(self, nome):
        if nome not in self.testi:
            with open(os.path.join(RADICE, nome), encoding="utf-8") as f:
                self.testi[nome] = self.originali[nome] = f.read()
        return self.testi[nome]

    def scrivi(self, nome, testo):
        self.testi[nome] = testo

    def salva(self, controlla):
        ok = True
        for nome, testo in self.testi.items():
            if testo == self.originali[nome]:
                continue
            if controlla:
                print(f"{nome} non è aggiornato: esegui python3 scripts/genera_contenuti.py", file=sys.stderr)
                ok = False
                continue
            with open(os.path.join(RADICE, nome), "w", encoding="utf-8") as f:
                f.write(testo)
            print(f"{nome} aggiornato")
        return ok


if __name__ == "__main__":
    pagine = Pagine()
    gallerie(pagine)
    immagini(pagine)
    testi(pagine)
    sys.exit(0 if pagine.salva("--check" in sys.argv) else 1)
