#!/usr/bin/env python3
"""
Rete per la bici di Roma ("15 minuti in bici") e piste ciclabili da mostrare sulla mappa,
dall'estratto OpenStreetMap (Geofabrik, centro Italia).

Serve pyosmium (pip install osmium), come per prepara_rete_pedonale.py: non e' una
dipendenza del build.

Uso:
    python3 prepara_rete_bici.py <centro-latest.osm.pbf>

Scrive:
- data/rete-bici/r<riga>_<colonna>.json e data/rete-bici/indice.json: il grafo delle strade
  percorribili in bici, negli stessi riquadri della rete pedonale. Formato di un riquadro:
  {"e": [[a, b, metri, [lat0, lon0, dlat1, dlon1, ...], metri_ritorno?], ...]}
  dove "metri" non sono la lunghezza vera ma i metri equivalenti alla velocita' di
  riferimento (VELOCITA_RIFERIMENTO, 15 km/h): 100 m di sampietrini su una via residenziale
  (14 km/h, 10,5 sui sampietrini) "costano" come 143 m. Il quinto valore c'e' solo quando
  il ritorno (da b ad a) costa diverso dall'andata: sul senso unico si torna indietro a
  piedi, bici a mano.
- data/ciclabili/ciclabili.json: le piste e le corsie ciclabili nel Comune di Roma (i tratti
  che toccano un'area della deliberazione 150/2026), solo geometria.
  {"l": [[tipo, [lat0, lon0, dlat1, dlon1, ...]], ...]} con tipo 0 = pista separata
  (highway=cycleway, percorso con bicycle=designated o pista separata disegnata con la
  strada, cycleway=track), 1 = corsia sulla strada (cycleway=lane).

Le regole: nelle aree pedonali (highway=pedestrian) la bici e' ammessa (Codice della
Strada, art. 3) e si va piano, 10 km/h; sui marciapiedi e dove c'e' bicycle=dismount si
va a mano, 5 km/h; i sampietrini tolgono un quarto della velocita', mai sotto quella a mano.

Limiti: non conosce le salite (OpenStreetMap non ha le quote) e prende i limiti di
velocita' dal tipo di strada, non dal traffico vero.
"""

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import osmium

sys.path.insert(0, str(Path(__file__).resolve().parent))  # anche con python3 -I

from importa_servizi import QUARTIERI_PATH, carica_poligoni, trova_area
from prepara_rete_pedonale import (BBOX, PASSO_LAT, PASSO_LON, componente_maggiore,
                                   dentro, metri, semplifica)

SCRIPT_DIR = Path(__file__).resolve().parent
OUT_DIR = SCRIPT_DIR / "data" / "rete-bici"
CICLABILI_PATH = SCRIPT_DIR / "data" / "ciclabili" / "ciclabili.json"

# La mappa usa la stessa velocita' per trasformare i metri equivalenti in minuti.
VELOCITA_RIFERIMENTO = 15.0  # km/h
A_MANO = 5.0                 # km/h: bici a mano sul marciapiede o contromano
AREA_PEDONALE = 10.0         # km/h: in sella, piano, fra i pedoni

NO_ACCESSO = {"no", "private", "dismount"}
SI_BICI = {"yes", "designated", "permissive"}
STRADE = {
    "residential": 14.0, "living_street": 10.0, "unclassified": 14.0, "service": 12.0,
    "road": 13.0, "tertiary": 14.0, "tertiary_link": 14.0, "secondary": 13.0,
    "secondary_link": 13.0, "primary": 12.0, "primary_link": 12.0,
}
PEDONALI = {"pedestrian", "footway", "corridor"}
STERRATE = {"track", "path", "bridleway"}
FONDO_LENTO = {"sett", "cobblestone", "unhewn_cobblestone", "cobblestone:flattened"}
FONDO_STERRATO = {"unpaved", "gravel", "dirt", "ground", "grass", "sand", "mud",
                  "fine_gravel", "compacted", "pebblestone", "earth", "woodchips"}
LATI_CICLABILE = ("cycleway", "cycleway:both", "cycleway:left", "cycleway:right")


def corsia_ciclabile(tags):
    """'track', 'lane' o None per una strada con la ciclabile disegnata sulla strada stessa."""
    valori = {tags.get(k) for k in LATI_CICLABILE}
    if "track" in valori or "opposite_track" in valori:
        return "track"
    if valori & {"lane", "opposite_lane", "shared_busway"}:
        return "lane"
    return None


def velocita(tags):
    """Velocita' in bici (km/h) su una via, o None se in bici non si passa (neanche a mano)."""
    hw = tags.get("highway")
    bici = tags.get("bicycle")
    if hw == "steps" or bici == "no":
        return None
    if tags.get("access") in NO_ACCESSO and bici not in SI_BICI:
        return None
    if hw in ("motorway", "motorway_link") or (hw in ("trunk", "trunk_link") and bici not in SI_BICI):
        return None
    if hw == "cycleway" or (hw in STERRATE | PEDONALI and bici == "designated"):
        v = 16.0
    elif hw in STRADE:
        v = STRADE[hw]
        if corsia_ciclabile(tags):
            v = max(v, 15.0)
    elif hw in ("trunk", "trunk_link"):
        v = 13.0
    elif hw in STERRATE:
        v = 11.0
    elif hw in PEDONALI:
        if bici in SI_BICI:
            v = 11.0
        elif hw == "pedestrian":
            v = AREA_PEDONALE
        else:
            v = A_MANO
    else:
        return None
    if bici == "dismount":
        v = A_MANO
    fondo = tags.get("surface")
    if fondo in FONDO_LENTO and v > A_MANO:
        v = max(v * 0.75, A_MANO)
    elif fondo in FONDO_STERRATO and v > A_MANO:
        v = min(v, 10.0)
    return v


def senso(tags):
    """+1 senso unico da primo a ultimo nodo, -1 al contrario, 0 doppio senso (per la bici)."""
    hw = tags.get("highway")
    o = tags.get("oneway:bicycle") or tags.get("oneway")
    if tags.get("oneway:bicycle") == "no":
        return 0
    if {tags.get(k) for k in LATI_CICLABILE} & {"opposite", "opposite_lane", "opposite_track"}:
        return 0
    if o in ("yes", "1", "true"):
        return 1
    if o == "-1":
        return -1
    if o is None and (hw in ("motorway", "motorway_link") or tags.get("junction") == "roundabout"):
        return 1
    return 0


def tipo_ciclabile(tags):
    """0 pista separata (anche quella disegnata con la strada), 1 corsia sulla strada,
    None se non e' ciclabile."""
    hw = tags.get("highway")
    if tags.get("bicycle") == "no" or tags.get("access") in ("no", "private"):
        return None
    if hw == "cycleway":
        return 0
    if hw in STERRATE | PEDONALI and tags.get("bicycle") == "designated":
        return 0
    if hw in STRADE or hw in ("trunk", "trunk_link"):
        c = corsia_ciclabile(tags)
        if c:
            return 0 if c == "track" else 1
    return None


class Vie(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.vie = []          # (nodi, km/h, senso)
        self.ciclabili = []    # (tipo, punti)

    def way(self, w):
        if "highway" not in w.tags:
            return
        tags = {t.k: t.v for t in w.tags}
        v = velocita(tags)
        tc = tipo_ciclabile(tags)
        if v is None and tc is None:
            return
        nodi = []
        for n in w.nodes:
            if n.location.valid():
                nodi.append((n.ref, n.location.lat, n.location.lon))
        if len(nodi) < 2 or not any(dentro(lat, lon) for _, lat, lon in nodi):
            return
        if v is not None:
            self.vie.append((nodi, v, senso(tags)))
        if tc is not None:
            self.ciclabili.append((tc, [(lat, lon) for _, lat, lon in nodi]))


def comprimi(punti):
    q = [(round(lat * 1e5), round(lon * 1e5)) for lat, lon in punti]
    flat = [q[0][0], q[0][1]]
    for i in range(1, len(q)):
        flat += [q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]]
    return flat


def costo(lunghezza, kmh):
    return lunghezza * VELOCITA_RIFERIMENTO / kmh


def costruisci_rete(vie):
    uso = defaultdict(int)
    for nodi, _, _ in vie:
        for i, (nid, _, _) in enumerate(nodi):
            uso[nid] += 2 if i in (0, len(nodi) - 1) else 1
    incroci = {nid for nid, u in uso.items() if u >= 2}

    ids = {}

    def id_di(nid):
        if nid not in ids:
            ids[nid] = len(ids)
        return ids[nid]

    archi = []
    for nodi, kmh, verso in vie:
        tratto = [nodi[0]]
        for nodo in nodi[1:]:
            tratto.append(nodo)
            if nodo[0] in incroci:
                punti = [(lat, lon) for _, lat, lon in tratto]
                lun = sum(metri(punti[i], punti[i + 1]) for i in range(len(punti) - 1))
                if tratto[0][0] != nodo[0] and lun > 0:
                    andata = costo(lun, kmh)
                    # Contromano si torna a piedi, bici a mano sul marciapiede.
                    ritorno = costo(lun, min(kmh, A_MANO)) if verso else andata
                    if verso == -1:
                        andata, ritorno = ritorno, andata
                    archi.append((id_di(tratto[0][0]), id_di(nodo[0]), andata,
                                  semplifica(punti), ritorno))
                tratto = [nodo]
    print("Archi fra incroci:", len(archi))
    # Stessa componente connessa della rete pedonale; l'indice dell'arco viaggia al posto
    # del tracciato, cosi' si ritrovano gli archi completi (con il costo del ritorno).
    tenuti = componente_maggiore([(a, b, c, i) for i, (a, b, c, _, _) in enumerate(archi)], len(ids))
    archi = [archi[t[3]] for t in tenuti]
    print("Archi nella rete connessa principale:", len(archi))
    return archi


def scrivi_rete(archi):
    riquadri = defaultdict(list)
    for a, b, andata, punti, ritorno in archi:
        m = punti[len(punti) // 2]
        chiave = (int(math.floor(m[0] / PASSO_LAT)), int(math.floor(m[1] / PASSO_LON)))
        riga = [a, b, round(andata, 1), comprimi(punti)]
        if abs(ritorno - andata) > 0.05:
            riga.append(round(ritorno, 1))
        riquadri[chiave].append(riga)

    if OUT_DIR.exists():
        for f in OUT_DIR.glob("*.json"):
            f.unlink()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    totale = 0
    for (r, c), e in riquadri.items():
        testo = json.dumps({"e": e}, separators=(",", ":"))
        (OUT_DIR / ("r%d_%d.json" % (r, c))).write_text(testo)
        totale += len(testo)
    (OUT_DIR / "indice.json").write_text(json.dumps({
        "passo_lat": PASSO_LAT, "passo_lon": PASSO_LON,
        "velocita_kmh": VELOCITA_RIFERIMENTO,
        "riquadri": sorted("%d_%d" % k for k in riquadri),
        "fonte": "OpenStreetMap (ODbL), estratto Geofabrik centro Italia",
    }, separators=(",", ":")))
    print("Rete bici: %d riquadri, %.1f MB" % (len(riquadri), totale / 1e6))


def scrivi_ciclabili(ciclabili):
    """Solo i tratti che toccano Roma: il riquadro della rete comprende anche Fiumicino,
    Ciampino e altri comuni, che non vanno contati come piste di Roma."""
    aree = carica_poligoni(QUARTIERI_PATH, ("codice",))
    linee = []
    km = [0.0, 0.0]
    km_dentro = [0.0, 0.0]
    for tipo, punti in ciclabili:
        if not all(dentro(lat, lon) for lat, lon in (punti[0], punti[-1])):
            continue
        if not any(trova_area(lon, lat, aree) for lat, lon in punti):
            continue
        for i in range(len(punti) - 1):
            m = metri(punti[i], punti[i + 1]) / 1000
            km[tipo] += m
            meta = ((punti[i][0] + punti[i + 1][0]) / 2, (punti[i][1] + punti[i + 1][1]) / 2)
            if trova_area(meta[1], meta[0], aree):
                km_dentro[tipo] += m
        linee.append([tipo, comprimi(semplifica(punti, 3.0))])
    linee.sort(key=lambda l: (l[0], l[1][0], l[1][1]))
    CICLABILI_PATH.parent.mkdir(parents=True, exist_ok=True)
    testo = json.dumps({
        "fonte": "OpenStreetMap (ODbL), estratto Geofabrik centro Italia",
        "l": linee,
    }, separators=(",", ":"))
    CICLABILI_PATH.write_text(testo)
    print("Ciclabili: %d tratti, piste %.0f km, corsie %.0f km (dentro i confini di Roma: "
          "piste %.0f km, corsie %.0f km), %.0f KB"
          % (len(linee), km[0], km[1], km_dentro[0], km_dentro[1], len(testo) / 1e3))


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Uso: python3 prepara_rete_bici.py <file.osm.pbf>")
    h = Vie()
    h.apply_file(sys.argv[1], locations=True, idx="flex_mem")
    print("Vie percorribili in bici nel riquadro di Roma:", len(h.vie))
    scrivi_rete(costruisci_rete(h.vie))
    scrivi_ciclabili(h.ciclabili)


if __name__ == "__main__":
    main()
