# Olimp (cartella e repository «olimp», prima «trama»)

Sito statico (HTML, CSS, JavaScript) di Olimp: album, fotolibri e prodotti per fotografi.
Dettagli completi in **LEGGIMI.txt**: leggilo prima di modifiche non banali.

- Online: https://nemesimark.github.io/olimp/
- Codice: github.com/nemesiMark/olimp, ramo `main`; pubblicazione con GitHub Actions (`.github/workflows/pubblica.yml`).
- Prova in locale: `python3 -m http.server 8000` → http://localhost:8000/
- Stile chiaro dalla versione 3.44 (prima «Galleria notturna» blu, 3.36-3.43): fondi avorio #FAF6EE (`--wall`), beige #F3ECE0 (`--wall-2`) e beige-tortora #EEE4D4 (`--night`, il nome è rimasto), testi marrone scuro #3A2E24 (`--ink`), bordeaux del logo #AA372E (`--ribbon`) solo per pulsanti e linee; tutto in Inter Tight con titoli in grassetto e base del testo a 18 px (dalla 3.49-3.50; prima Playfair Display e Lato, e ancora prima Gloock e Hanken Grotesk). I colori stanno nel blocco «RESTYLING 4.0» in fondo a `css/style.css` (e la barra dei cookie in `js/cookie.js`).
- Hero della home (2 foto che scorrono, dalla 3.46): tutto nel blocco «HERO DELLA HOME (3.41)», l'ultimo di `css/style.css`. Scritte e album stanno in due zone separate (affiancate su schermi larghi, album sopra su schermi stretti o verticali); ogni foto si posiziona da sola in base a `--r` e al riquadro dell'album (`--ax0 --ay0 --ax1 --ay1`). Dopo ogni modifica controllare molte misure di schermo (telefono, tablet, portatile, monitor larghi).

## Regole di lavoro
- Rispondi sempre in italiano; anche LEGGIMI, commenti e messaggi di commit in italiano.
- Ogni modifica va annotata in fondo a LEGGIMI.txt, sezione VERSIONI: numero successivo, data (gg/mm/aaaa), descrizione semplice. Se cambiano `css/style.css` o `js/script.js`, aggiorna il `?v=` nelle pagine.
- Niente commit/push di tua iniziativa: Mark prova prima in locale. Commit e push solo su richiesta o con «g».
- «g» = commit e push: `git pull --rebase --autostash`, poi `python3 scripts/genera_contenuti.py` (riallinea le pagine ai salvataggi del cliente) e solo dopo `--check`; `git add -A`, commit in italiano (cita le pagine riallineate), `git push`; attendi GitHub Actions e verifica.

## Area riservata e contenuti
- Il cliente salva `data/testi.json`, `data/immagini.json`, `data/gallerie.json` dall'area riservata (`area-riservata.html` + Worker in `worker/`): fai sempre `git pull` prima di lavorare.
- Testi con `data-testo`, foto con `data-slot` e gallerie si cambiano nei JSON, **non nell'HTML**: il generatore li riscrive.
- Ogni foto/video/testo è indipendente: modificare una sezione non deve mai toccare altre sezioni o pagine (unica eccezione: i sottomenu della navbar).
- È il modello della skill `area-ris` e della mappa «Dove siamo» (`mappa-uni`; dalla versione 3.34 la mappa è come Rain Ink 6.26, che resta la sorgente della skill): una miglioria qui va riportata anche nelle skill e, se serve, in Rain Ink (~/Documents/work/Sites/rainInk).

## Foto del cliente
- Foto in `images/<nome-pagina>/`, nomi minuscoli col nome del modello (es. `modello-frame.jpg`), ridotte a 1600 px qualità 80 (`sips`); mai inventare nomi di modelli.
- Originali del cliente in `~/Downloads/myairbridge-S38vTvYGSUj/`. Non creare cartelle sulla Scrivania.
- Foto non più usate in `images/non-usate/`.

## Pagine non online (dalla 3.53)
- Prodotti per lo studio, Custodie, Linea New Born, Album eventi e Area download restano nel repository ma non si pubblicano: elenco in `scripts/non-online.txt`, link commentati con «NON ONLINE (3.53)», testi con «nascosto» in `data/testi.json`. L'area download si apre solo dall'area riservata.

## In sospeso
- Foto del fotolibro professionale: il cliente pensa di averle mandate, Mark deve recuperarle.
- Accesso con email + codice (Cloudflare Access) al posto della password: decide il cliente.
- privacy.html è una bozza; ragione sociale, P.IVA e PDF reali da ricevere (vedi LEGGIMI, «DA COMPLETARE»).
