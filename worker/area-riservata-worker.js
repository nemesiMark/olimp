/**
 * Olimp — servizio dell'area riservata (Cloudflare Worker).
 *
 * Fa da ponte fra la pagina area-riservata.html e il repository GitHub del sito:
 * controlla la password, poi legge e salva data/gallerie.json (le gallerie degli album di
 * ogni linea), data/immagini.json (le immagini fisse delle pagine), data/testi.json (i testi
 * delle pagine, compresi i testi cliccabili e i loro indirizzi) e le foto caricate in
 * images/caricate/, con un solo commit per ogni salvataggio. GitHub Actions ripubblica il
 * sito da solo (scripts/genera_contenuti.py scrive le foto nelle pagine).
 *
 * Impostazioni del Worker (Cloudflare → Workers → questo Worker → Settings → Variables):
 *   Secret  ADMIN_PASSWORD   password dell'area riservata (scelta col cliente)
 *   Secret  SESSION_SECRET   stringa casuale lunga, serve a firmare l'accesso
 *   Secret  GITHUB_TOKEN     token "fine-grained" solo per il repository trama,
 *                            permesso Contents: Read and write
 *   Text    REPO             nemesiMark/trama
 *   Text    BRANCH           main
 *   Text    ORIGINS          https://nemesimark.github.io  (più indirizzi separati da virgola)
 * Per il cambio password dall'area riservata (Settings → Bindings → KV namespace):
 *   KV      DATI             un namespace KV (es. «olimp-area-riservata»). Lì si salva
 *                            l'impronta della password nuova (PBKDF2, mai la password in
 *                            chiaro). Finché nessuno la cambia vale ADMIN_PASSWORD.
 *                            Nello stesso KV si contano i tentativi sbagliati: dopo 5 errori
 *                            l'area riservata si blocca per tutti per 15 minuti.
 * Nessuna chiave è scritta in questo file.
 */

const FILE_GALLERIE = "data/gallerie.json";
const FILE_IMMAGINI = "data/immagini.json";
const FILE_TESTI = "data/testi.json";
const MAX_TESTO = 4000;
// indirizzi ammessi per i testi cliccabili (gli stessi di scripts/genera_contenuti.py)
const LINK_VALIDO = /^(https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+|tel:\+?[0-9 ()./-]+|#[A-Za-z0-9_-]*|(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._\/-]*(#[A-Za-z0-9_-]*)?)$/;
const LINK_NEL_TESTO = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
// grassetto, evidenziato, codice e link nel testo (le stesse regole di genera_contenuti.py)
const MARCHE = /\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([\s\S]+?)\*\*|==([\s\S]+?)==|`([\s\S]+?)`/g;
// la formattazione di un testo (quali parti sono in grassetto, evidenziate, cliccabili e dove portano):
// dall'area riservata si cambiano solo le parole, la formattazione deve restare uguale
function formattazione(t) {
  const out = [];
  for (const m of t.matchAll(MARCHE))
    out.push(m[1] != null ? `L${m[2]}(${formattazione(m[1])})` : m[3] != null ? `B(${formattazione(m[3])})` : m[4] != null ? `M(${formattazione(m[4])})` : "C");
  return out.join(",");
}
const CARTELLA_FOTO = "images/caricate/";
const MAX_FOTO_BYTES = 4 * 1024 * 1024;   // dopo il ridimensionamento nel browser sono ~0,3–0,6 MB
const MAX_FOTO_PER_SALVATAGGIO = 12;
const MAX_PER_GALLERIA = 80;
const DURATA_ACCESSO_S = 30 * 24 * 3600;  // 30 giorni
const PW_ITERAZIONI = 100000;              // massimo consentito da Cloudflare per PBKDF2
const PW_MIN = 8, PW_MAX = 128;
// foto del sito: una cartella di images/ (non guida e non-usate), anche con una sottocartella
// (es. images/comune/menu/ per i sottomenu della navbar), eventualmente con ?v=N
const FOTO_VALIDA = /^images\/(?!guida\/|non-usate\/)[a-z0-9-]{1,60}\/(?:[a-z0-9-]{1,60}\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(jpe?g|png|webp|svg)(\?v=\d{1,4})?$/;

export default {
  async fetch(request, env) {
    const cors = intestazioniCors(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/login") return await login(request, env, cors);
      if (!(await accessoValido(request, env))) return json({ errore: "Accesso scaduto, entra di nuovo" }, 401, cors);
      if (request.method === "GET" && url.pathname === "/contenuti") return await leggiContenuti(env, cors);
      if (request.method === "GET" && url.pathname === "/spazio") return await leggiSpazio(env, cors);
      if (request.method === "POST" && url.pathname === "/salva") return await salva(request, env, cors);
      if (request.method === "POST" && url.pathname === "/password") return await cambiaPassword(request, env, cors);
      return json({ errore: "Indirizzo non valido" }, 404, cors);
    } catch (e) {
      const stato = e && e.stato ? e.stato : 500;
      return json({ errore: e && e.utente ? e.message : "Errore del servizio, riprova tra poco" }, stato, cors);
    }
  },
};

/* ---------- accesso ---------- */

async function login(request, env, cors) {
  const attesa = await bloccato(request, env);
  if (attesa) return json({ errore: messaggioBlocco(attesa) }, 429, cors);
  const corpo = await request.json().catch(() => ({}));
  const pw = await passwordSalvata(env);
  if (!(await passwordGiusta(corpo.password, pw, env))) {
    await new Promise((r) => setTimeout(r, 1200)); // rallenta i tentativi a raffica
    const restano = await tentativoSbagliato(request, env);
    if (!restano) return json({ errore: messaggioBlocco(BLOCCO_S) }, 429, cors);
    return json({ errore: "Password non corretta" + (restano <= 2 ? ` (ancora ${restano} ${restano === 1 ? "tentativo" : "tentativi"}, poi si aspettano 15 minuti)` : "") }, 401, cors);
  }
  await azzeraTentativi(request, env);
  return json(await nuovoAccesso(env, pw ? pw.versione : 0), 200, cors);
}

/* tentativi sbagliati: contati tutti insieme nel KV DATI (il sito lo gestisce una persona sola
   e le modifiche sono rare): dopo MAX_ERRORI l'area riservata si blocca per tutti per
   BLOCCO_S secondi, da qualunque dispositivo o rete (conta anche la password attuale sbagliata
   nel cambio password). Senza il KV resta solo il rallentamento di 1,2 secondi. */
const MAX_ERRORI = 5;
const BLOCCO_S = 15 * 60;
function chiaveTentativi() { return "tentativi"; }
function messaggioBlocco(s) { const m = Math.max(1, Math.ceil(s / 60)); return `Troppi tentativi sbagliati: per sicurezza riprova tra ${m} ${m === 1 ? "minuto" : "minuti"}`; }
async function bloccato(request, env) {
  if (!env.DATI) return 0;
  const t = await env.DATI.get(chiaveTentativi(request), "json");
  const ora = Math.floor(Date.now() / 1000);
  return t && t.n >= MAX_ERRORI && t.fino > ora ? t.fino - ora : 0;
}
async function tentativoSbagliato(request, env) { // restituisce quanti tentativi restano (0 = bloccato)
  if (!env.DATI) return MAX_ERRORI;
  const k = chiaveTentativi(request), t = (await env.DATI.get(k, "json")) || { n: 0 };
  const n = t.n + 1, fino = Math.floor(Date.now() / 1000) + BLOCCO_S;
  await env.DATI.put(k, JSON.stringify({ n, fino }), { expirationTtl: BLOCCO_S });
  return Math.max(0, MAX_ERRORI - n);
}
async function azzeraTentativi(request, env) { if (env.DATI) await env.DATI.delete(chiaveTentativi(request)); }

async function nuovoAccesso(env, versione) {
  const scade = Math.floor(Date.now() / 1000) + DURATA_ACCESSO_S;
  const dati = b64url(new TextEncoder().encode(JSON.stringify({ scade, v: versione })));
  return { token: dati + "." + (await firma(dati, env)), scade };
}

/* password: se è stata cambiata dall'area riservata sta nel KV DATI (impronta PBKDF2),
   altrimenti vale ADMIN_PASSWORD. «versione» cresce a ogni cambio: gli accessi vecchi
   (altri telefoni o computer) non valgono più. */
async function passwordSalvata(env) {
  if (!env.DATI) return null;
  return await env.DATI.get("password", "json");
}

async function passwordGiusta(tentativo, pw, env) {
  if (typeof tentativo !== "string" || !tentativo) return false;
  if (pw) return await ugualiCostante(await impronta(tentativo, pw.sale, pw.iterazioni), pw.impronta);
  return !!env.ADMIN_PASSWORD && (await ugualiCostante(tentativo, env.ADMIN_PASSWORD));
}

async function impronta(password, sale, iterazioni) {
  const chiave = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bit = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: daB64url(sale), iterations: iterazioni }, chiave, 256);
  return b64url(new Uint8Array(bit));
}

async function cambiaPassword(request, env, cors) {
  if (!env.DATI) throw errore("Cambio password non ancora attivo: manca il collegamento DATI su Cloudflare", 501);
  const attesa = await bloccato(request, env);
  if (attesa) throw errore(messaggioBlocco(attesa), 429);
  const corpo = await request.json().catch(() => ({}));
  const pw = await passwordSalvata(env);
  if (!(await passwordGiusta(corpo.attuale, pw, env))) {
    await new Promise((r) => setTimeout(r, 1200));
    const restano = await tentativoSbagliato(request, env);
    throw errore(restano ? "La password attuale non è corretta" : messaggioBlocco(BLOCCO_S), restano ? 403 : 429);
  }
  await azzeraTentativi(request, env);
  const nuova = corpo.nuova;
  if (typeof nuova !== "string" || nuova.length < PW_MIN) throw errore(`La password nuova deve avere almeno ${PW_MIN} caratteri`, 400);
  if (nuova.length > PW_MAX) throw errore("La password nuova è troppo lunga", 400);
  if (nuova === corpo.attuale) throw errore("La password nuova è uguale a quella attuale", 400);
  const sale = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const versione = (pw ? pw.versione : 0) + 1;
  await env.DATI.put("password", JSON.stringify({ sale, iterazioni: PW_ITERAZIONI, impronta: await impronta(nuova, sale, PW_ITERAZIONI), versione, cambiata: new Date().toISOString() }));
  return json(await nuovoAccesso(env, versione), 200, cors);
}

async function accessoValido(request, env) {
  const h = request.headers.get("Authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  const [dati, sig] = token.split(".");
  if (!dati || !sig || !env.SESSION_SECRET) return false;
  if (!(await ugualiCostante(sig, await firma(dati, env)))) return false;
  try {
    const { scade, v } = JSON.parse(new TextDecoder().decode(daB64url(dati)));
    if (!(typeof scade === "number" && scade > Date.now() / 1000)) return false;
    const pw = await passwordSalvata(env);
    return (v || 0) === (pw ? pw.versione : 0);
  } catch { return false; }
}

async function firma(testo, env) {
  const chiave = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", chiave, new TextEncoder().encode(testo))));
}

// confronto a tempo costante: si confrontano le impronte SHA-256, sempre della stessa lunghezza
async function ugualiCostante(a, b) {
  const [x, y] = await Promise.all([a, b].map(async (s) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))));
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/* ---------- lettura ---------- */

async function leggiContenuti(env, cors) {
  const { gallerie, immagini, testi } = await statoAttuale(env);
  return json({ gallerie, immagini, testi }, 200, cors);
}

/**
 * Spazio occupato. Le foto stanno nel repository GitHub e il sito è su GitHub Pages:
 * il sito pubblicato può pesare al massimo 1 GB, e GitHub consiglia di tenere il repository
 * (che conserva anche le foto cancellate, nella cronologia) sotto 1 GB. Si conta il più grande.
 * Il sito pubblicato = i file del ramo senza .*, scripts, data e worker (come in pubblica.yml).
 */
const LIMITE_SPAZIO = 1024 * 1024 * 1024;
const FOTO_MEDIA_STIMATA = 400 * 1024; // foto da 1600 px in JPEG 85, finché non ce ne sono abbastanza caricate
async function leggiSpazio(env, cors) {
  const ref = await gh(env, `git/ref/heads/${env.BRANCH}`);
  const [albero, info] = await Promise.all([
    gh(env, `git/trees/${ref.object.sha}?recursive=1`),
    fetch(`https://api.github.com/repos/${env.REPO}`, { headers: intestazioniGh(env) }).then((r) => (r.ok ? r.json() : {})),
  ]);
  let sito = 0, caricate = 0, nCaricate = 0;
  for (const e of albero.tree || []) {
    if (e.type !== "blob") continue;
    const parti = e.path.split("/");
    if (parti.some((x) => x.startsWith(".")) || ["scripts", "data", "worker", "_site"].includes(parti[0])) continue;
    sito += e.size || 0;
    if (e.path.startsWith(CARTELLA_FOTO)) { caricate += e.size || 0; nCaricate++; }
  }
  const repo = (Number(info.size) || 0) * 1024; // GitHub lo dà in KB (aggiornato con qualche ritardo)
  return json({
    sito, repo, usato: Math.max(sito, repo), limite: LIMITE_SPAZIO,
    mediaFoto: nCaricate >= 5 ? Math.round(caricate / nCaricate) : FOTO_MEDIA_STIMATA,
  }, 200, cors);
}

async function statoAttuale(env) {
  const ref = await gh(env, `git/ref/heads/${env.BRANCH}`);
  const sha = ref.object.sha;
  const [gallerie, immagini, testi] = await Promise.all([leggiJson(env, FILE_GALLERIE, sha).catch(() => ({})),
    leggiJson(env, FILE_IMMAGINI, sha).catch(() => []), leggiJson(env, FILE_TESTI, sha).catch(() => [])]);
  return { sha, gallerie: gallerie && typeof gallerie === "object" && !Array.isArray(gallerie) ? gallerie : {},
    immagini: Array.isArray(immagini) ? immagini : [], testi: Array.isArray(testi) ? testi : [] };
}

async function leggiJson(env, percorso, sha) {
  const file = await gh(env, `contents/${percorso}?ref=${sha}`);
  return JSON.parse(new TextDecoder().decode(daB64(file.content.replace(/\n/g, ""))));
}

/* ---------- salvataggio ---------- */

/**
 * Corpo: { gallerie: { "linea-fashion": [ {foto, titolo, alt?, provvisoria?} ], … } (facoltativo:
 *          solo le gallerie che già esistono in data/gallerie.json),
 *         immagini: [ {id, foto, alt} ] (facoltativo), testi: [ {id, testo, link?} ] (facoltativo),
 *         nuoveFoto: { "nuova:ID": "base64…" }, messaggio }
 * Dei testi si cambia solo il testo (l'indirizzo dei testi cliccabili resta com'è): quali sono, in che
 * pagina e sezione lo decide data/testi.json sul sito.
 * Nel campo foto di una foto nuova c'è "nuova:ID": qui diventa il percorso vero della foto caricata.
 * Delle immagini fisse si cambiano solo foto e testo alternativo: quali sono, in che pagina e
 * con che descrizione lo decide data/immagini.json sul sito.
 * Le foto di images/caricate/ che non sono più usate da nessuna parte vengono cancellate.
 */
async function salva(request, env, cors) {
  const corpo = await request.json().catch(() => null);
  if (!corpo || typeof corpo !== "object") throw errore("Dati non validi", 400);
  const nuove = corpo.nuoveFoto && typeof corpo.nuoveFoto === "object" ? corpo.nuoveFoto : {};
  if (Object.keys(nuove).length > MAX_FOTO_PER_SALVATAGGIO) throw errore("Troppe foto in una volta", 400);

  // foto nuove: controllo e nome definitivo
  const blobFoto = [];
  const percorsi = {};
  for (const [id, b64] of Object.entries(nuove)) {
    if (!/^nuova:[a-z0-9]{6,32}$/.test(id) || typeof b64 !== "string") throw errore("Foto non valida", 400);
    const byte = daB64(b64);
    if (byte.length > MAX_FOTO_BYTES) throw errore("Foto troppo grande", 413);
    const est = tipoImmagine(byte);
    if (!est) throw errore("Formato della foto non supportato", 415);
    percorsi[id] = null;
    blobFoto.push({ id, b64, est });
  }
  const fotoOk = (f) => f in percorsi || FOTO_VALIDA.test(f);

  // gallerie: ogni campo controllato, testi ripuliti
  let gallerie = null;
  if (corpo.gallerie && typeof corpo.gallerie === "object" && !Array.isArray(corpo.gallerie)) {
    gallerie = {};
    for (const [nome, voci] of Object.entries(corpo.gallerie)) {
      if (!/^[a-z0-9-]{1,60}$/.test(nome) || !Array.isArray(voci)) throw errore("Galleria non valida", 400);
      if (voci.length > MAX_PER_GALLERIA) throw errore("Troppe foto in una galleria", 400);
      gallerie[nome] = voci.map((v, i) => {
        const titolo = pulisci(v && v.titolo, 80), foto = String((v && v.foto) || "");
        if (!titolo) throw errore(`Manca il titolo della foto n. ${i + 1}`, 400);
        if (!fotoOk(foto)) throw errore(`Foto non valida (n. ${i + 1})`, 400);
        const o = { foto, titolo };
        const alt = pulisci(v && v.alt, 200);
        if (alt) o.alt = alt;
        const prov = String((v && v.provvisoria) || "");
        if (prov && FOTO_VALIDA.test(prov) && !(foto in percorsi)) o.provvisoria = prov;
        return o;
      });
    }
  }

  // immagini fisse: id → foto e testo alternativo scelti
  const scelte = {};
  if (Array.isArray(corpo.immagini)) for (const im of corpo.immagini) {
    if (!im || typeof im.id !== "string" || !/^[a-z0-9-]{1,40}$/.test(im.id)) throw errore("Immagine non valida", 400);
    const foto = String(im.foto || "");
    if (!fotoOk(foto)) throw errore("Foto non valida", 400);
    scelte[im.id] = { foto, alt: pulisci(im.alt, 200) };
  }

  // testi: id → testo (e indirizzo) scelti
  const testiScelti = {};
  if (Array.isArray(corpo.testi)) for (const t of corpo.testi) {
    if (!t || typeof t.id !== "string" || !/^[a-z0-9-]{1,80}$/.test(t.id)) throw errore("Testo non valido", 400);
    const testo = pulisciTesto(t.testo);
    if (!testo) throw errore("Il testo non può essere vuoto", 400);
    for (const m of testo.matchAll(LINK_NEL_TESTO))
      if (!LINK_VALIDO.test(m[2])) throw errore(`Indirizzo del link non valido: ${m[2].slice(0, 60)}`, 400);
    testiScelti[t.id] = { testo }; // l'indirizzo dei testi cliccabili non si cambia dall'area riservata
  }

  const giorno = new Date().toISOString().slice(0, 10);
  const tutteLeVoci = () => Object.values(gallerie || {}).flat();
  for (const f of blobFoto) {
    const voce = tutteLeVoci().find((v) => v.foto === f.id);
    const slot = Object.entries(scelte).find(([, v]) => v.foto === f.id);
    if (!voce && !slot) continue; // foto caricata ma non usata: si ignora
    const nome = `${giorno}-${slug(voce ? voce.titolo : slot[0])}-${casuale(6)}.${f.est}`;
    percorsi[f.id] = CARTELLA_FOTO + nome;
    for (const v of tutteLeVoci()) if (v.foto === f.id) v.foto = percorsi[f.id];
    for (const v of Object.values(scelte)) if (v.foto === f.id) v.foto = percorsi[f.id];
  }

  // fino a 3 tentativi se nel frattempo il ramo è cambiato
  for (let tentativo = 0; tentativo < 3; tentativo++) {
    const { sha, gallerie: galPrima, immagini: immPrima, testi: testiPrima } = await statoAttuale(env);
    for (const id of Object.keys(testiScelti))
      if (!testiPrima.some((v) => v.id === id)) throw errore("Testo sconosciuto: ricarica la pagina", 400);
    const testi = testiPrima.map((v) => {
      const n = testiScelti[v.id];
      if (!n) return v;
      const o = { ...v, testo: v.tipo === "semplice" ? n.testo.replace(/\s+/g, " ") : n.testo };
      if (formattazione(o.testo) !== formattazione(String(v.testo || ""))) throw errore("Si possono cambiare solo le parole, non grassetto e testi cliccabili", 400);
      return o;
    });
    for (const nome of Object.keys(gallerie || {}))
      if (!(nome in galPrima)) throw errore("Galleria sconosciuta: ricarica la pagina", 400);
    const galNuove = { ...galPrima, ...(gallerie || {}) };
    const immagini = immPrima.map((v) => {
      if (!scelte[v.id]) return v;
      const o = { ...v, foto: scelte[v.id].foto, alt: scelte[v.id].alt || v.alt };
      if (o.foto !== v.foto) delete o.provvisoria; // la foto vera è arrivata
      return o;
    });
    const usate = new Set([...Object.values(galNuove).flat(), ...immagini].map((x) => x.foto));
    const daCancellare = [...new Set([...Object.values(galPrima).flat(), ...immPrima].map((l) => l && l.foto).filter((p) =>
      typeof p === "string" && p.startsWith(CARTELLA_FOTO) && FOTO_VALIDA.test(p) && !usate.has(p)))];

    const commit = await gh(env, `git/commits/${sha}`);
    const albero = [];
    for (const f of blobFoto) {
      if (!percorsi[f.id]) continue;
      const blob = await gh(env, "git/blobs", "POST", { content: f.b64, encoding: "base64" });
      albero.push({ path: percorsi[f.id], mode: "100644", type: "blob", sha: blob.sha });
    }
    if (JSON.stringify(galNuove) !== JSON.stringify(galPrima))
      albero.push({ path: FILE_GALLERIE, mode: "100644", type: "blob", content: JSON.stringify(galNuove, null, 2) + "\n" });
    if (immPrima.length && JSON.stringify(immagini) !== JSON.stringify(immPrima))
      albero.push({ path: FILE_IMMAGINI, mode: "100644", type: "blob", content: JSON.stringify(immagini, null, 2) + "\n" });
    if (testiPrima.length && JSON.stringify(testi) !== JSON.stringify(testiPrima))
      albero.push({ path: FILE_TESTI, mode: "100644", type: "blob", content: JSON.stringify(testi, null, 2) + "\n" });
    for (const p of daCancellare) albero.push({ path: p, mode: "100644", type: "blob", sha: null });
    if (!albero.length) return json({ gallerie: galNuove, immagini, testi, commit: sha }, 200, cors); // niente da salvare

    const nuovoAlbero = await gh(env, "git/trees", "POST", { base_tree: commit.tree.sha, tree: albero });
    const messaggio = pulisci(corpo.messaggio, 100) || "Area riservata: aggiornate le foto del sito";
    const nuovoCommit = await gh(env, "git/commits", "POST", { message: messaggio, tree: nuovoAlbero.sha, parents: [sha] });
    try {
      await gh(env, `git/refs/heads/${env.BRANCH}`, "PATCH", { sha: nuovoCommit.sha, force: false });
      return json({ gallerie: galNuove, immagini, testi, commit: nuovoCommit.sha }, 200, cors);
    } catch (e) {
      if (e.stato !== 422) throw e; // 422: il ramo è andato avanti, si riprova sul nuovo stato
    }
  }
  throw errore("Il sito è stato modificato nello stesso momento, riprova", 409);
}

/* ---------- GitHub ---------- */

function intestazioniGh(env) {
  return {
    "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "olimp-area-riservata",
  };
}

async function gh(env, percorso, metodo = "GET", corpo) {
  const r = await fetch(`https://api.github.com/repos/${env.REPO}/${percorso}`, {
    method: metodo,
    headers: { ...intestazioniGh(env), ...(corpo ? { "Content-Type": "application/json" } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (!r.ok) { const e = new Error(`GitHub ${r.status}`); e.stato = r.status; throw e; }
  return r.status === 204 ? null : r.json();
}

/* ---------- utilità ---------- */

function intestazioniCors(request, env) {
  const ammessi = String(env.ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const origine = request.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ammessi.includes(origine) ? origine : (ammessi[0] || "null"),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(dati, stato, cors) {
  return new Response(JSON.stringify(dati), { status: stato, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

function errore(messaggio, stato) { const e = new Error(messaggio); e.stato = stato; e.utente = true; return e; }

function pulisci(v, max) {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

// testi delle pagine: si tengono gli a capo (diventano <br>), si tolgono i caratteri di controllo;
// < e > restano: il generatore li scrive come testo, mai come HTML
function pulisciTesto(v) {
  if (typeof v !== "string") return "";
  return v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .split("\n").map((r) => r.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TESTO);
}

function slug(t) {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "foto";
}

function casuale(n) {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789", b = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(b, (x) => a[x % a.length]).join("");
}

function tipoImmagine(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  return null;
}

function daB64(s) { const t = atob(s); const u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; }
function b64url(u) { let t = ""; for (const x of u) t += String.fromCharCode(x); return btoa(t).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function daB64url(s) { return daB64(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)); }
