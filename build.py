#!/usr/bin/env python3
"""
Builder della mappa "Quartieri di Roma 2026": esploratore pubblico della nuova
geografia amministrativa di Roma, nella palette amaranto (senza il marchio di Roma
Capitale). Un progetto di Urbe Hub con i dati aperti di Roma Capitale.

I dati arrivano gia' neutri (geometria e superficie) e stanno in data/. La neutralita'
del bundle e' blindata da:
  1. la whitelist delle properties (sotto), che ricostruisce le FeatureCollection
     tenendo solo i campi geografici consentiti, scartando tutto il resto;
  2. il gate a pattern check_zero_footprint.py, eseguito sul bundle finale (importato
     in modo facoltativo: i termini stanno in zero_footprint_termini.json, se presente).

Consuma SOLO input dentro questa cartella:
  - data/quartieri-2026.simplified.geojson  (quartieri/rioni/zone funzionali)
  - data/municipi-roma.geojson              (confini dei 15 municipi)
  - data/strade/*.json                      (stradario incrociato con le aree:
                                             copiato accanto al bundle, la mappa
                                             lo carica solo quando si cerca una via)
  - data/servizi/servizi.json               (servizi del focus e dei 15 minuti: Piano dei
                                             Servizi piu' scuole e presidi, da
                                             importa_servizi.py; copiato accanto al
                                             bundle, la mappa lo carica solo al primo
                                             focus o alla prima citta' dei 15 minuti)
  - data/rete/                              (rete pedonale OSM in riquadri, fuori da
                                             git: prepara_rete_pedonale.py; senza, la mappa
                                             esce senza "A piedi in 15 minuti", e con
                                             --produzione la build fallisce)
  - data/copertura/copertura.json           (minuti a piedi ai servizi essenziali per
                                             esagono abitato, prima vista della 2D:
                                             prepara_copertura_15_minuti.py; copiato
                                             accanto al bundle; senza, niente strato)
  - icone/*.svg                             (icone dei servizi, tessere da app con
                                             l'illustrazione centrata: inlinate nel bundle,
                                             una per categoria, vedi CATEGORIA_ICONA; si
                                             rifanno con icone/prepara_icone_app.py)
  - vendor/leaflet.css, vendor/leaflet.js   (libreria vendorizzata, licenza in vendor/leaflet/)
  - vendor/fonts/                           (Montserrat, licenza OFL accanto)
  - brand/urbe-hub-donor.png                (logo Urbe Hub)
  - brand/og.png                            (anteprima social, facoltativa)

Scrive anche dist/vercel.json: dati a parte (strade, servizi, rete) con cache lunga
e immutabile, richiesti dalla mappa con ?v=<hash corto del contenuto> (VERSIONI);
index.html senza cache lunga; header di sicurezza; noindex anche come header, oltre al meta.

Statistiche anonime (Umami sul nostro server): solo se STATISTICHE_WEBSITE_ID (o la variabile
MAPPA_STATISTICHE_ID) e' pieno; senza, nel bundle non entra nessuno script di statistiche.

Uso:
    python3 build.py               # anteprima: noindex (meta e header)
    python3 build.py --produzione  # indicizzabile; fallisce se manca data/rete/

Variabile d'ambiente MAPPA_DIST: cartella di uscita diversa da dist/.
"""

import base64
import contextlib
import hashlib
import io
import json
import math
import os
import re
import shutil
import sys
from html import escape as html_escape
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent

if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
try:
    from check_zero_footprint import check as check_zero_footprint
except ImportError:
    # Il gate e' facoltativo: senza, la build prosegue e lo dice una volta.
    print("Avviso: check_zero_footprint.py non trovato, build senza gate.", file=sys.stderr)

    def check_zero_footprint(path, strade=False, servizi=False):
        return 0

TEMPLATE_PATH = SCRIPT_DIR / "mappa-quartieri.template.html"
# Cartella di uscita: dist/ di default, MAPPA_DIST per costruire altrove senza toccarla.
DIST_DIR = Path(os.environ.get("MAPPA_DIST", SCRIPT_DIR / "dist")).resolve()
OUTPUT_PATH = DIST_DIR / "index.html"
STRADE_SRC = SCRIPT_DIR / "data" / "strade"
STRADE_OUT = DIST_DIR / "strade"
SERVIZI_SRC = SCRIPT_DIR / "data" / "servizi"
SERVIZI_OUT = DIST_DIR / "servizi"
ICONE_SRC = SCRIPT_DIR / "icone"
OG_SRC = SCRIPT_DIR / "brand" / "og.png"
OG_OUT = DIST_DIR / "og.png"
LEAFLET_LICENSE_SRC = SCRIPT_DIR / "vendor" / "leaflet" / "LICENSE"
LEAFLET_LICENSE_OUT = DIST_DIR / "leaflet-LICENSE.txt"
OFL_SRC = SCRIPT_DIR / "vendor" / "fonts" / "OFL.txt"
OFL_OUT = DIST_DIR / "OFL.txt"
META_NOINDEX = '<meta name="robots" content="noindex, nofollow">'
RETE_SRC = SCRIPT_DIR / "data" / "rete"
RETE_OUT = DIST_DIR / "rete"
# 15 minuti in bici: rete a parte (prepara_rete_bici.py, ~20 MB, fuori da git come la pedonale)
# e piste ciclabili da mostrare sulla mappa (~0,1 MB, nel repository).
RETE_BICI_SRC = SCRIPT_DIR / "data" / "rete-bici"
RETE_BICI_OUT = DIST_DIR / "rete-bici"
CICLABILI_SRC = SCRIPT_DIR / "data" / "ciclabili" / "ciclabili.json"
CICLABILI_OUT = DIST_DIR / "ciclabili"
# Prima vista della 2D: dove i servizi essenziali non si raggiungono a piedi in 15 minuti
# (prepara_copertura_15_minuti.py). Senza il file la mappa esce senza quello strato.
COPERTURA_SRC = SCRIPT_DIR / "data" / "copertura" / "copertura.json"
COPERTURA_OUT = DIST_DIR / "copertura"
# Spenta in questo rilascio: il codice resta, la build esce come senza il file. Torna con True.
COPERTURA_NEL_RILASCIO = False
# I 15 minuti leggono lo stesso data/servizi/servizi.json del focus:
# dist/servizi-15-minuti.json non esiste piu' (si toglie se e' rimasto li').
QUINDICI_VECCHIO_OUT = DIST_DIR / "servizi-15-minuti.json"
VERCEL_OUT = DIST_DIR / "vercel.json"
# Vista 3D: MapLibre vendorizzato + il modulo, copiati in dist/3d/ e scaricati dalla
# mappa solo al primo "3D"; il tasto e il contratto con la 2D (aggancio) si inlinano.
VISTA3D_SRC = SCRIPT_DIR / "vista-3d"
VISTA3D_OUT = DIST_DIR / "3d"
MAPLIBRE_DIR = SCRIPT_DIR / "vendor" / "maplibre-gl"
MARKER_VISTA3D_CSS = "/*<<VISTA_3D_CSS>>*/"
MARKER_VISTA3D_JS = "/*<<VISTA_3D_JS>>*/"

QUARTIERI_PATH = SCRIPT_DIR / "data" / "quartieri-2026.simplified.geojson"
MUNICIPI_PATH = SCRIPT_DIR / "data" / "municipi-roma.geojson"
LEAFLET_CSS_PATH = SCRIPT_DIR / "vendor" / "leaflet.css"
LEAFLET_JS_PATH = SCRIPT_DIR / "vendor" / "leaflet.js"
URBE_LOGO_PATH = SCRIPT_DIR / "brand" / "urbe-hub-donor.png"
MONTSERRAT_FONT_PATH = SCRIPT_DIR / "vendor" / "fonts" / "montserrat-latin.woff2"

MARKER_FONTS_CSS = "/*<<FONTS_CSS>>*/"
MARKER_LEAFLET_CSS = "/*<<LEAFLET_CSS>>*/"
MARKER_LEAFLET_JS = "/*<<LEAFLET_JS>>*/"
MARKER_QUARTIERI = "/*<<QUARTIERI>>*/"
MARKER_MUNICIPI = "/*<<MUNICIPI>>*/"
MARKER_URBE_LOGO = "<<URBE_LOGO>>"
MARKER_ICONE_SERVIZI = "/*<<ICONE_SERVIZI>>*/"
MARKER_VERSIONI = "/*<<VERSIONI>>*/"
MARKER_INTRO_SVG = "<<INTRO_SVG>>"

# ---------- Statistiche anonime (Umami, sul nostro server) ----------
# Si accendono solo con l'ID del sito: senza, nel bundle non entra nessuno script di
# statistiche e la CSP non cita l'host (un fork del repository pubblico esce cosi'). Chi
# usa un proprio Umami cambia host, ID, link e domini; le variabili d'ambiente
# MAPPA_STATISTICHE_ID, MAPPA_STATISTICHE_LINK e MAPPA_STATISTICHE_SRI valgono piu' delle costanti.
STATISTICHE_HOST = "https://statistiche.romaquartieri.it"
# L'ID del sito in Umami (un UUID). Vuoto = niente statistiche.
STATISTICHE_WEBSITE_ID = "e64e0e86-8411-4550-a522-5042428e6f63"
# Il link pubblico di condivisione di Umami. Vuoto = niente link nel pannello "Cos'e'".
STATISTICHE_LINK_PUBBLICO = "https://statistiche.romaquartieri.it/share/yOxOhcv40CICQKN3"
# Lo script manda dati solo da questi host (confronto esatto con window.location.hostname,
# separati da virgola): anteprime, localhost e fork su altri domini non contano mai.
# www.romaquartieri.it rimanda all'apex con un 308, quindi basta l'apex.
STATISTICHE_DOMINI = "romaquartieri.it"
# Subresource Integrity dello script ("sha384-..."): il browser lo esegue solo se il file e'
# quello. Vuoto = niente attributo integrity. OGNI AGGIORNAMENTO DI UMAMI CAMBIA script.js:
# va ricalcolato e aggiornato qui nello stesso momento, se no lo script non parte (la mappa
# resta intatta, le statistiche si fermano). Con l'integrity il tag porta anche
# crossorigin="anonymous": il server deve mandare Access-Control-Allow-Origin su script.js
# (Umami lo fa da se' in produzione). Per i test nel browser, che servono uno script vuoto al
# posto di quello vero, il dist/ si costruisce con MAPPA_STATISTICHE_SRI= (vuota).
# Umami 3.4.1 (script.js servito dal nostro server, hash uguale prima e dopo un riavvio).
STATISTICHE_SRI = "sha384-ZMxgpYfO/phGz4GiYTIZhcauuGKTb2onmOB5gsiigjmBR38DGAmIna5J1Y/dM/13"
# Il tag dello script, in testa al template; il blocco del link (testo nel template) fra i
# due marker del pannello "Cos'e'", con <<STATISTICHE_URL>> al posto dell'indirizzo.
MARKER_STATISTICHE_TAG = "<!--<<STATISTICHE_TAG>>-->"
MARKER_STATISTICHE_LINK = "<!--<<STATISTICHE_LINK>>-->"
MARKER_STATISTICHE_LINK_FINE = "<!--<</STATISTICHE_LINK>>-->"
MARKER_STATISTICHE_URL = "<<STATISTICHE_URL>>"
_RE_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


# Categoria -> file SVG in icone/ (inlinato nel bundle). La categoria
# "altro" (Universita', Parrocchie, CAF, Carabinieri, Polizia, Sedi Municipi, Stazioni,
# Aree cani: 9 strati eterogenei senza un'icona comune)
# resta senza icona per scelta: niente marker sulla mappa, ma il conteggio compare comunque
# nella scheda dell'area. Scuole (per tipo), case della comunita' e pronto soccorso vengono
# dalla citta' dei 15 minuti; "sanita" sono solo ambulatori e CUP del Piano dei Servizi, con
# un'icona propria per non confonderli col pronto soccorso (vedi importa_servizi.py).
CATEGORIA_ICONA = {
    "nido": "nido.svg",
    "infanzia": "infanzia.svg",
    "primaria": "primaria.svg",
    "media": "media.svg",
    "superiore": "superiore.svg",
    "casa_comunita": "casa-comunita.svg",
    "pronto_soccorso": "pronto-soccorso.svg",
    "pronto_soccorso_specialistico": "pronto-soccorso.svg",
    "pronto_soccorso_pediatrico": "pronto-soccorso.svg",
    "sanita": "ambulatorio.svg",
    "farmacie": "farmacia.svg",
    "parchi_e_aree_gioco": "parco.svg",
    "musei_e_cultura": "museo.svg",
    "centri_anziani": "centro-anziani.svg",
    "impianti_sportivi": "sport.svg",
    "mercati": "mercato.svg",
    "biblioteche": "biblioteca.svg",
    "consultori": "consultorio.svg",
    "metro": "metro.svg",
    "tram": "tram.svg",
    "treno": "treno.svg",
}

# Whitelist delle properties: garanzia sul CONTENUTO, non solo sui file di input.
# Qualunque property fuori da questi elenchi viene scartata prima dell'inlining.
QUARTIERI_PROPERTIES_WHITELIST = (
    "denominazione",
    "tipo",
    "municipio",
    "municipio_num_arabo",
    "codice",
    "superficie_kmq",
    "classe_funzionalita",
)
MUNICIPI_PROPERTIES_WHITELIST = (
    "municipio",
    "name",
    "romano",
)


# Accenti mancanti nei toponimi: la vocale finale accentata (A) e' scritta come
# apostrofo (A'). Correzione SOLO su questa classe, con match esatto sull'intera
# denominazione: gli apostrofi legittimi restano intatti per costruzione, incluse
# le elisioni "DE'" (CASAL DE' PAZZI, TOR DE' CENCI...) e SANT'/DELL'/D'.
# Fonte confermata: resa ufficiale dei toponimi (Cinecitta', Citta', Pieta', Universita').
DENOMINAZIONI_ACCENTI = {
    "CINECITTA'": "CINECITTÀ",
    "CINECITTA' EST": "CINECITTÀ EST",
    "CITTA' MILITARE DELLA CECCHIGNOLA": "CITTÀ MILITARE DELLA CECCHIGNOLA",
    "LAMARO - CINECITTA'": "LAMARO - CINECITTÀ",
    "SANTA MARIA DELLA PIETA'": "SANTA MARIA DELLA PIETÀ",
    "SAPIENZA UNIVERSITA'": "SAPIENZA UNIVERSITÀ",
    "TOR VERGATA UNIVERSITA'": "TOR VERGATA UNIVERSITÀ",
}


def normalizza_denominazioni(geojson):
    for feature in geojson.get("features", []):
        props = feature.get("properties") or {}
        nome = props.get("denominazione")
        if nome in DENOMINAZIONI_ACCENTI:
            props["denominazione"] = DENOMINAZIONI_ACCENTI[nome]
    return geojson


def whitelist_feature_collection(geojson, properties_whitelist):
    features_in = geojson.get("features", []) if isinstance(geojson, dict) else []
    features_out = []
    for feature in features_in:
        props_in = feature.get("properties") or {}
        props_out = {
            chiave: props_in[chiave]
            for chiave in properties_whitelist
            if chiave in props_in
        }
        features_out.append({
            "type": "Feature",
            "properties": props_out,
            "geometry": feature.get("geometry"),
        })
    return {"type": "FeatureCollection", "features": features_out}


def anello_a_delta(anello):
    # [[lon, lat], ...] -> [x0, y0, dx1, dy1, ...] in interi da 1e-5 gradi (~1 m): stessa
    # precisione utile del geojson semplificato, meta' del peso. Il template la ricostruisce.
    out, px, py = [], 0, 0
    for lon, lat in anello:
        x, y = int(round(lon * 1e5)), int(round(lat * 1e5))
        out += [x - px, y - py]
        px, py = x, y
    return out


def compatta_feature_collection(geojson):
    # Ogni feature diventa [properties, poligoni] (sempre MultiPolygon): le properties
    # arrivano gia' dalla whitelist, qui cambia solo la scrittura della geometria.
    compatte = []
    for f in geojson["features"]:
        g = f["geometry"]
        if g["type"] == "Polygon":
            poligoni = [g["coordinates"]]
        elif g["type"] == "MultiPolygon":
            poligoni = g["coordinates"]
        else:
            raise SystemExit("Errore: geometria non prevista (" + str(g["type"]) + ") nei quartieri.")
        compatte.append([f["properties"], [[anello_a_delta(a) for a in pol] for pol in poligoni]])
    return compatte


def semplifica(punti, tolleranza):
    # Douglas-Peucker iterativo su [(x, y), ...]: tiene primo e ultimo punto.
    if len(punti) < 3:
        return punti
    tieni = [False] * len(punti)
    tieni[0] = tieni[-1] = True
    pila = [(0, len(punti) - 1)]
    while pila:
        a, b = pila.pop()
        (ax, ay), (bx, by) = punti[a], punti[b]
        dx, dy = bx - ax, by - ay
        lung = math.hypot(dx, dy) or 1e-9
        peggiore, indice = 0.0, None
        for i in range(a + 1, b):
            px, py = punti[i]
            d = abs(dy * (px - ax) - dx * (py - ay)) / lung
            if d > peggiore:
                peggiore, indice = d, i
        if indice is not None and peggiore > tolleranza:
            tieni[indice] = True
            pila += [(a, indice), (indice, b)]
    return [q for q, k in zip(punti, tieni) if k]


def contorno_unione(municipi_geojson):
    # Contorno di Roma come unione dei 15 municipi, in gradi (lon, lat), senza i confini
    # interni. Niente shapely: i confini dei municipi coincidono vertice per vertice (con
    # qualche scheggia), quindi basta lavorare sugli spigoli. Ogni anello e' orientato
    # (esterni antiorari, buchi orari) e i suoi spigoli diventano spigoli orientati; uno
    # spigolo condiviso fra due municipi compare due volte, una per verso, e le due copie
    # si annullano: restano solo gli spigoli del bordo. Si concatenano in anelli e, ai nodi
    # con piu' uscite (dove due pezzi si toccano in un punto), si prende la svolta piu' a
    # destra rispetto allo spigolo d'arrivo: gli anelli escono separati, mai incrociati.
    # Si tengono gli anelli antiorari piu' grandi di una scheggia: il contorno principale
    # e l'isola amministrativa del Municipio XV; il buco del Vaticano e le schegge cadono.
    def arrotonda(c):
        return (round(c[0], 6), round(c[1], 6))

    def area_con_segno(pts):
        return sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1]
                   for i in range(len(pts))) / 2.0

    spigoli = {}
    for f in municipi_geojson["features"]:
        g = f["geometry"]
        poligoni = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        for pol in poligoni:
            for n_anello, anello in enumerate(pol):
                pts = []
                for c in anello:
                    p = arrotonda(c)
                    if not pts or p != pts[-1]:
                        pts.append(p)
                if len(pts) > 1 and pts[0] == pts[-1]:
                    pts.pop()
                if len(pts) < 3:
                    continue
                if (area_con_segno(pts) > 0) != (n_anello == 0):
                    pts.reverse()
                for i in range(len(pts)):
                    a, b = pts[i], pts[(i + 1) % len(pts)]
                    if spigoli.get((b, a), 0) > 0:
                        spigoli[(b, a)] -= 1
                    else:
                        spigoli[(a, b)] = spigoli.get((a, b), 0) + 1

    uscite = {}
    for (a, b), n in spigoli.items():
        for _ in range(n):
            uscite.setdefault(a, []).append(b)

    anelli = []
    while uscite:
        inizio = next(iter(uscite))
        anello, prec, cur = [inizio], None, inizio
        while True:
            cand = uscite.get(cur)
            if not cand:
                break
            if len(cand) == 1 or prec is None:
                nxt = cand[0]
            else:
                # svolta piu' a destra = angolo con segno minimo fra spigolo d'arrivo e d'uscita
                din = (cur[0] - prec[0], cur[1] - prec[1])
                nxt = min(cand, key=lambda c: math.atan2(din[0] * (c[1] - cur[1]) - din[1] * (c[0] - cur[0]),
                                                         din[0] * (c[0] - cur[0]) + din[1] * (c[1] - cur[1])))
            cand.remove(nxt)
            if not cand:
                del uscite[cur]
            prec, cur = cur, nxt
            if cur == inizio:
                break
            anello.append(cur)
        if len(anello) >= 3 and area_con_segno(anello) > 1e-4:
            anelli.append(anello)
    anelli.sort(key=lambda a: -area_con_segno(a))
    return anelli


# Dove parte il tratto dell'intro: la foce del Tevere (Ostia).
FOCE_TEVERE = (12.2385, 41.7300)


def costruisci_intro_svg(municipi_geojson, larghezza=1000):
    # Contorno di Roma (unione dei 15 municipi, un tratto solo) per l'intro animata, gia'
    # proiettato in Web Mercator (la stessa proiezione di Leaflet e della 3D): cosi' il
    # disegno si posa esatto sulla mappa vera. Il riquadro e' quello dei municipi, che
    # coincide con quello dell'unione. Resta dentro il primo pezzo del body, prima dei
    # dati: leggere ~3 KB non ritarda nulla e l'intro parte mentre il resto del file si
    # carica.
    def proietta(lon, lat):
        return lon, math.degrees(math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)))

    anelli = [[proietta(*p) for p in anello] for anello in contorno_unione(municipi_geojson)]
    tutti = []
    for f in municipi_geojson["features"]:
        g = f["geometry"]
        poligoni = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        tutti += [proietta(*c[:2]) for pol in poligoni for anello in pol for c in anello]
    minx, maxx = min(p[0] for p in tutti), max(p[0] for p in tutti)
    miny, maxy = min(p[1] for p in tutti), max(p[1] for p in tutti)
    scala = larghezza / (maxx - minx)
    altezza = int(math.ceil((maxy - miny) * scala))

    def numero(v):
        # un decimale (un'unita' del viewBox sono ~40 m: il tratto resta liscio anche grande)
        s = "%.1f" % v
        return s[:-2] if s.endswith(".0") else s

    foce = proietta(*FOCE_TEVERE)
    d = []
    lunghezze = []
    for anello in anelli:
        pts = [((x - minx) * scala, (maxy - y) * scala) for x, y in anello]
        if anello is anelli[0]:
            # il tratto parte dalla foce del Tevere: il vertice piu' vicino diventa il primo
            fx, fy = (foce[0] - minx) * scala, (maxy - foce[1]) * scala
            k = min(range(len(pts)), key=lambda i: (pts[i][0] - fx) ** 2 + (pts[i][1] - fy) ** 2)
            pts = pts[k:] + pts[:k]
        # Anello chiuso: si semplifica in due meta' (primo e ultimo punto coincidono, quindi
        # altrimenti il segmento di riferimento e' nullo); primo punto e meta' restano.
        pts = pts + [pts[0]]
        meta = len(pts) // 2
        pts = semplifica(pts[:meta + 1], 1.6) + semplifica(pts[meta:], 1.6)[1:]
        if len(pts) < 4:
            continue
        d.append("M" + "L".join("%s %s" % (numero(x), numero(y)) for x, y in pts[:-1]) + "Z")
        lunghezze.append(sum(math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1)))

    def lat(y):
        return math.degrees(2 * math.atan(math.exp(math.radians(y))) - math.pi / 2)

    # Quota dell'anello principale sulla lunghezza totale: il tratteggio dell'intro riparte a ogni
    # sottopercorso, quindi il disegno scorre su quella lunghezza (vedi --L nel template).
    anello_quota = lunghezze[0] / sum(lunghezze)
    return ('<svg id="intro-contorno" viewBox="0 0 %d %d" data-ovest="%.6f" data-est="%.6f" '
            'data-nord="%.6f" data-sud="%.6f" data-anello="%.4f" aria-hidden="true" focusable="false">'
            '<path id="intro-tratto" pathLength="1" d="%s"/></svg>'
            % (larghezza, altezza, minx, maxx, lat(maxy), lat(miny), anello_quota, "".join(d)))


def hash_corto(files):
    h = hashlib.sha1()
    for f in sorted(files):
        h.update(f.name.encode("utf-8"))
        h.update(f.read_bytes())
    return h.hexdigest()[:10]


def statistiche_id():
    # L'ID del sito in Umami ("" = statistiche spente); la variabile d'ambiente vince.
    valore = os.environ.get("MAPPA_STATISTICHE_ID", STATISTICHE_WEBSITE_ID).strip()
    if valore and not _RE_UUID.match(valore):
        raise SystemExit("Errore: l'ID delle statistiche non e' un UUID (" + valore + ").")
    return valore


def statistiche_link():
    # Il link pubblico alle statistiche ("" = niente link nel pannello).
    valore = os.environ.get("MAPPA_STATISTICHE_LINK", STATISTICHE_LINK_PUBBLICO).strip()
    if valore and not re.match(r"^https://[^\s\"'<>]+$", valore):
        raise SystemExit("Errore: il link delle statistiche deve essere un indirizzo https (" + valore + ").")
    return valore


def tag_statistiche():
    # Lo script di Umami (attributi letti dalla 3.4), solo con l'ID. async e non defer: un
    # defer su un altro host terrebbe fermo il DOMContentLoaded (e l'intro, che lo aspetta)
    # finche' il server risponde. auto-track spento, e non solo auto-pageview: la mappa
    # riscrive l'hash a ogni scelta (replaceState, pushState entrando in 3D) e con auto-track
    # acceso il tracker aggancerebbe comunque la cronologia, dove a ogni replaceState sposta
    # anche il referrer sulla pagina stessa, oltre a un ascoltatore dei clic che qui non
    # serve. La pagina vista e gli eventi li manda MAPPA_TRACCIA nel template, con l'URL
    # ridotto al percorso; exclude-search ed exclude-hash restano come seconda rete.
    sito = statistiche_id()
    if not sito:
        return ""
    attributi = [
        ("id", "rq-statistiche"),
        ("src", STATISTICHE_HOST.rstrip("/") + "/script.js"),
        ("data-website-id", sito),
        ("data-domains", STATISTICHE_DOMINI),
        ("data-auto-track", "false"),
        ("data-do-not-track", "true"),
        ("data-exclude-search", "true"),
        ("data-exclude-hash", "true"),
    ]
    sri = os.environ.get("MAPPA_STATISTICHE_SRI", STATISTICHE_SRI).strip()
    if sri:
        if not re.match(r"^sha(256|384|512)-[A-Za-z0-9+/]+={0,2}$", sri):
            raise SystemExit("Errore: STATISTICHE_SRI non e' un hash sha256/384/512 in base64 (" + sri + ").")
        attributi += [("integrity", sri), ("crossorigin", "anonymous")]
    return "<script async " + " ".join(k + '="' + html_escape(v, quote=True) + '"' for k, v in attributi) + "></script>"


def applica_statistiche(html):
    # Tag in testa (o niente) e blocco del link nel pannello "Cos'e'" (o niente).
    html = html.replace(MARKER_STATISTICHE_TAG, tag_statistiche())
    i, j = html.index(MARKER_STATISTICHE_LINK), html.index(MARKER_STATISTICHE_LINK_FINE)
    link = statistiche_link()
    blocco = html[i + len(MARKER_STATISTICHE_LINK):j].replace(MARKER_STATISTICHE_URL, html_escape(link, quote=True)) if link else ""
    return html[:i] + blocco + html[j + len(MARKER_STATISTICHE_LINK_FINE):]


def csp_report_only():
    # CSP in sola segnalazione: pagina con script e stili inline, font in data:, tile
    # OpenStreetMap (immagini e fetch), worker blob: di MapLibre, e l'host delle statistiche
    # (script e invio) solo se sono accese. Niente frame-ancestors: la mappa si puo'
    # incorniciare in altre pagine. Se le tile cambiano fornitore, va cambiato anche l'host qui.
    stat = (" " + STATISTICHE_HOST.rstrip("/")) if statistiche_id() else ""
    return (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' blob:" + stat + "; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob: https://tile.openstreetmap.org; "
        "font-src 'self' data:; "
        "connect-src 'self' https://tile.openstreetmap.org" + stat + "; "
        "worker-src 'self' blob:; "
        "object-src 'none'; base-uri 'self'; form-action 'self'"
    )


def config_vercel(produzione=False):
    # dist/ e' la cartella pubblicata: i dati cambiano nome (?v=) quando cambiano, quindi
    # possono restare in cache per un anno; index.html si rivalida sempre. Il noindex sta
    # anche qui come header (per i JSON che non hanno il meta), tranne in produzione.
    immutabile = [{"key": "Cache-Control", "value": "public, max-age=31536000, immutable"}]
    generale = [
        {"key": "X-Content-Type-Options", "value": "nosniff"},
        {"key": "Referrer-Policy", "value": "strict-origin-when-cross-origin"},
        {"key": "Content-Security-Policy-Report-Only", "value": csp_report_only()},
    ]
    if not produzione:
        generale.insert(0, {"key": "X-Robots-Tag", "value": "noindex, nofollow"})
    return {
        "headers": [
            {"source": "/(.*)", "headers": generale},
            {"source": "/", "headers": [{"key": "Cache-Control", "value": "public, max-age=0, must-revalidate"}]},
            {"source": "/index.html", "headers": [{"key": "Cache-Control", "value": "public, max-age=0, must-revalidate"}]},
            {"source": "/strade/(.*)", "headers": immutabile},
            {"source": "/rete/(.*)", "headers": immutabile},
            {"source": "/rete-bici/(.*)", "headers": immutabile},
            {"source": "/ciclabili/(.*)", "headers": immutabile},
            {"source": "/copertura/(.*)", "headers": immutabile},
            {"source": "/servizi/(.*)", "headers": immutabile},
            {"source": "/3d/(.*)", "headers": immutabile},
        ]
    }


def scrivi_vercel_json(produzione=False):
    VERCEL_OUT.write_text(json.dumps(config_vercel(produzione), indent=2) + "\n", encoding="utf-8")


def senza_noindex(html):
    # Versione indicizzabile: toglie il meta robots dall'output (il template resta noindex).
    if META_NOINDEX not in html:
        raise SystemExit("Errore: meta noindex non trovato nel template, impossibile toglierlo.")
    return html.replace(META_NOINDEX + "\n", "", 1).replace(META_NOINDEX, "", 1)


def copia_licenze_e_og():
    # Testi di licenza di Leaflet e Montserrat accanto al bundle; l'anteprima social si
    # copia solo se c'e'.
    for src, out in ((LEAFLET_LICENSE_SRC, LEAFLET_LICENSE_OUT), (OFL_SRC, OFL_OUT)):
        if not src.exists():
            raise SystemExit("Errore: licenza mancante " + str(src) + ".")
        shutil.copyfile(src, out)
    if OG_SRC.exists():
        shutil.copyfile(OG_SRC, OG_OUT)
    elif OG_OUT.exists():
        OG_OUT.unlink()


def leggi_input_obbligatorio(path):
    if not path.exists():
        raise SystemExit(
            "Errore: input mancante " + str(path) + ". Il builder non puo' "
            "procedere (nessun fallback su altri dati)."
        )
    return path.read_text(encoding="utf-8")


def leggi_binario_obbligatorio(path):
    if not path.exists():
        raise SystemExit("Errore: asset mancante " + str(path) + ".")
    return path.read_bytes()


def data_uri_png(path):
    b = leggi_binario_obbligatorio(path)
    return "data:image/png;base64," + base64.b64encode(b).decode("ascii")


def costruisci_fonts_css():
    # Montserrat come font variabile (asse peso 100-900), subset latin, inlinato
    # in base64: nessun fetch a Google a runtime (self-contained reale + niente
    # IP dei visitatori a Google, che in UE e' stato giudicato violazione GDPR).
    b = leggi_binario_obbligatorio(MONTSERRAT_FONT_PATH)
    b64 = base64.b64encode(b).decode("ascii")
    return (
        "@font-face{font-family:'Montserrat';font-style:normal;"
        "font-weight:100 900;font-display:swap;"
        "src:url('data:font/woff2;base64," + b64 + "') format('woff2');}"
    )


def escava_chiusura_script(testo):
    # Il parser HTML chiude lo <script> su "</script" in modo case-insensitive:
    # neutralizziamo ogni variante di maiuscole/minuscole, non solo i due casi estremi.
    return re.sub(r"</(script)", r"<\\/\1", testo, flags=re.IGNORECASE)


def dump_json_sicuro(dati):
    testo = json.dumps(dati, ensure_ascii=False, separators=(",", ":"))
    return testo.replace("</", "<\\/")


def copia_strade():
    # Le vie viaggiano come file a parte (4 MB, troppi da inlinare): la mappa li
    # chiede con fetch alla prima ricerca. Si riscrivono campo per campo, cosi'
    # in dist/ non arriva nulla oltre a nome, aree, metri e tracciato.
    if not (STRADE_SRC / "indice.json").exists():
        raise SystemExit("Errore: input mancante " + str(STRADE_SRC / "indice.json") + ".")
    if STRADE_OUT.exists():
        shutil.rmtree(STRADE_OUT)
    STRADE_OUT.mkdir(parents=True)
    indice = json.loads((STRADE_SRC / "indice.json").read_text(encoding="utf-8"))
    vie = [[str(nome), [str(c) for c in aree]] for nome, aree in indice["vie"]]
    (STRADE_OUT / "indice.json").write_text(dump_json_sicuro({"vie": vie}), encoding="utf-8")
    for f in sorted(STRADE_SRC.glob("m*.json")):
        dati = json.loads(f.read_text(encoding="utf-8"))
        quartieri = {
            str(cod): [[str(r[0]), int(r[1]), r[2]] for r in righe]
            for cod, righe in dati["quartieri"].items()
        }
        (STRADE_OUT / f.name).write_text(dump_json_sicuro({"quartieri": quartieri}), encoding="utf-8")
    for f in sorted(STRADE_OUT.glob("*.json")):
        if check_zero_footprint(f, strade=True) != 0:
            raise SystemExit("Errore: il gate ha trovato footprint in " + str(f) + ". Build FALLITA.")
    print("Strade: " + str(len(vie)) + " vie, gate OK su "
          + str(len(list(STRADE_OUT.glob("*.json")))) + " file.")
    return hash_corto(list(STRADE_OUT.glob("*.json")))


def costruisci_icone_servizi():
    # Un SVG per categoria, letto cosi' com'e' (niente binario, niente base64: e' solo
    # markup e un <title> in italiano, il gate lo attraversa come il resto del bundle).
    icone = {}
    for categoria, nomefile in CATEGORIA_ICONA.items():
        path = ICONE_SRC / nomefile
        if not path.exists():
            raise SystemExit("Errore: icona mancante " + str(path) + ".")
        icone[categoria] = path.read_text(encoding="utf-8").strip()
    return icone


# Campo 9 delle righe dei servizi (scheda del servizio): chiavi note e tipi, niente altro.
# m codici meccanografici, w siti web, ic istituto di riferimento, p posti, z sezioni, l chiuso per lavori.
_RE_CODICE_MIM = re.compile(r"^[A-Za-z0-9]{6,12}$")


def info_servizio_valida(info, riga):
    def errore(perche):
        raise SystemExit("Errore: info non valida (" + perche + ") in servizi.json: " + str(riga)[:120])
    if not isinstance(info, dict):
        errore("non e' un oggetto")
    pulita = {}
    for k, v in info.items():
        if k == "m":
            if not isinstance(v, list) or not all(isinstance(x, str) and _RE_CODICE_MIM.match(x) for x in v):
                errore("m")
            if v: pulita["m"] = list(v)
        elif k == "w":
            if not isinstance(v, list) or not all(isinstance(x, str) and re.match(r"^https?://\S+$", x) for x in v):
                errore("w")
            if v: pulita["w"] = list(v)
        elif k == "ic":
            if not isinstance(v, str):
                errore("ic")
            if v.strip(): pulita["ic"] = v.strip()
        elif k in ("p", "z"):
            if isinstance(v, bool) or not isinstance(v, int) or v < 0:
                errore(k)
            if v: pulita[k] = v
        elif k == "l":
            if isinstance(v, bool) or v not in (0, 1):
                errore("l")
            if v: pulita["l"] = 1
        else:
            errore("chiave sconosciuta " + str(k))
    return pulita


def copia_servizi():
    # Stessa logica di copia_strade(): i punti dei servizi non entrano nel bundle, la
    # mappa li chiede con fetch al primo focus o alla prima citta' dei 15 minuti (un solo
    # file per le due modalita'). Formato a righe {c: [categorie], p: [[indice categoria,
    # nome, codice area, municipio, lat, lon, (indirizzo, dettaglio, "prevista", info)]]},
    # riscritto campo per campo: nient'altro arriva in dist/.
    servizi_path = SERVIZI_SRC / "servizi.json"
    if not servizi_path.exists():
        raise SystemExit("Errore: input mancante " + str(servizi_path) + " (python3 importa_servizi.py).")
    try:
        dati = json.loads(servizi_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit("Errore: " + str(servizi_path) + " non valido (" + str(exc) + ").")
    categorie = [str(c) for c in dati["c"]]
    fuori = [c for c in categorie if c not in CATEGORIA_ICONA]
    if fuori:
        raise SystemExit("Errore: categorie senza icona in " + str(servizi_path) + ": " + ", ".join(fuori))
    punti = []
    for r in dati["p"]:
        if not (6 <= len(r) <= 10) or not (0 <= int(r[0]) < len(categorie)) or (len(r) >= 9 and r[8] not in ("", "prevista")):
            raise SystemExit("Errore: riga non valida in " + str(servizi_path) + ": " + str(r)[:120])
        # campi 6-8 testo; campo 9 = info, oggetto facoltativo che passa com'e' ma validato
        riga = [int(r[0]), str(r[1]), str(r[2]), str(r[3]), round(float(r[4]), 5), round(float(r[5]), 5)] + [str(x) for x in r[6:9]]
        if len(r) == 10:
            info = info_servizio_valida(r[9], r)
            if info:
                riga += [""] * (9 - len(riga)) + [info]
        punti.append(riga)

    if SERVIZI_OUT.exists():
        shutil.rmtree(SERVIZI_OUT)
    SERVIZI_OUT.mkdir(parents=True)
    out_servizi = SERVIZI_OUT / "servizi.json"
    out_servizi.write_text(dump_json_sicuro({"c": categorie, "p": punti}), encoding="utf-8")
    # Gate in modalita' servizi (nomi omonimi) e strade (indirizzi sulle vie omonime).
    if check_zero_footprint(out_servizi, strade=True, servizi=True) != 0:
        raise SystemExit("Errore: il gate ha trovato footprint in " + str(out_servizi) + ". Build FALLITA.")
    print("Servizi: " + str(len(punti)) + " punti in " + str(len(categorie)) + " categorie, gate OK.")
    return hash_corto([out_servizi])


def copia_rete(produzione=False):
    # Citta' dei 15 minuti: la rete pedonale (solo geometria, ~20 MB in 1.175 riquadri,
    # fuori da git: si rifa' con prepara_rete_pedonale.py). Senza rete la build di
    # anteprima non si ferma: avvisa e la mappa esce senza "A piedi in 15 minuti" (versione a None).
    if RETE_OUT.exists():
        shutil.rmtree(RETE_OUT)
    if QUINDICI_VECCHIO_OUT.exists():
        QUINDICI_VECCHIO_OUT.unlink()
    if not (RETE_SRC / "indice.json").exists():
        if produzione:
            raise SystemExit("Errore: manca la rete pedonale " + str(RETE_SRC) + ": la build di produzione "
                             "non esce senza \"A piedi in 15 minuti\" (python3 prepara_rete_pedonale.py).")
        print("ATTENZIONE: manca la rete pedonale " + str(RETE_SRC) + ": la mappa esce SENZA "
              "\"A piedi in 15 minuti\". Per riaverla vedi README, sezione citta' dei 15 minuti.")
        return None
    shutil.copytree(RETE_SRC, RETE_OUT)
    # La rete passa dal gate, file per file: e' solo geometria, ma dist/ si pubblica
    # tutta. In silenzio sui file puliti (sono 1.176), a voce sul primo sporco.
    file_rete = sorted(RETE_OUT.glob("*.json"))
    for f in file_rete:
        uscita = io.StringIO()
        with contextlib.redirect_stdout(uscita):
            esito = check_zero_footprint(f)
        if esito != 0:
            print(uscita.getvalue())
            raise SystemExit("Errore: il gate ha trovato footprint in " + str(f) + ". Build FALLITA.")
    print("15 minuti: " + str(len(list(RETE_OUT.glob("r*.json")))) + " riquadri di rete, gate OK su "
          + str(len(file_rete)) + " file.")
    return hash_corto(file_rete)


def copia_rete_bici():
    # 15 minuti in bici: stesso formato della rete pedonale, coi metri equivalenti a
    # 15 km/h (prepara_rete_bici.py). Facoltativa anche in produzione: senza, la mappa
    # esce col solo "a piedi" (versione a None).
    if RETE_BICI_OUT.exists():
        shutil.rmtree(RETE_BICI_OUT)
    if not (RETE_BICI_SRC / "indice.json").exists():
        print("ATTENZIONE: manca la rete bici " + str(RETE_BICI_SRC) + ": la mappa esce senza "
              "i 15 minuti in bici (python3 prepara_rete_bici.py).")
        return None
    shutil.copytree(RETE_BICI_SRC, RETE_BICI_OUT)
    file_rete = sorted(RETE_BICI_OUT.glob("*.json"))
    for f in file_rete:
        uscita = io.StringIO()
        with contextlib.redirect_stdout(uscita):
            esito = check_zero_footprint(f)
        if esito != 0:
            print(uscita.getvalue())
            raise SystemExit("Errore: il gate ha trovato footprint in " + str(f) + ". Build FALLITA.")
    print("15 minuti in bici: " + str(len(list(RETE_BICI_OUT.glob("r*.json")))) + " riquadri, gate OK.")
    return hash_corto(file_rete)


def copia_ciclabili():
    # Piste e corsie ciclabili, riscritte campo per campo (tipo 0/1 e interi): solo geometria.
    if CICLABILI_OUT.exists():
        shutil.rmtree(CICLABILI_OUT)
    if not CICLABILI_SRC.exists():
        print("ATTENZIONE: manca " + str(CICLABILI_SRC) + ": la mappa esce senza piste ciclabili.")
        return None
    try:
        d = json.loads(CICLABILI_SRC.read_text(encoding="utf-8"))
        linee = [[int(t), [int(x) for x in flat]] for t, flat in d["l"]]
        if any(t not in (0, 1) or len(flat) < 4 or len(flat) % 2 for t, flat in linee):
            raise ValueError("tratti non validi")
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise SystemExit("Errore: " + str(CICLABILI_SRC) + " non valido (" + str(exc) + ").")
    CICLABILI_OUT.mkdir(parents=True)
    f = CICLABILI_OUT / "ciclabili.json"
    f.write_text(json.dumps({"l": linee}, separators=(",", ":")), encoding="utf-8")
    if check_zero_footprint(f) != 0:
        raise SystemExit("Errore: il gate ha trovato footprint in " + str(f) + ". Build FALLITA.")
    print("Piste ciclabili: " + str(len(linee)) + " tratti, gate OK.")
    return hash_corto([f])


def copia_copertura():
    # Esagoni abitati coi minuti a piedi per categoria essenziale, riscritti campo per
    # campo (solo numeri): nient'altro arriva in dist/. Senza il file la build non si
    # ferma, la 2D apre come prima (versione a None).
    if COPERTURA_OUT.exists():
        shutil.rmtree(COPERTURA_OUT)
    if not COPERTURA_NEL_RILASCIO:
        print("Copertura dei 15 minuti spenta (COPERTURA_NEL_RILASCIO): la 2D esce senza esagoni.")
        return None
    if not COPERTURA_SRC.exists():
        print("ATTENZIONE: manca " + str(COPERTURA_SRC) + ": la 2D esce senza lo strato dei 15 minuti "
              "(python3 prepara_copertura_15_minuti.py).")
        return None
    try:
        d = json.loads(COPERTURA_SRC.read_text(encoding="utf-8"))
        e = d["esagono"]
        esagono = {k: float(e[k]) for k in ("lato", "lat0", "lon0", "kx", "ky")}
        categorie = [str(c) for c in d["categorie"]]
        passo = 3 + len(categorie)
        celle = [int(x) for x in d["celle"]]
        if not categorie or len(celle) % passo or any(m < 1 or m > int(d["oltre"]) for i in range(0, len(celle), passo)
                                                       for m in celle[i + 3:i + passo]):
            raise ValueError("celle non coerenti con le categorie")
        out = {"esagono": esagono, "categorie": categorie, "soglia": int(d["soglia"]), "oltre": int(d["oltre"]),
               "abitanti_min": int(d["abitanti_min"]), "celle": celle}
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise SystemExit("Errore: " + str(COPERTURA_SRC) + " non valido (" + str(exc) + ").")
    COPERTURA_OUT.mkdir(parents=True)
    f = COPERTURA_OUT / "copertura.json"
    f.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    if check_zero_footprint(f) != 0:
        raise SystemExit("Errore: il gate ha trovato footprint in " + str(f) + ". Build FALLITA.")
    print("Copertura dei 15 minuti: " + str(len(celle) // passo) + " esagoni, gate OK.")
    return hash_corto([f])


def copia_vista_3d():
    # MapLibre GL 4.7.1 (BSD-3, licenza accanto) e il modulo della vista 3D. Il gate passa
    # su ogni file. Nel MapLibre minificato quattro accessi "p.d" (polylabel) possono
    # somigliare a un termine dell'elenco: si riscrivono p["d"], identico per JavaScript; il conteggio
    # esatto fa fallire il build se una nuova versione cambia il codice.
    if VISTA3D_OUT.exists():
        shutil.rmtree(VISTA3D_OUT)
    VISTA3D_OUT.mkdir(parents=True)
    js = leggi_input_obbligatorio(MAPLIBRE_DIR / "maplibre-gl.js")
    js, n = re.subn(r"\bp\.d\b", 'p["d"]', js)
    if n != 4:
        raise SystemExit("Errore: attesi 4 accessi p.d in maplibre-gl.js, trovati " + str(n) + ".")
    js = re.sub(r"\n//# sourceMappingURL=\S+\s*$", "\n", js)   # la .map non si pubblica
    (VISTA3D_OUT / "maplibre-gl.js").write_text(js, encoding="utf-8")
    for src, nome in ((MAPLIBRE_DIR / "maplibre-gl.css", "maplibre-gl.css"),
                      (MAPLIBRE_DIR / "LICENSE.txt", "LICENSE-maplibre-gl.txt"),
                      (VISTA3D_SRC / "vista-3d.js", "vista-3d.js"),
                      (VISTA3D_SRC / "vista-3d.css", "vista-3d.css")):
        (VISTA3D_OUT / nome).write_text(leggi_input_obbligatorio(src), encoding="utf-8")
    file_3d = sorted(VISTA3D_OUT.iterdir())
    for f in file_3d:
        uscita = io.StringIO()
        with contextlib.redirect_stdout(uscita):
            esito = check_zero_footprint(f)
        if esito != 0:
            print(uscita.getvalue())
            raise SystemExit("Errore: il gate ha trovato footprint in " + str(f) + ". Build FALLITA.")
    print("Vista 3D: " + str(len(file_3d)) + " file in dist/3d/, gate OK.")
    return hash_corto(file_3d)


def main(argv=None):
    produzione = "--produzione" in (sys.argv[1:] if argv is None else argv)
    print("Mappa Quartieri di Roma 2026: avvio build" + (" di produzione." if produzione else "."))

    template = leggi_input_obbligatorio(TEMPLATE_PATH)
    leaflet_css = leggi_input_obbligatorio(LEAFLET_CSS_PATH)
    leaflet_js = leggi_input_obbligatorio(LEAFLET_JS_PATH)
    quartieri_raw = leggi_input_obbligatorio(QUARTIERI_PATH)
    municipi_raw = leggi_input_obbligatorio(MUNICIPI_PATH)

    try:
        quartieri_geojson = json.loads(quartieri_raw)
    except json.JSONDecodeError as exc:
        raise SystemExit("Errore: " + str(QUARTIERI_PATH) + " non valido (" + str(exc) + ").")
    try:
        municipi_geojson = json.loads(municipi_raw)
    except json.JSONDecodeError as exc:
        raise SystemExit("Errore: " + str(MUNICIPI_PATH) + " non valido (" + str(exc) + ").")

    n_quartieri = len(quartieri_geojson.get("features", []))
    n_municipi = len(municipi_geojson.get("features", []))
    print("Letti " + str(n_quartieri) + " quartieri/rioni/zone funzionali.")
    print("Letti " + str(n_municipi) + " confini di municipio.")

    quartieri_geojson = whitelist_feature_collection(quartieri_geojson, QUARTIERI_PROPERTIES_WHITELIST)
    quartieri_geojson = normalizza_denominazioni(quartieri_geojson)
    municipi_geojson = whitelist_feature_collection(municipi_geojson, MUNICIPI_PROPERTIES_WHITELIST)
    print("Properties ricostruite con whitelist.")

    urbe_logo = data_uri_png(URBE_LOGO_PATH)
    icone_servizi = costruisci_icone_servizi()
    print("Icone servizi: " + str(len(icone_servizi)) + " categorie inlinate.")

    # Prima i dati a parte (gate compreso), poi il bundle: index.html porta l'hash di
    # ciascun gruppo di file e chiede ?v=<hash>, cosi' la cache lunga non serve mai
    # un file vecchio.
    versioni = {
        "strade": copia_strade(),
        "servizi": copia_servizi(),
        "rete": copia_rete(produzione),
        "bici": copia_rete_bici(),
        "ciclabili": copia_ciclabili(),
        "copertura": copia_copertura(),
        "3d": copia_vista_3d(),
    }
    scrivi_vercel_json(produzione)
    copia_licenze_e_og()

    for marker in (MARKER_FONTS_CSS, MARKER_LEAFLET_CSS, MARKER_LEAFLET_JS, MARKER_QUARTIERI,
                   MARKER_MUNICIPI, MARKER_URBE_LOGO, MARKER_ICONE_SERVIZI, MARKER_VERSIONI,
                   MARKER_VISTA3D_CSS, MARKER_VISTA3D_JS, MARKER_INTRO_SVG, MARKER_STATISTICHE_TAG,
                   MARKER_STATISTICHE_LINK, MARKER_STATISTICHE_LINK_FINE, MARKER_STATISTICHE_URL):
        occorrenze = template.count(marker)
        if occorrenze != 1:
            raise SystemExit(
                "Errore: marker " + marker + " atteso esattamente 1 volta, trovato "
                + str(occorrenze) + " nel template."
            )

    output = senza_noindex(template) if produzione else template
    output = applica_statistiche(output)
    print("Statistiche: " + ("accese (" + STATISTICHE_HOST + ", solo su " + STATISTICHE_DOMINI + ")" if statistiche_id() else "spente (manca l'ID del sito)")
          + ", link pubblico " + ("nel pannello." if statistiche_link() else "assente."))
    output = output.replace(MARKER_FONTS_CSS, costruisci_fonts_css())
    output = output.replace(MARKER_LEAFLET_CSS, leaflet_css)
    output = output.replace(MARKER_LEAFLET_JS, escava_chiusura_script(leaflet_js))
    output = output.replace(MARKER_QUARTIERI, dump_json_sicuro(compatta_feature_collection(quartieri_geojson)))
    output = output.replace(MARKER_MUNICIPI, dump_json_sicuro(municipi_geojson))
    output = output.replace(MARKER_URBE_LOGO, urbe_logo)
    output = output.replace(MARKER_INTRO_SVG, costruisci_intro_svg(municipi_geojson))
    output = output.replace(MARKER_ICONE_SERVIZI, dump_json_sicuro(icone_servizi))
    output = output.replace(MARKER_VERSIONI, dump_json_sicuro(versioni))
    output = output.replace(MARKER_VISTA3D_CSS, leggi_input_obbligatorio(VISTA3D_SRC / "aggancio.css"))
    output = output.replace(MARKER_VISTA3D_JS, escava_chiusura_script(leggi_input_obbligatorio(VISTA3D_SRC / "aggancio.js")))

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(output, encoding="utf-8")
    print("Scritto " + str(OUTPUT_PATH) + " (" + str(len(output)) + " caratteri).")

    esito_gate = check_zero_footprint(OUTPUT_PATH)
    if esito_gate != 0:
        raise SystemExit(
            "Errore: il gate zero-footprint ha trovato footprint nel bundle "
            "(" + str(OUTPUT_PATH) + "). Build FALLITA, output NON pubblicabile."
        )
    print("Gate zero-footprint: OK, nessun footprint nel bundle.")
    print("Build completata.")


if __name__ == "__main__":
    main()
