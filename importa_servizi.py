#!/usr/bin/env python3
"""
Scarica dal WFS GeoRoma il "Piano dei Servizi" di Roma Capitale
(layer DIPAU:punti_servizi_7792, campi nome/strato/fam/lat/long), ci unisce
scuole e presidi sanitari della citta' dei 15 minuti (data/servizi-15-minuti.json)
e produce data/servizi/servizi.json (formato a righe, vedi in fondo a main),
pronto per i servizi nel focus della mappa.

Scuole e sanita' vengono dalla citta' dei 15 minuti, che e' piu' precisa: le scuole
distinte per tipo (prepara_scuole.py), case della comunita' e pronto soccorso
(prepara_servizi_15_minuti.py). Dal Piano dei Servizi
si tolgono quindi gli strati delle scuole e degli ospedali (STRATI_SOSTITUITI);
della sanita' restano ambulatori e sportelli CUP, tranne quelli entro
SOGLIA_PRESIDIO_METRI da una casa della comunita' o da un pronto soccorso
(stesso edificio o stesso complesso: il presidio c'e' gia').

Fonte: https://geoportale.comune.roma.it/geoserver/ows, layer
DIPAU:punti_servizi_7792, Roma Capitale. Dati aperti: riuso consentito ai sensi
dell'art. 52, comma 2, del CAD (D.Lgs. 82/2005), con citazione della fonte.

Pipeline: scarico -> escludo gli strati sensibili -> tolgo gli strati sostituiti
e quelli senza categoria -> scarto i punti fuori dal
confine di Roma (data/municipi-roma.geojson) -> scarto i doppioni evidenti
(stesso nome normalizzato entro 30 m) -> assegno area e municipio con un
point-in-polygon su data/quartieri-2026.simplified.geojson -> mappo lo strato
sulla categoria (dizionario CATEGORIE) -> aggiungo scuole e presidi della citta'
dei 15 minuti (stesso point-in-polygon) -> accorpo lo stesso posto ripetuto
(accorpa_doppioni) -> scrivo il file, ordinando l'output per
renderlo riproducibile a parita' di dati sorgente.

Dettagli delle scuole (decimo campo di ogni riga, indice 9): oggetto facoltativo con le
chiavi corte m (codici meccanografici MIM), w (siti web), ic (istituto di riferimento, solo
statali), p (posti) e z (sezioni) di nidi e infanzie comunali, l (1 se chiuso per lavori).
Vengono da data/scuole-dettagli.json (prepara_scuole.py --dettagli), agganciato alle scuole
per (tipo, nome, indirizzo); se l'oggetto c'e', i campi 6, 7 e 8 ci sono sempre (stringa
vuota se mancano), cosi' l'indice 9 non si sposta. Nell'accorpamento le liste m e w si
uniscono senza ripetizioni, gli istituti diversi si uniscono con " · ", p e z si sommano
(sono record distinti: i valori del portale sono gia' per scuola), l resta solo se sono
chiusi per lavori tutti i record del gruppo.

Farmacie: nel Piano dei Servizi portano il nome del titolare (persona fisica). Nella
mappa hanno nome "Farmacia" (o "Farmacia comunale" per le comunali e Farmacap) e, come
indirizzo, "<via e civico>": il civico ufficiale piu' vicino entro SOGLIA_CIVICO_METRI dai
numeri civici di Roma Capitale. Senza civico vicino resta il solo nome, e la scheda mostra
l'area. Il nome non ripete mai categoria e indirizzo.

Uso (prima prepara_servizi_15_minuti.py, se cambiano scuole o presidi):
    python3 importa_servizi.py <civici_*.csv ...>
    python3 importa_servizi.py --solo-accorpa   (solo l'accorpamento, sul file gia' scritto)
    python3 importa_servizi.py --solo-farmacie  (senza rete: porta le farmacie di un file scritto
                                                 col vecchio formato "Farmacia · <via>" al formato
                                                 nome + indirizzo; ripetibile, poi riaccorpa)
    python3 importa_servizi.py --solo-scuole    (senza rete: rifa' solo le scuole, da
                                                 data/servizi-15-minuti.json e data/scuole-dettagli.json,
                                                 sul servizi.json gia' scritto; le altre categorie restano)
I civici sono quelli di prepara_scuole.py (WFS GeoRoma DIPCUL:GeoromaCiviciLocator in
CSV, a pagine da 200mila: outputFormat=csv&count=200000&startIndex=0|200000|400000&sortBy=ID_CIVICO).
"""

import csv
import difflib
import json
import math
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from prepara_scuole import titolo  # stessa resa di vie e nomi delle scuole ("Viale dell'Oceano")
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DATA = SCRIPT_DIR / "data"
OUT_DIR = DATA / "servizi"
OUT_PATH = OUT_DIR / "servizi.json"

WFS_URL = (
    "https://geoportale.comune.roma.it/geoserver/ows"
    "?service=WFS&version=2.0.0&request=GetFeature"
    "&typeName=DIPAU:punti_servizi_7792&outputFormat=application/json"
)

QUINDICI_PATH = DATA / "servizi-15-minuti.json"
DETTAGLI_PATH = DATA / "scuole-dettagli.json"
QUARTIERI_PATH = DATA / "quartieri-2026.simplified.geojson"
MUNICIPI_PATH = DATA / "municipi-roma.geojson"

SOGLIA_DOPPIONE_METRI = 30.0

# Ambulatori e CUP entro questa distanza da una casa della comunita' o da un pronto
# soccorso sono lo stesso presidio (poliambulatori che ospitano la casa della
# comunita', CUP dentro l'ospedale): il marker c'e' gia', non si ripete. Sui dati
# del 2026-10-28 i casi veri arrivano a 98 m (Poliambulatori Acilia).
SOGLIA_PRESIDIO_METRI = 100.0

# Strati esclusi sempre: la posizione pubblica potrebbe mettere a rischio persone
# (centri antiviolenza, case rifugio, accoglienza vittime, comunita' protette per
# minori, simili). Nel dubbio si esclude: vedi README per le decisioni aperte.
STRATI_ESCLUSI = {
    "Centri Antiviolenza",
}

# Strati che la citta' dei 15 minuti copre meglio: scuole (distinte per tipo) e
# ospedali (i pronto soccorso). Non entrano nell'output, li sostituisce QUINDICI_CATEGORIE.
STRATI_SOSTITUITI = {
    "Scuole",
    "Asili Nido Comunali",
    "Asili Nido Autorizzati",
    "Scuole Paritarie",
    "Scuole Infanzia Comunali",
    "Ospedali",
}

# Tipo della citta' dei 15 minuti (campo "t") -> (categoria, famiglia).
QUINDICI_CATEGORIE = {
    "nido": ("nido", "Educazione"),
    "infanzia": ("infanzia", "Educazione"),
    "primaria": ("primaria", "Educazione"),
    "media": ("media", "Educazione"),
    "superiore": ("superiore", "Educazione"),
    "cdc": ("casa_comunita", "Salute"),
    "ps": ("pronto_soccorso", "Salute"),
    # pronto soccorso col campo x (prepara_servizi_15_minuti.py): categoria a parte,
    # coerente coi 15 minuti, che non li contano come pronto soccorso di riferimento
    "ps:specialistico": ("pronto_soccorso_specialistico", "Salute"),
    "ps:pediatrico": ("pronto_soccorso_pediatrico", "Salute"),
}
CATEGORIE_PRESIDIO = ("casa_comunita", "pronto_soccorso", "pronto_soccorso_specialistico",
                      "pronto_soccorso_pediatrico")

SOGLIA_CIVICO_METRI = 30.0
FARMACIA_COMUNALE = re.compile(r"\bCOM(UNALE|\.\s*LE)\b|FARMACAP", re.I)

# Strato -> categoria.
# Gli strati non elencati qui non entrano nell'output (elenco nel README).
CATEGORIE = {
    "Farmacie": "farmacie",
    "Biblioteche Comunali": "biblioteche",
    "Polo Bibliotecario Regione Lazio": "biblioteche",
    "Mercati Rionali": "mercati",
    "Parchi Attrezzati": "parchi_e_aree_gioco",
    "Playground": "parchi_e_aree_gioco",
    "Centri Sportivi Municipali": "impianti_sportivi",
    "Impianti Sportivi Capitolini": "impianti_sportivi",
    "Piscine Comunali": "impianti_sportivi",
    "Musei": "musei_e_cultura",
    "Teatri e spazi culturali di recitazione": "musei_e_cultura",
    "Sale Cinematografiche": "musei_e_cultura",
    "Centri Culturali": "musei_e_cultura",
    "Case Sociali delle Persone Anziane": "centri_anziani",
    "Consultori": "consultori",
    "Ambulatori e altre strutture sanitarie": "sanita",
    "Sportelli CUP": "sanita",
}

# Connettivi italiani che restano minuscoli a meta' nome (non in prima posizione)
# e sigle/abbreviazioni che restano come arrivano: usati solo quando il nome e'
# interamente maiuscolo, per renderlo leggibile senza inventare un nome diverso.
CONNETTIVI = {
    "di", "d'", "da", "de", "del", "della", "delle", "dei", "degli", "dello",
    "e", "ed", "in", "con", "su", "per", "tra", "fra", "il", "lo", "la", "le", "un", "a",
}
ABBREVIAZIONI = {"snc", "srl", "spa", "sas", "caf", "cup", "asl", "ic", "c.a.p", "sncc"}


def json_compatto(dati):
    return json.dumps(dati, ensure_ascii=False, separators=(",", ":"))


def scarica_wfs(url):
    with urllib.request.urlopen(url, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


def normalizza_nome(nome):
    """Spazi puliti sempre; maiuscole coerenti solo se il nome arriva tutto in
    maiuscolo (caso frequente in questo layer), con un piccolo elenco di
    eccezioni per connettivi e sigle. Non inventa ne' corregge il contenuto."""
    nome = re.sub(r"\s+", " ", nome.strip())
    lettere = [c for c in nome if c.isalpha()]
    if lettere and all(c.isupper() for c in lettere):
        parole = nome.split(" ")
        rifatte = []
        for i, parola in enumerate(parole):
            chiave = parola.lower().strip(".")
            if chiave in ABBREVIAZIONI:
                rifatte.append(parola)
            elif i > 0 and chiave in CONNETTIVI:
                rifatte.append(chiave)
            else:
                rifatte.append(parola.capitalize())
        nome = " ".join(rifatte)
    return nome


def distanza_metri(lat1, lon1, lat2, lon2):
    raggio = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * raggio * math.asin(math.sqrt(a))


# Accorpamento finale (accorpa_doppioni): stesso posto nella stessa categoria, un
# solo marker. Due regole, su tutti i punti in uscita (Piano dei Servizi e citta'
# dei 15 minuti):
#   - stesso nome, a meno delle sigle (I.I.S., I.C., Succ., ...), entro
#     SOGLIA_STESSO_NOME_METRI: due sedi o due ingressi dello stesso istituto
#     ("I.I.S. Confalonieri de Chirico", Via Beata Maria de Mattias 5 e Largo
#     Pannonia 37), lo stesso parco con due punti, la farmacia registrata due volte;
#   - solo scuole: stesso indirizzo entro SOGLIA_STESSO_INDIRIZZO_METRI, anche con
#     nomi diversi (i codici ministeriali di un istituto sono uno per indirizzo di
#     studio: "Liceo Classico ..." e "Liceo Scientifico ..." nello stesso edificio).
# Secondo giro (2026-10-31, caso Villa Fiorelli: "Parco di Villa Fiorelli" e "Villa
# Fiorelli" a 39 m), sempre nella stessa categoria:
#   - stesso nome base (nome_base: senza note tra parentesi, ripetizioni della fonte,
#     articoli e, per i parchi, senza "Parco/Giardino/Area verde" in testa) entro
#     SOGLIA_STESSO_NOME_METRI, o SOGLIA_PARCO_METRI per i parchi (piu' ingressi);
#   - nome base uguale a meno dei numeri ("Poliambulatorio Boccea 265" e "625")
#     entro SOGLIA_NUMERI_METRI;
#   - fuori dalle scuole, un nome base contenuto nell'altro entro SOGLIA_CONTENUTO_METRI
#     ("Apulia" e "Poliambulatorio via Apulia", "Teatro Argentina" e il suo museo);
#   - scuole con lo stesso indirizzo col civico entro SOGLIA_STESSO_CIVICO_METRI: lo
#     stesso civico geocodificato da due fonti finisce anche a 140 m;
#   - farmacie entro SOGLIA_FARMACIE_METRI, o allo stesso indirizzo: per legge due
#     farmacie stanno ad almeno 200 m, piu' vicine e' la stessa registrata due volte.
# Il conteggio segue: uno per posto.
SOGLIA_STESSO_NOME_METRI = 150.0
SOGLIA_STESSO_INDIRIZZO_METRI = 30.0
SOGLIA_PARCO_METRI = 300.0
SOGLIA_NUMERI_METRI = 50.0
SOGLIA_CONTENUTO_METRI = 60.0
SOGLIA_STESSO_CIVICO_METRI = 150.0
SOGLIA_FARMACIE_METRI = 60.0
ARTICOLI = {"di", "d", "del", "dello", "della", "dell", "dei", "degli", "delle", "da",
            "e", "ed", "il", "lo", "la", "l", "i", "gli", "le", "al", "alla"}
TIPO_PARCO = {"parco", "parchi", "giardino", "giardini", "area", "aree", "verde", "verdi",
              "attrezzato", "pubblico", "giochi"}
NOMI_GENERICI = {"playground"}  # tanti punti diversi con lo stesso nome: mai accorpati per nome
CATEGORIE_SCUOLA = {"nido", "infanzia", "primaria", "media", "superiore"}
SIGLE_IGNORATE = {"i", "c", "ic", "iis", "is", "sms", "succ", "succursale"}
# Parole che da sole non fanno un nome: il nome comune di un gruppo deve averne altre.
PAROLE_GENERICHE = {
    "liceo", "lic", "l", "classico", "cl", "c", "scientifico", "sc", "s", "linguistico", "ling",
    "istituto", "ist", "scuola", "materna", "tecnico", "commerciale", "scienze", "umane",
    "sportivo", "internazionale", "opzione", "op", "opz", "ind", "sez", "musicale", "economico",
    "sociale", "applicate", "srl", "via", "di", "del", "della", "delle", "dei", "e",
}


def _parole(testo, togli=()):
    piano = unicodedata.normalize("NFKD", testo).encode("ascii", "ignore").decode().lower()
    return [p for p in re.split(r"[^a-z0-9]+", piano) if p and p not in togli]


def _poco_informativo(nome):
    """Un nome fatto solo di parole generiche ("Liceo Linguistico") o di un
    indirizzo ("Via Montezebio"): in un gruppo va dopo gli altri."""
    parole = _parole(nome)
    return not parole or parole[0] in ("via", "viale", "piazza", "largo") or all(
        p in PAROLE_GENERICHE for p in parole)


def nome_pulito(nome):
    """Il nome ripetuto dalla fonte con la virgola ("Villa Borghese,Villa Borghese") una volta sola."""
    parti = [p.strip() for p in nome.split(",")]
    if len(parti) > 1 and len({" ".join(_parole(p)) for p in parti}) == 1:
        return parti[0]
    return nome


def nome_base(nome, categoria):
    """Le parole che identificano il posto: senza parentesi, sigle e articoli; per i
    parchi anche senza il tipo in testa ("Parco di Villa Fiorelli" -> villa fiorelli)."""
    parole = [p for p in _parole(re.sub(r"\([^)]*\)", "", nome_pulito(nome)), SIGLE_IGNORATE)
              if p not in ARTICOLI]
    if categoria == "parchi_e_aree_gioco":
        while parole and parole[0] in TIPO_PARCO:
            parole = parole[1:]
    return parole


def _senza_numeri(parole):
    return [p for p in parole if not re.fullmatch(r"\d+[a-z]?", p)]


def stesso_posto(categoria, a, b, d):
    """Le regole del secondo giro (vedi sopra) per due punti a distanza d."""
    ind_a = a[6][0] if a[6] else ""
    ind_b = b[6][0] if b[6] else ""
    if categoria == "farmacie":
        return d <= SOGLIA_FARMACIE_METRI or bool(ind_a and ind_a == ind_b)
    if categoria in CATEGORIE_SCUOLA and ind_a and ind_a == ind_b and re.search(r"\d", ind_a) \
            and d <= SOGLIA_STESSO_CIVICO_METRI:
        return True
    ba, bb = nome_base(a[1], categoria), nome_base(b[1], categoria)
    if not ba or not bb or " ".join(ba) in NOMI_GENERICI or " ".join(bb) in NOMI_GENERICI:
        return False
    soglia = SOGLIA_PARCO_METRI if categoria == "parchi_e_aree_gioco" else SOGLIA_STESSO_NOME_METRI
    if ba == bb and d <= soglia:
        return True
    if _senza_numeri(ba) and _senza_numeri(ba) == _senza_numeri(bb) and d <= SOGLIA_NUMERI_METRI:
        return True
    if categoria not in CATEGORIE_SCUOLA and d <= SOGLIA_CONTENUTO_METRI:
        sa, sb = set(ba), set(bb)
        corto = sa if len(sa) <= len(sb) else sb
        return (sa <= sb or sb <= sa) and len("".join(corto)) >= 5
    return False


def nome_accorpato(categoria, nomi):
    """Il nome di un gruppo. Stesso nome base: il nome intero piu' corto ("Parco Falcone
    Borsellino", non la parte comune "Parco Falcone"), anche se differiscono per un refuso
    ("Maisonette" e "Maisonnette"). Fuori dalle scuole, un nome corto che contiene tutti
    gli altri ("Poliambulatorio via Apulia") o contenuto in tutti ("Casa Di Cura Salus
    Infirmorum"). Altrimenti nome_del_gruppo()."""
    basi = [nome_base(n, categoria) for n in nomi]
    ordinati = sorted(set(nomi), key=lambda n: (_poco_informativo(n), len(n), n))
    if any(b != basi[0] for b in basi) and all(_senza_numeri(b) == _senza_numeri(basi[0]) for b in basi):
        return nome_del_gruppo(nomi)  # "Poliambulatorio Boccea 265" e "625": senza il numero
    if all(b == basi[0] for b in basi) or all(
            difflib.SequenceMatcher(None, ordinati[0].lower(), n.lower()).ratio() >= 0.9 for n in ordinati):
        return ordinati[0]
    if categoria not in CATEGORIE_SCUOLA:
        for n in ordinati:
            if len(n) <= 40 and all(set(b) <= set(nome_base(n, categoria)) for b in basi):
                return n
        for n in ordinati:
            if not _poco_informativo(n) and all(set(nome_base(n, categoria)) <= set(b) for b in basi):
                return n
    return nome_del_gruppo(nomi)


def nome_del_gruppo(nomi):
    """Un nome per un gruppo accorpato. Stesso nome a meno delle sigle: il piu'
    corto. Nomi diversi: la parte comune a tutti se dice qualcosa ("Maria
    Ausiliatrice", "Kennedy"), altrimenti i due nomi piu' informativi e quanti altri."""
    nomi = sorted(set(nomi), key=lambda n: (_poco_informativo(n), len(n), n))
    if len({" ".join(_parole(n, SIGLE_IGNORATE)) for n in nomi}) == 1:
        return nomi[0]
    liste = [_parole(n) for n in nomi]
    for k, base in enumerate(liste):
        for lung in range(len(base), 0, -1):
            for i in range(len(base) - lung + 1):
                pezzo = base[i:i + lung]
                if pezzo[0] in PAROLE_GENERICHE or pezzo[-1] in PAROLE_GENERICHE:
                    continue
                # una parola sola basta solo se e' gia' il nome di uno del gruppo ("Kennedy")
                if lung == 1 and not any(l == pezzo for l in liste):
                    continue
                if not all(" " + " ".join(pezzo) + " " in " " + " ".join(l) + " " for l in liste):
                    continue
                # la stessa sequenza nel nome originale, con maiuscole e punteggiatura sue
                trovato = re.search(r"\b" + r"[^A-Za-z0-9]+".join(re.escape(p) for p in pezzo) + r"\b",
                                    nomi[k], re.I)
                if trovato:
                    return trovato.group(0)
    altri = len(nomi) - 2
    return " / ".join(nomi[:2]) + (" e altri " + str(altri) if altri > 0 else "")


def unisci_dettagli(schede):
    """Unisce gli oggetti dei dettagli (uno per record del gruppo, {} se manca): m e w senza
    ripetizioni nell'ordine dei record, ic diversi uniti con " · ", p e z sommati, l a 1 solo
    se tutti i record sono chiusi per lavori. Ritorna {} se non resta nulla."""
    out = {}
    for chiave_d in ("m", "w"):
        voci = []
        for d in schede:
            for v in d.get(chiave_d, ()):
                if v not in voci:
                    voci.append(v)
        if voci:
            out[chiave_d] = voci
    istituti = []
    for d in schede:
        for v in (d.get("ic") or "").split(" · "):
            if v and v not in istituti:
                istituti.append(v)
    if istituti:
        out["ic"] = " · ".join(istituti)
    for chiave_d in ("p", "z"):
        tot = sum(d.get(chiave_d, 0) for d in schede)
        if tot:
            out[chiave_d] = tot
    if schede and all(d.get("l") for d in schede):
        out["l"] = 1
    return out


def accorpa_doppioni(punti):
    """punti: tuple (categoria, nome, codice area, municipio, lat, lon, extra) con
    extra = (indirizzo, dettaglio, "prevista", dettagli-scuola) facoltativi. Ritorna la
    lista accorpata: per ogni gruppo il punto col nome piu' corto tiene posizione e area,
    indirizzi e dettagli diversi si uniscono con " · ", "prevista" resta solo se lo
    sono tutti, l'oggetto dei dettagli si unisce con unisci_dettagli()."""
    punti = [(p[0], nome_pulito(p[1])) + tuple(p[2:]) for p in punti]
    genitore = list(range(len(punti)))

    def radice(i):
        while genitore[i] != i:
            genitore[i] = genitore[genitore[i]]
            i = genitore[i]
        return i

    per_categoria = {}
    for i, p in enumerate(punti):
        per_categoria.setdefault(p[0], []).append(i)
    for categoria, indici in per_categoria.items():
        # Farmacie: il nome e' uguale per tutte, a distinguerle e' l'indirizzo.
        chiavi = [(" ".join(_parole(punti[i][1] + (" " + punti[i][6][0] if categoria == "farmacie" and punti[i][6] else ""),
                                    SIGLE_IGNORATE)),
                   " ".join(_parole(punti[i][6][0])) if punti[i][6] else "") for i in indici]
        for a in range(len(indici)):
            for b in range(a + 1, len(indici)):
                pa, pb = punti[indici[a]], punti[indici[b]]
                if abs(pa[4] - pb[4]) > 0.003:  # ~330 m in latitudine: fuori soglia di sicuro
                    continue
                d = distanza_metri(pa[4], pa[5], pb[4], pb[5])
                stesso_nome = chiavi[a][0] == chiavi[b][0] and d <= SOGLIA_STESSO_NOME_METRI
                stesso_indirizzo = (categoria in CATEGORIE_SCUOLA and chiavi[a][1]
                                    and chiavi[a][1] == chiavi[b][1] and d <= SOGLIA_STESSO_INDIRIZZO_METRI)
                if stesso_nome or stesso_indirizzo or stesso_posto(categoria, pa, pb, d):
                    genitore[radice(indici[a])] = radice(indici[b])

    gruppi = {}
    for i in range(len(punti)):
        gruppi.setdefault(radice(i), []).append(punti[i])
    out = []
    for gruppo in gruppi.values():
        if len(gruppo) == 1:
            out.append(gruppo[0])
            continue
        gruppo.sort(key=lambda p: (len(p[1]), p[1], p[4], p[5]))
        primo_farmacia = gruppo[0][0] == "farmacie"
        if primo_farmacia:
            # una farmacia sola: la comunale, se c'e', da' nome e indirizzo (meglio se ce l'ha)
            gruppo.sort(key=lambda p: (not FARMACIA_COMUNALE.search(p[1]), not p[6]))
        primo = gruppo[0]

        def distinti(k):
            visti = []
            for p in gruppo:
                v = p[6][k] if len(p[6]) > k else ""
                if v and v not in visti:
                    visti.append(v)
            return " · ".join(visti)

        extra = [primo[6][0] if primo_farmacia and primo[6] else distinti(0), distinti(1),
                 "prevista" if all(len(p[6]) > 2 and p[6][2] == "prevista" for p in gruppo) else "",
                 unisci_dettagli([p[6][3] if len(p[6]) > 3 else {} for p in gruppo])]
        while extra and not extra[-1]:
            extra.pop()
        nome = primo[1] if primo_farmacia else nome_accorpato(primo[0], [p[1] for p in gruppo])
        out.append((primo[0], nome, primo[2], primo[3],
                    primo[4], primo[5], tuple(extra)))
    return out


def punto_in_anello(lon, lat, anello):
    dentro = False
    n = len(anello)
    j = n - 1
    for i in range(n):
        xi, yi = anello[i][0], anello[i][1]
        xj, yj = anello[j][0], anello[j][1]
        if (yi > lat) != (yj > lat):
            x_int = (xj - xi) * (lat - yi) / (yj - yi) + xi
            if lon < x_int:
                dentro = not dentro
        j = i
    return dentro


def punto_in_poligono(lon, lat, poligono):
    if not punto_in_anello(lon, lat, poligono[0]):
        return False
    return all(not punto_in_anello(lon, lat, buco) for buco in poligono[1:])


def punto_in_geometria(lon, lat, geometry):
    if geometry["type"] == "Polygon":
        return punto_in_poligono(lon, lat, geometry["coordinates"])
    if geometry["type"] == "MultiPolygon":
        return any(punto_in_poligono(lon, lat, p) for p in geometry["coordinates"])
    return False


def bbox_di(geometry):
    lons, lats = [], []
    anelli = (geometry["coordinates"] if geometry["type"] == "Polygon"
              else [anello for pol in geometry["coordinates"] for anello in pol])
    for anello in anelli:
        for lon, lat in anello:
            lons.append(lon)
            lats.append(lat)
    return min(lons), min(lats), max(lons), max(lats)


def dentro_bbox(lon, lat, bbox):
    minlon, minlat, maxlon, maxlat = bbox
    return minlon <= lon <= maxlon and minlat <= lat <= maxlat


def punto_a_segmento_metri(lon, lat, lon1, lat1, lon2, lat2):
    """Distanza approssimata in metri punto-segmento, proiezione equirettangolare
    locale (sufficiente su distanze di poche decine di metri)."""
    mlat = 111320.0
    mlon = 111320.0 * math.cos(math.radians(lat))
    x, y = lon * mlon, lat * mlat
    x1, y1 = lon1 * mlon, lat1 * mlat
    x2, y2 = lon2 * mlon, lat2 * mlat
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))


def distanza_a_geometria_metri(lon, lat, geometry):
    anelli = (geometry["coordinates"] if geometry["type"] == "Polygon"
              else [anello for pol in geometry["coordinates"] for anello in pol])
    migliore = None
    for anello in anelli:
        n = len(anello)
        for i in range(n):
            lon1, lat1 = anello[i]
            lon2, lat2 = anello[(i + 1) % n]
            d = punto_a_segmento_metri(lon, lat, lon1, lat1, lon2, lat2)
            if migliore is None or d < migliore:
                migliore = d
    return migliore


# Tolleranza per il fallback "area piu' vicina": sui 23 punti che point-in-polygon
# non assegnava (verificato a mano, tutti scuole/stazioni/farmacie dentro Roma
# finite nel micro-gap della semplificazione dei poligoni) la distanza peggiore
# osservata era 28 m; 50 m lascia margine senza rischiare di agganciare un'area
# sbagliata.
SOGLIA_AREA_VICINA_METRI = 50.0


def trova_area_vicina(lon, lat, poligoni, soglia_metri=SOGLIA_AREA_VICINA_METRI):
    migliore, migliore_d = None, None
    for p in poligoni:
        d = distanza_a_geometria_metri(lon, lat, p["geometry"])
        if migliore_d is None or d < migliore_d:
            migliore, migliore_d = p, d
    if migliore is not None and migliore_d <= soglia_metri:
        return migliore["props"]
    return None


def carica_poligoni(path, campi):
    grezzo = json.loads(path.read_text(encoding="utf-8"))
    poligoni = []
    for f in grezzo["features"]:
        poligoni.append({
            "bbox": bbox_di(f["geometry"]),
            "geometry": f["geometry"],
            "props": {k: f["properties"].get(k) for k in campi},
        })
    return poligoni


def trova_area(lon, lat, poligoni):
    for p in poligoni:
        if dentro_bbox(lon, lat, p["bbox"]) and punto_in_geometria(lon, lat, p["geometry"]):
            return p["props"]
    return None


def carica_dettagli():
    """Dettagli delle scuole (prepara_scuole.py --dettagli): (tipo, nome, indirizzo) -> oggetto.
    Senza il file le righe restano come prima."""
    if not DETTAGLI_PATH.exists():
        print("attenzione: manca " + str(DETTAGLI_PATH) + ", scuole senza dettagli.")
        return {}
    righe = json.loads(DETTAGLI_PATH.read_text(encoding="utf-8"))["dettagli"]
    return {(t, n, i): d for t, n, i, d in righe}


def carica_quindici():
    """Scuole e presidi della citta' dei 15 minuti, gia' puliti dai loro script."""
    if not QUINDICI_PATH.exists():
        raise SystemExit("Errore: manca " + str(QUINDICI_PATH) + " (python3 prepara_servizi_15_minuti.py).")
    dati = json.loads(QUINDICI_PATH.read_text(encoding="utf-8"))
    dettagli = carica_dettagli()
    punti = []
    for s in dati["servizi"]:
        tipo = s["t"] + (":" + s["x"] if s.get("x") else "")
        if tipo not in QUINDICI_CATEGORIE:
            raise SystemExit("Errore: tipo sconosciuto in " + str(QUINDICI_PATH) + ": " + tipo)
        categoria, famiglia = QUINDICI_CATEGORIE[tipo]
        # indirizzo, dettaglio e stato servono ai 15 minuti, che leggono questo stesso file
        extra = [s.get("i") or "", s.get("d") or "", "prevista" if s.get("s", "attiva") != "attiva" else ""]
        scheda = dettagli.get((s["t"], s["n"], s.get("i") or ""))
        if scheda:
            extra.append(scheda)  # indice 9 della riga: 6, 7 e 8 restano (anche vuoti)
        while extra and not extra[-1]:
            extra.pop()
        punti.append({"nome": s["n"], "categoria": categoria, "fam": famiglia, "extra": extra,
                      "lat": float(s["lat"]), "lon": float(s["lon"])})
    punti.sort(key=lambda r: (r["categoria"], r["nome"], r["lat"], r["lon"]))
    return punti


class Civici:
    """Numeri civici di Roma Capitale su una griglia di ~200 m, per il piu' vicino."""
    PASSO = 500.0  # celle da 1/500 di grado

    def __init__(self, files):
        self.celle = {}
        n = 0
        for f in files:
            with open(f, encoding="utf-8", errors="replace") as fh:
                for r in csv.DictReader(fh):
                    m = re.match(r"POINT \(([\d.]+) ([\d.]+)\)", r.get("GEOMETRIA", ""))
                    if not m or not r.get("NUMERO_CIVICO") or not r.get("TOPONIMO"):
                        continue
                    a, b = float(m.group(1)), float(m.group(2))
                    lat, lon = (a, b) if a > 40 else (b, a)  # WKT servito come "lat lon" o "lon lat"
                    civico = str(int(float(r["NUMERO_CIVICO"]))) + (r.get("LETTERA") or "").strip().upper()
                    self.celle.setdefault(self.cella(lat, lon), []).append((lat, lon, r["TOPONIMO"].strip(), civico))
                    n += 1
        if not n:
            raise SystemExit("Errore: nessun civico letto da " + ", ".join(files) + ".")
        print("civici di Roma Capitale: " + str(n))

    def cella(self, lat, lon):
        return (int(math.floor(lat * self.PASSO)), int(math.floor(lon * self.PASSO)))

    def vicino(self, lat, lon, soglia):
        ci, cj = self.cella(lat, lon)
        migliore, migliore_d = None, soglia
        for i in (ci - 1, ci, ci + 1):
            for j in (cj - 1, cj, cj + 1):
                for c in self.celle.get((i, j), ()):
                    d = distanza_metri(lat, lon, c[0], c[1])
                    # a parita' di distanza vince l'ordine alfabetico: output riproducibile
                    if d < migliore_d or (d == migliore_d and migliore and c[2:] < migliore[2:]):
                        migliore, migliore_d = c, d
        return migliore


def etichetta_farmacia(r, area, civici):
    """(nome, extra, sul_civico): il nome e' la sola categoria, l'indirizzo va nel
    campo indirizzo del punto; senza civico vicino niente indirizzo."""
    tipo = "Farmacia comunale" if FARMACIA_COMUNALE.search(r["nome"]) else "Farmacia"
    c = civici.vicino(r["lat"], r["lon"], SOGLIA_CIVICO_METRI)
    if c:
        return tipo, (titolo(c[2]) + " " + c[3],), True
    return tipo, (), False


def separa_farmacia(nome):
    """Dal vecchio formato "Farmacia · <via e civico>" a (nome, extra). Un indirizzo
    finisce con un numero civico; "Farmacia · <area>" (senza numero) perde l'area, che la
    scheda mostra gia'. Un nome gia' nel formato nuovo resta com'e'."""
    tipo, sep, resto = nome.partition(" · ")
    if not sep:
        return nome, ()
    if re.search(r"\d\w?$", resto):
        return tipo, (resto,)
    return tipo, ()


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    civici = Civici(sys.argv[1:])
    quindici = carica_quindici()
    presidi = [r for r in quindici if r["categoria"] in CATEGORIE_PRESIDIO]
    print("citta' dei 15 minuti: " + str(len(quindici)) + " punti, di cui "
          + str(len(presidi)) + " presidi sanitari")

    print("Scarico " + WFS_URL)
    grezzo = scarica_wfs(WFS_URL)
    totale = len(grezzo["features"])
    print("totale scaricato: " + str(totale))

    # Punti grezzi, ordinati in modo stabile: l'ordine di arrivo dal WFS non e'
    # garantito identico fra due richieste, l'ordinamento esplicito lo e'.
    # Il layer ha occasionali righe con lat/long corrotti (visto un caso: "long"
    # contiene il testo "Educazione" invece di una coordinata): tenute nei
    # conteggi per strato/famiglia ma, non essendo localizzabili, contate come
    # "fuori Roma" nella verifica (vedi README, decisione aperta).
    grezzi, coordinate_non_valide = [], []
    for f in grezzo["features"]:
        p = f["properties"]
        riga = {"nome": p["nome"], "strato": p["strato"], "fam": p["fam"]}
        try:
            riga["lat"], riga["lon"] = float(p["lat"]), float(p["long"])
        except (TypeError, ValueError):
            coordinate_non_valide.append(riga)
            continue
        grezzi.append(riga)
    grezzi.sort(key=lambda r: (r["strato"], r["nome"], r["lat"], r["lon"]))
    if coordinate_non_valide:
        print("coordinate non valide nella sorgente (contate come fuori Roma): "
              + str(len(coordinate_non_valide)))
        for r in coordinate_non_valide:
            print("  - " + r["nome"] + " (" + r["strato"] + ")")

    conteggio_strato = {}
    conteggio_fam = {}
    for r in grezzi + coordinate_non_valide:
        conteggio_strato[r["strato"]] = conteggio_strato.get(r["strato"], 0) + 1
        conteggio_fam[r["fam"]] = conteggio_fam.get(r["fam"], 0) + 1

    esclusi = [r for r in grezzi if r["strato"] in STRATI_ESCLUSI]
    esclusi += [r for r in coordinate_non_valide if r["strato"] in STRATI_ESCLUSI]
    non_esclusi = [r for r in grezzi if r["strato"] not in STRATI_ESCLUSI]
    non_localizzabili = [r for r in coordinate_non_valide if r["strato"] not in STRATI_ESCLUSI]
    print("esclusi (strati sensibili): " + str(len(esclusi)))

    # Scuole e ospedali: li porta la citta' dei 15 minuti (vedi STRATI_SOSTITUITI).
    sostituiti = [r for r in non_esclusi + non_localizzabili if r["strato"] in STRATI_SOSTITUITI]
    non_esclusi = [r for r in non_esclusi if r["strato"] not in STRATI_SOSTITUITI]
    non_localizzabili = [r for r in non_localizzabili if r["strato"] not in STRATI_SOSTITUITI]
    print("sostituiti dalla citta' dei 15 minuti (scuole, ospedali): " + str(len(sostituiti)))

    # Strati senza categoria (universita', parrocchie, CAF, Carabinieri, Polizia, sedi
    # Municipio, stazioni, aree cani): la mappa non li disegna e non li conta, quindi non
    # si servono nemmeno. Con loro escono i nomi di persona e le caserme "EX ...".
    fuori_categoria = [r for r in non_esclusi + non_localizzabili if r["strato"] not in CATEGORIE]
    non_esclusi = [r for r in non_esclusi if r["strato"] in CATEGORIE]
    non_localizzabili = [r for r in non_localizzabili if r["strato"] in CATEGORIE]
    print("fuori categoria, non serviti: " + str(len(fuori_categoria)) + " ("
          + ", ".join(sorted({r["strato"] for r in fuori_categoria})) + ")")

    municipi = carica_poligoni(MUNICIPI_PATH, ("municipio", "romano"))
    dentro_roma, fuori_roma = [], list(non_localizzabili)
    for r in non_esclusi:
        if trova_area(r["lon"], r["lat"], municipi) is not None:
            dentro_roma.append(r)
        else:
            fuori_roma.append(r)
    print("fuori dal confine di Roma (incluse le coordinate non valide): " + str(len(fuori_roma)))

    for r in dentro_roma:
        r["nome_normalizzato"] = normalizza_nome(r["nome"])

    gruppi = {}
    for r in dentro_roma:
        gruppi.setdefault(r["nome_normalizzato"].lower(), []).append(r)

    tenuti, doppioni = [], []
    for chiave in sorted(gruppi):
        candidati = sorted(gruppi[chiave], key=lambda r: (r["lat"], r["lon"]))
        rappresentanti = []
        for r in candidati:
            e_doppione = any(
                distanza_metri(r["lat"], r["lon"], t["lat"], t["lon"]) <= SOGLIA_DOPPIONE_METRI
                for t in rappresentanti
            )
            if e_doppione:
                doppioni.append(r)
            else:
                rappresentanti.append(r)
                tenuti.append(r)
    print("doppioni scartati: " + str(len(doppioni)))

    # Ambulatori e CUP nello stesso presidio di una casa della comunita' o di un
    # pronto soccorso (vedi SOGLIA_PRESIDIO_METRI).
    nei_presidi = [r for r in tenuti if CATEGORIE.get(r["strato"]) == "sanita" and any(
        distanza_metri(r["lat"], r["lon"], p["lat"], p["lon"]) <= SOGLIA_PRESIDIO_METRI for p in presidi)]
    tenuti = [r for r in tenuti if r not in nei_presidi]
    print("ambulatori e CUP gia' coperti da un presidio (entro " + str(SOGLIA_PRESIDIO_METRI)
          + " m): " + str(len(nei_presidi)))

    verifica = (len(tenuti) + len(esclusi) + len(sostituiti) + len(fuori_categoria) + len(fuori_roma)
                + len(doppioni) + len(nei_presidi))
    if verifica != totale:
        raise SystemExit(
            "Errore: tenuti(" + str(len(tenuti)) + ") + esclusi(" + str(len(esclusi))
            + ") + sostituiti(" + str(len(sostituiti)) + ") + fuori_categoria(" + str(len(fuori_categoria))
            + ") + fuori_roma(" + str(len(fuori_roma))
            + ") + doppioni(" + str(len(doppioni)) + ") + nei_presidi(" + str(len(nei_presidi))
            + ") = " + str(verifica) + " != totale scaricato " + str(totale)
        )

    aree = carica_poligoni(
        QUARTIERI_PATH, ("codice", "denominazione", "tipo", "municipio")
    )

    strati_senza_area = set()
    non_assegnabili = []
    punti_out = []
    farmacie_conte = {True: 0, False: 0, "doppie": 0}
    farmacie_viste = {}
    for r in tenuti:
        r["categoria"] = CATEGORIE[r["strato"]]
    # I punti della citta' dei 15 minuti sono a Roma per costruzione (scuole del
    # Comune e del Ministero sui civici di Roma, presidi di Roma): niente filtro sul
    # confine dei municipi, che su sei scuole ai bordi di un'area sbaglia di 7-18 m.
    # Passano dall'assegnazione dell'area qui sotto, fallback compreso: un punto
    # davvero fuori resta senza area e viene stampato fra i non assegnabili.
    for r in quindici:
        r["strato"] = "citta' dei 15 minuti: " + r["categoria"]
        r["nome_normalizzato"] = r["nome"]
    da_assegnare = tenuti + quindici

    for r in da_assegnare:
        area = trova_area(r["lon"], r["lat"], aree)
        if area is None:
            # Micro-gap della semplificazione dei poligoni: il punto e' dentro Roma
            # ma cade fra due aree confinanti. Fallback sull'area piu' vicina entro
            # SOGLIA_AREA_VICINA_METRI (vedi commento sopra la funzione).
            area = trova_area_vicina(r["lon"], r["lat"], aree)
            if area is None:
                non_assegnabili.append(r)
                continue
            strati_senza_area.add(r["strato"])
        nome = r["nome_normalizzato"]
        # Farmacie: mai il nome del titolare, vedi etichetta_farmacia().
        if r["categoria"] == "farmacie":
            nome, extra, sul_civico = etichetta_farmacia(r, area, civici)
            r["extra"] = extra
            # Stessa farmacia registrata piu' volte (nomi di titolari diversi, stesso
            # punto: "Borgo S. Spirito 73" undici volte): con l'etichetta sul civico
            # i doppioni si vedono, ne resta una.
            chiave_f = (nome, extra)
            if sul_civico and any(distanza_metri(r["lat"], r["lon"], a, b) <= SOGLIA_DOPPIONE_METRI
                                  for a, b in farmacie_viste.get(chiave_f, ())):
                farmacie_conte["doppie"] += 1
                continue
            farmacie_viste.setdefault(chiave_f, []).append((r["lat"], r["lon"]))
            farmacie_conte[sul_civico] += 1
        punti_out.append((r["categoria"], nome, area["codice"], area["municipio"],
                          round(r["lat"], 5), round(r["lon"], 5), tuple(r.get("extra", ()))))
    print("farmacie: " + str(farmacie_conte[True]) + " sul civico piu' vicino (entro "
          + str(SOGLIA_CIVICO_METRI) + " m), " + str(farmacie_conte[False]) + " col nome dell'area, "
          + str(farmacie_conte["doppie"]) + " doppie sullo stesso civico tolte")
    if strati_senza_area:
        print("punti nel micro-gap della semplificazione, assegnati con il fallback "
              "dell'area piu' vicina (entro " + str(SOGLIA_AREA_VICINA_METRI) + " m), per strato: "
              + ", ".join(sorted(strati_senza_area)))
    if non_assegnabili:
        print("ATTENZIONE: punti dentro Roma ma senza area assegnabile (oltre "
              + str(SOGLIA_AREA_VICINA_METRI) + " m da qualunque area), scartati dall'output: "
              + str(len(non_assegnabili)))
        for r in non_assegnabili:
            print("  - " + r["nome"] + " (" + r["strato"] + ") " + str(r["lat"]) + "," + str(r["lon"]))

    print("tenuti dal Piano dei Servizi: " + str(len(tenuti)) + " | dalla citta' dei 15 minuti: "
          + str(len(da_assegnare) - len(tenuti)))
    print("--- conteggi per strato ---")
    for strato, n in sorted(conteggio_strato.items(), key=lambda kv: (-kv[1], kv[0])):
        print(str(n) + " " + strato)
    print("--- conteggi per famiglia ---")
    for fam, n in sorted(conteggio_fam.items(), key=lambda kv: (-kv[1], kv[0])):
        print(str(n) + " " + fam)

    prima = len(punti_out)
    punti_out = accorpa_doppioni(punti_out)
    print("stesso posto accorpato (stesso nome entro " + str(SOGLIA_STESSO_NOME_METRI)
          + " m, scuole allo stesso indirizzo): " + str(prima - len(punti_out)) + " punti in meno")
    scrivi(punti_out)


def scrivi(punti_out):
    # Ordine finale esplicito: riproducibilita' indipendente dall'ordine del WFS.
    punti_out.sort(key=lambda p: (p[2], p[0], p[1], p[4], p[5]))

    # Formato a righe, un solo file per il focus e per i 15 minuti: categorie una volta
    # sola, poi un punto per riga [indice categoria, nome, codice area, municipio, lat,
    # lon, (indirizzo, dettaglio, "prevista", {dettagli scuola})], gli ultimi quattro
    # facoltativi (solo scuole e presidi, e solo se pieni; l'oggetto solo scuole, e se
    # c'e' i tre prima ci sono sempre). Il municipio resta esplicito: per rioni e zone
    # funzionali non si ricava dal codice dell'area. I conteggi per area li fa la mappa.
    categorie = sorted({p[0] for p in punti_out})
    indice = {c: i for i, c in enumerate(categorie)}
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json_compatto({
        "c": categorie,
        "p": [[indice[p[0]], p[1], p[2], p[3], p[4], p[5]] + list(p[6]) for p in punti_out],
    }), encoding="utf-8")
    conte = {}
    for p in punti_out:
        conte[p[0]] = conte.get(p[0], 0) + 1

    print("scritti in output: " + str(len(punti_out)))
    print("--- punti per categoria ---")
    for c in categorie:
        print(str(conte[c]) + " " + c)


def solo_accorpa():
    """Riapplica l'accorpamento al servizi.json gia' scritto, senza riscaricare nulla."""
    d = json.loads(OUT_PATH.read_text(encoding="utf-8"))
    punti = [(d["c"][r[0]], r[1], r[2], r[3], r[4], r[5], tuple(r[6:])) for r in d["p"]]
    accorpati = accorpa_doppioni(punti)
    print("stesso posto accorpato: " + str(len(punti) - len(accorpati)) + " punti in meno")
    scrivi(accorpati)


def solo_farmacie():
    """Senza rete: porta le farmacie del servizi.json gia' scritto dal formato
    "Farmacia · <via e civico>" a nome "Farmacia" + indirizzo (separa_farmacia), poi
    riaccorpa. Ripetibile: sul formato nuovo non cambia nulla."""
    d = json.loads(OUT_PATH.read_text(encoding="utf-8"))
    punti, cambiate = [], 0
    for r in d["p"]:
        cat, nome, extra = d["c"][r[0]], r[1], tuple(r[6:])
        if cat == "farmacie" and not extra:
            nuovo, extra_nuovo = separa_farmacia(nome)
            if (nuovo, extra_nuovo) != (nome, extra):
                cambiate += 1
            nome, extra = nuovo, extra_nuovo
        punti.append((cat, nome, r[2], r[3], r[4], r[5], extra))
    print("farmacie convertite: " + str(cambiate))
    accorpati = accorpa_doppioni(punti)
    print("stesso posto accorpato: " + str(len(punti) - len(accorpati)) + " punti in meno")
    scrivi(accorpati)


def solo_scuole():
    """Senza rete: rifa' le scuole (nido, infanzia, primaria, media, superiore) da
    data/servizi-15-minuti.json e data/scuole-dettagli.json sul servizi.json gia' scritto.
    Stessi passi di main() per le scuole (area col point-in-polygon e fallback sull'area
    piu' vicina, accorpamento); le altre categorie restano come sono."""
    d = json.loads(OUT_PATH.read_text(encoding="utf-8"))
    punti = [(d["c"][r[0]], r[1], r[2], r[3], r[4], r[5], tuple(r[6:])) for r in d["p"]
             if d["c"][r[0]] not in CATEGORIE_SCUOLA]
    aree = carica_poligoni(QUARTIERI_PATH, ("codice", "denominazione", "tipo", "municipio"))
    scuole, non_assegnabili = [], []
    for r in carica_quindici():
        if r["categoria"] not in CATEGORIE_SCUOLA:
            continue
        area = trova_area(r["lon"], r["lat"], aree) or trova_area_vicina(r["lon"], r["lat"], aree)
        if area is None:
            non_assegnabili.append(r)
            continue
        scuole.append((r["categoria"], r["nome"], area["codice"], area["municipio"],
                       round(r["lat"], 5), round(r["lon"], 5), tuple(r.get("extra", ()))))
    if non_assegnabili:
        print("ATTENZIONE: scuole senza area assegnabile, scartate: " + str(len(non_assegnabili)))
    prima = len(scuole)
    scuole = accorpa_doppioni(scuole)
    print("scuole: " + str(prima) + " punti, accorpati in " + str(len(scuole)))
    scrivi(punti + scuole)


if __name__ == "__main__":
    if sys.argv[1:] == ["--solo-scuole"]:
        solo_scuole()
    elif sys.argv[1:] == ["--solo-accorpa"]:
        solo_accorpa()
    elif sys.argv[1:] == ["--solo-farmacie"]:
        solo_farmacie()
    else:
        main()
