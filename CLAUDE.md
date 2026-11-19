# Olimp (repository «trama»)

Sito statico (HTML, CSS, JavaScript) di Olimp: album, fotolibri e prodotti per fotografi.
Dettagli completi in **LEGGIMI.txt**: leggilo prima di modifiche non banali.

- Online: https://nemesimark.github.io/trama/
- Codice: github.com/nemesiMark/trama, ramo `main`; pubblicazione con GitHub Actions (`.github/workflows/pubblica.yml`).
- Prova in locale: `python3 -m http.server 8000` → http://localhost:8000/
- Colori: blu #051D34 (`--brand`), bordeaux del logo #aa372e.

## Regole di lavoro
- Rispondi sempre in italiano; anche LEGGIMI, commenti e messaggi di commit in italiano.
- Ogni modifica va annotata in fondo a LEGGIMI.txt, sezione VERSIONI: numero successivo, data (gg/mm/aaaa), descrizione semplice. Se cambiano `css/style.css` o `js/script.js`, aggiorna il `?v=` nelle pagine.
- Niente commit/push di tua iniziativa: Mark prova prima in locale. Commit e push solo su richiesta o con «g».
- «g» = commit e push: `git pull --rebase --autostash`, poi `python3 scripts/genera_contenuti.py` (riallinea le pagine ai salvataggi del cliente) e solo dopo `--check`; `git add -A`, commit in italiano (cita le pagine riallineate), `git push`; attendi GitHub Actions e verifica.

## Area riservata e contenuti
- Il cliente salva `data/testi.json`, `data/immagini.json`, `data/gallerie.json` dall'area riservata (`area-riservata.html` + Worker in `worker/`): fai sempre `git pull` prima di lavorare.
- Testi con `data-testo`, foto con `data-slot` e gallerie si cambiano nei JSON, **non nell'HTML**: il generatore li riscrive.
- Ogni foto/video/testo è indipendente: modificare una sezione non deve mai toccare altre sezioni o pagine (unica eccezione: i sottomenu della navbar).
- È il modello della skill `crea-area-riservata` e della mappa «Dove siamo» (`mappa-uni`; transizioni centrate come Rain Ink 6.17 dalla versione 3.32): una miglioria qui va riportata anche nelle skill e, se serve, in inkubo.

## Foto del cliente
- Foto in `images/<nome-pagina>/`, nomi minuscoli col nome del modello (es. `modello-frame.jpg`), ridotte a 1600 px qualità 80 (`sips`); mai inventare nomi di modelli.
- Originali del cliente in `~/Downloads/myairbridge-S38vTvYGSUj/`. Non creare cartelle sulla Scrivania.
- Foto non più usate in `images/non-usate/`.

## In sospeso
- Accesso con email + codice (Cloudflare Access) al posto della password: decide il cliente.
- privacy.html è una bozza; ragione sociale, P.IVA e PDF reali da ricevere (vedi LEGGIMI, «DA COMPLETARE»).
