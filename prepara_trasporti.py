#!/usr/bin/env python3
"""
Stazioni della metropolitana, fermate del tram e stazioni ferroviarie di Roma, con le
linee che ci passano, dall'estratto OpenStreetMap (Geofabrik, centro Italia).

Serve pyosmium (pip install osmium), come per prepara_rete_pedonale.py.

Uso:
    python3 prepara_trasporti.py <centro-latest.osm.pbf>

Riscrive solo le categorie "metro", "tram" e "treno" di data/servizi/servizi.json; le altre
restano. Va lanciato dopo importa_servizi.py (che riscrive il file da zero) e dopo
prepara_farmacie.py, come quello.

Come si decide cosa entra:
- le linee vengono dalle relazioni route di OpenStreetMap: metro A, B, B1 e C; tram ATAC;
  ferrovie regionali FL1-FL8, Leonardo Express, Metromare (Roma-Lido) e Roma-Viterbo.
  Le linee in progetto (per esempio la metro D) non hanno una relazione con le fermate e
  restano fuori; i treni a lunga percorrenza non aggiungono linee.
- una stazione o fermata entra solo se almeno una di quelle linee ci ferma, ed e' dentro
  un'area di Roma (quartieri, rioni e zone funzionali della deliberazione 150/2026).
- le fermate del tram hanno un punto per direzione in OpenStreetMap: quelle con lo stesso
  nome a meno di 250 m diventano una fermata sola.
- la diramazione B1 in OpenStreetMap ha ref=B: le fermate che sono solo nella relazione
  per Jonio (e non in quella per Rebibbia) diventano "B1", e la stazione dove i due rami
  si separano (Bologna) ha "B e B1".
- una stazione ferroviaria senza nessuna linea (per esempio quando i punti di fermata sono
  stati aggiunti in OpenStreetMap ma non ancora nella relazione della linea) prende le linee
  del binario su cui stanno i suoi punti di fermata; se neanche il binario e' in una
  relazione, la linea viene da LINEE_MANCANTI_IN_OSM (Val d'Ala, Vigna Clara).
- le stazioni chiuse per lavori (CHIUSE) restano sulla mappa come "chiuse per lavori",
  con la nota, e non contano fra i servizi attivi dei 15 minuti.
Il punto mostra il nome della stazione e, come dettaglio, le linee ("Linee A e B").
"""

import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import json

import osmium

sys.path.insert(0, str(Path(__file__).resolve().parent))  # anche con python3 -I

from importa_servizi import (OUT_PATH, QUARTIERI_PATH, accorpa_doppioni, carica_poligoni,
                             trova_area, trova_area_vicina, scrivi)
from prepara_rete_pedonale import dentro, metri

CATEGORIE = ("metro", "tram", "treno")
METRO = {"A", "B", "B1", "C"}
FERROVIE = re.compile(r"^(FL[1-8]|LEX|Metromare|Roma[ -]Viterbo.*)$")
STESSA_FERMATA_METRI = 250.0
STAZIONE_VICINA_METRI = 250.0

# Stazioni chiuse per lavori: (categoria, nome) -> nota. Da ricontrollare a ogni
# rigenerazione (verificato il 4 novembre 2026).
CHIUSE = {
    ("treno", "Sacrofano"): "chiusa per i lavori di raddoppio, bus sostitutivi Cotral",
}
# Stazioni attive i cui binari in OpenStreetMap non sono in nessuna relazione della linea:
# nome -> linea. Si usano solo se l'estratto non da' gia' una linea (verificato il 4/11/2026).
LINEE_MANCANTI_IN_OSM = {
    "Val d'Ala": "FL2",   # sui binari della FL1, ma ci fermano solo i treni FL2 per Tivoli
    "Vigna Clara": "FL3",
}


def linea(tags):
    """(categoria, nome della linea) per una relazione route, o None."""
    route, ref = tags.get("route"), (tags.get("ref") or "").strip()
    if route == "subway" and ref in METRO:
        return ("metro", ref)
    if route == "tram" and ref.isdigit() and "ATAC" in (tags.get("network", "") + tags.get("operator", "")):
        return ("tram", ref)
    if route in ("train", "light_rail", "subway") and FERROVIE.match(ref):
        if ref == "LEX":
            return ("treno", "Leonardo Express")
        if ref.startswith("Roma"):
            return ("treno", "Roma-Viterbo")
        return ("treno", ref)
    return None


class Relazioni(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.linee_nodo = defaultdict(set)    # id nodo -> {(categoria, linea)}
        self.linee_via = defaultdict(set)     # id via (banchina) -> {(categoria, linea)}
        self.aree_fermata = []                # [(nodi, vie)] delle relazioni stop_area
        self.linee_binario = defaultdict(set) # id via (binario) -> {(categoria, linea)} dei treni
        self.rami_b = []                      # [(nodi in ordine, vie banchina)] delle relazioni B

    def relation(self, r):
        tags = {t.k: t.v for t in r.tags}
        if tags.get("type") == "route":
            l = linea(tags)
            if not l:
                return
            for m in r.members:
                if m.type == "n":
                    self.linee_nodo[m.ref].add(l)
                elif m.type == "w":
                    if "platform" in m.role:
                        self.linee_via[m.ref].add(l)
                    elif l[0] == "treno" and not m.role:
                        self.linee_binario[m.ref].add(l)
            if l == ("metro", "B"):
                self.rami_b.append(([m.ref for m in r.members if m.type == "n"],
                                    {m.ref for m in r.members if m.type == "w" and "platform" in m.role}))
        elif tags.get("public_transport") == "stop_area":
            nodi = [m.ref for m in r.members if m.type == "n"]
            vie = [m.ref for m in r.members if m.type == "w"]
            self.aree_fermata.append((nodi, vie))


def tipo_stazione(tags):
    """'stazione' (metro o treno), 'tram' o None."""
    rw = tags.get("railway")
    if rw == "tram_stop":
        return "tram"
    # Alcune stazioni (Marconi, Roma Ostiense) hanno solo public_transport=station.
    ferro = rw in ("station", "halt") or (
        tags.get("public_transport") == "station" and rw is None
        and any(tags.get(k) == "yes" for k in ("train", "subway", "light_rail")))
    if ferro and tags.get("station") not in ("funicular", "monorail", "miniature"):
        if tags.get("usage") == "tourism" or "disused" in tags or "abandoned" in tags:
            return None
        return "stazione"
    return None


class Punti(osmium.SimpleHandler):
    def __init__(self, rel):
        super().__init__()
        self.rel = rel
        self.posizioni = {}         # id nodo membro di una linea -> (lat, lon)
        self.nomi = {}              # id nodo membro di una linea -> nome della fermata
        self.vie = {}               # id via banchina -> (lat, lon) del centro
        self.stazioni = []          # dict
        self.vie_stazione = {}      # id via stazione (disegnata come area) -> indice in stazioni
        self.fermate_treno = {}     # id punto di fermata del treno -> (nome, lat, lon)
        self.linee_fermata = defaultdict(set)  # id punto di fermata -> linee del suo binario

    def node(self, n):
        if not n.location.valid():
            return
        lat, lon = n.location.lat, n.location.lon
        if n.id in self.rel.linee_nodo:
            self.posizioni[n.id] = (lat, lon)
            nome = n.tags.get("name")
            if nome:
                self.nomi[n.id] = nome
        if n.tags.get("railway") == "stop" and n.tags.get("train") == "yes" and n.tags.get("name"):
            self.fermate_treno[n.id] = (n.tags.get("name"), lat, lon)
        if n.tags.get("railway") not in ("station", "halt", "tram_stop") \
                and n.tags.get("public_transport") != "station":
            return
        tags = {t.k: t.v for t in n.tags}
        tipo = tipo_stazione(tags)
        if tipo and dentro(lat, lon):
            self.stazioni.append({"tipo": tipo, "nome": tags.get("name"), "lat": lat, "lon": lon,
                                  "nodo": n.id, "via": None, "tags": tags})

    def way(self, w):
        # I nodi arrivano prima delle vie: i punti di fermata sono gia' noti.
        if w.id in self.rel.linee_binario:
            for n in w.nodes:
                if n.ref in self.fermate_treno:
                    self.linee_fermata[n.ref] |= self.rel.linee_binario[w.id]
        if w.id not in self.rel.linee_via and w.tags.get("railway") not in ("station", "halt") \
                and w.tags.get("public_transport") != "station":
            return
        tags = {t.k: t.v for t in w.tags}
        tipo = tipo_stazione(tags)
        punti = [(n.location.lat, n.location.lon) for n in w.nodes if n.location.valid()]
        if not punti:
            return
        c = (sum(p[0] for p in punti) / len(punti), sum(p[1] for p in punti) / len(punti))
        if w.id in self.rel.linee_via:
            self.vie[w.id] = c
        if tipo and dentro(*c):
            self.stazioni.append({"tipo": tipo, "nome": tags.get("name"), "lat": c[0], "lon": c[1],
                                  "nodo": None, "via": w.id, "tags": tags})


def metro_in_osm(stazione):
    t = stazione["tags"]
    return t.get("station") == "subway" or (t.get("subway") == "yes" and t.get("station") != "train")


def compatibile(stazione, l):
    """Una linea va solo su una fermata del suo tipo. La Metromare in OpenStreetMap ha
    stazioni da metropolitana: per lei va bene ogni stazione."""
    categoria, nome = l
    if stazione["tipo"] == "tram":
        return categoria == "tram"
    if categoria == "metro":
        return metro_in_osm(stazione)
    if categoria == "treno":
        return nome == "Metromare" or not metro_in_osm(stazione)
    return False


def assegna_linee(rel, pt):
    """Linee di ogni stazione: le sue, quelle della sua stop_area, poi quelle delle fermate
    vicine (un punto d'arresto o una banchina entro 250 m) del tipo giusto."""
    for s in pt.stazioni:
        s["linee"] = {l for l in rel.linee_nodo.get(s["nodo"], set()) | rel.linee_via.get(s["via"], set())
                      if compatibile(s, l)}
    per_nodo = {s["nodo"]: s for s in pt.stazioni if s["nodo"]}
    per_via = {s["via"]: s for s in pt.stazioni if s["via"]}
    for nodi, vie in rel.aree_fermata:
        dentro_area = [per_nodo[n] for n in nodi if n in per_nodo] + [per_via[v] for v in vie if v in per_via]
        if not dentro_area:
            continue
        linee = set()
        for n in nodi:
            linee |= rel.linee_nodo.get(n, set())
        for v in vie:
            linee |= rel.linee_via.get(v, set())
        for s in dentro_area:
            s["linee"] |= {l for l in linee if compatibile(s, l)}

    # Linee non ancora su nessuna stazione vicina: la stazione compatibile piu' vicina entro 250 m.
    griglia = defaultdict(list)
    for s in pt.stazioni:
        griglia[(round(s["lat"] * 200), round(s["lon"] * 200))].append(s)
    fermate = [(pos, rel.linee_nodo[k]) for k, pos in pt.posizioni.items()]
    fermate += [(pos, rel.linee_via[v]) for v, pos in pt.vie.items()]
    for (lat, lon), linee in fermate:
        gx, gy = round(lat * 200), round(lon * 200)
        vicine = [s for dx in (-1, 0, 1) for dy in (-1, 0, 1) for s in griglia[(gx + dx, gy + dy)]]
        for l in linee:
            cand = sorted((metri((lat, lon), (s["lat"], s["lon"])), i) for i, s in enumerate(vicine)
                          if compatibile(s, l))
            if cand and cand[0][0] <= STAZIONE_VICINA_METRI:
                vicine[cand[0][1]]["linee"].add(l)


def stazioni_dai_punti_di_fermata(rel, pt):
    """Ripiego: in OpenStreetMap qualche stazione (Marconi, Roma Ostiense) esiste solo come
    punti di fermata sui binari, senza l'oggetto stazione. Se una linea ferma in un punto con
    un nome e nessuna stazione entro 400 m ha quella linea, la stazione si fa da quei punti."""
    servite = defaultdict(list)
    for s in pt.stazioni:
        for l in s["linee"]:
            servite[l].append((s["lat"], s["lon"]))
    nuove = []
    for k, nome in sorted(pt.nomi.items()):
        lat, lon = pt.posizioni[k]
        for l in sorted(rel.linee_nodo[k]):
            if l[0] == "tram" or not dentro(lat, lon):
                continue
            if any(metri((lat, lon), q) <= 400 for q in servite[l]):
                continue
            # Stazioni grandi (Termini): i punti di fermata in fondo ai binari sono lontani
            # dal punto della stazione, che ha lo stesso nome.
            omonima = [x for x in pt.stazioni if x["nome"] == nome and compatibile(x, l)
                       and metri((lat, lon), (x["lat"], x["lon"])) <= 1000]
            if omonima:
                omonima[0]["linee"].add(l)
                continue
            for s in nuove:
                if s["nome"] == nome and metri((lat, lon), (s["lat"], s["lon"])) <= STESSA_FERMATA_METRI:
                    s["linee"].add(l)
                    break
            else:
                nuove.append({"tipo": "stazione", "nome": nome, "lat": lat, "lon": lon, "nodo": None,
                              "via": None, "tags": {}, "linee": {l}})
    return nuove


def ramo_b1(rel, pt):
    """In OpenStreetMap la B1 ha ref=B. Le fermate delle relazioni che arrivano a Jonio e
    non sono in nessuna relazione che arriva a Rebibbia diventano B1; la fermata accanto
    al primo tratto B1 (il bivio, Bologna) ha tutte e due. Ritorna i nomi dei due gruppi."""
    def nomi(nodi):
        return {pt.nomi.get(n) for n in nodi}
    jonio = [r for r in rel.rami_b if "Jonio" in nomi(r[0])]
    rebibbia = [r for r in rel.rami_b if "Rebibbia" in nomi(r[0])]
    if not jonio or not rebibbia:
        return set(), set()
    # Per nome e non per nodo: le due direzioni, e al bivio banchine diverse per ramo.
    nomi_trono = {n for r in rebibbia for n in nomi(r[0])} - {None}
    vie_trono = {v for r in rebibbia for v in r[1]}
    vie_b1 = {v for r in jonio for v in r[1] if v not in vie_trono}
    nomi_b1, nomi_bivio = set(), set()
    for nodi, _ in jonio:
        seq = [pt.nomi[n] for n in nodi if n in pt.nomi]
        nomi_b1 |= set(seq) - nomi_trono
        for a, b in zip(seq, seq[1:]):
            if (a in nomi_trono) != (b in nomi_trono):
                nomi_bivio.add(a if a in nomi_trono else b)
    B, B1 = ("metro", "B"), ("metro", "B1")
    for n, nome in pt.nomi.items():
        if B in rel.linee_nodo.get(n, ()):
            if nome in nomi_b1:
                rel.linee_nodo[n] = (rel.linee_nodo[n] - {B}) | {B1}
            elif nome in nomi_bivio:
                rel.linee_nodo[n].add(B1)
    for v in vie_b1:
        if B in rel.linee_via.get(v, ()):
            rel.linee_via[v] = (rel.linee_via[v] - {B}) | {B1}
    return nomi_b1, nomi_bivio


def stazioni_dal_binario(pt):
    """Stazioni ferroviarie senza nessuna linea: prendono le linee del binario dei loro punti
    di fermata. Solo dove nessuna stazione entro 400 m ha gia' una linea del treno, cosi'
    una linea che passa senza fermarsi non si aggiunge a una stazione servita."""
    con_treno = [(s["lat"], s["lon"]) for s in pt.stazioni if any(l[0] == "treno" for l in s["linee"])]
    aggiunte = defaultdict(set)
    nuove = []
    for k, (nome, lat, lon) in sorted(pt.fermate_treno.items()):
        linee = pt.linee_fermata.get(k)
        if not linee and nome in LINEE_MANCANTI_IN_OSM:
            linee = {("treno", LINEE_MANCANTI_IN_OSM[nome])}
        if not linee or not dentro(lat, lon):
            continue
        if any(metri((lat, lon), q) <= 400 for q in con_treno):
            continue
        omonime = [s for s in pt.stazioni + nuove if s["nome"] == nome and s["tipo"] == "stazione"
                   and not metri_in_osm_metro(s) and metri((lat, lon), (s["lat"], s["lon"])) <= 1000]
        if omonime:
            omonime[0]["linee"] |= linee
            aggiunte[nome] |= {l[1] for l in linee}
            continue
        nuove.append({"tipo": "stazione", "nome": nome, "lat": lat, "lon": lon, "nodo": None,
                      "via": None, "tags": {}, "linee": set(linee)})
        aggiunte[nome] |= {l[1] for l in linee}
    return nuove, aggiunte


def metri_in_osm_metro(s):
    return bool(s["tags"]) and metro_in_osm(s)


def ordina_linee(linee):
    def chiave(l):
        m = re.match(r"^([A-Z]+)(\d*)$", l)
        if l.isdigit():
            return (0, int(l), l)
        if m:
            return (1, m.group(1), int(m.group(2) or 0))
        return (2, l, 0)
    return sorted(linee, key=chiave)


def elenco(parole):
    return parole[0] if len(parole) == 1 else ", ".join(parole[:-1]) + " e " + parole[-1]


def dettaglio(categoria, linee):
    linee = ordina_linee(linee)
    if categoria == "metro":
        return ("Linea " if len(linee) == 1 else "Linee ") + elenco(linee)
    if categoria == "tram":
        return ("Tram " if len(linee) == 1 else "Tram ") + elenco(linee)
    return elenco(linee)


def nome_pulito(nome, categoria):
    nome = re.sub(r"\s+", " ", nome or "").strip()
    if categoria == "tram":
        nome = nome.replace("P.za ", "Piazza ").replace("P.le ", "Piazzale ")
    return nome


def raggruppa_tram(fermate):
    """Un punto per fermata: le direzioni con lo stesso nome a meno di 250 m si uniscono."""
    gruppi = []
    for f in sorted(fermate, key=lambda f: (f["nome"], f["lat"], f["lon"])):
        for g in gruppi:
            if g["nome"] == f["nome"] and metri((g["lat"], g["lon"]), (f["lat"], f["lon"])) <= STESSA_FERMATA_METRI:
                g["membri"].append(f)
                g["linee"] |= f["linee"]
                n = len(g["membri"])
                g["lat"] = sum(m["lat"] for m in g["membri"]) / n
                g["lon"] = sum(m["lon"] for m in g["membri"]) / n
                break
        else:
            gruppi.append({"nome": f["nome"], "lat": f["lat"], "lon": f["lon"],
                           "linee": set(f["linee"]), "membri": [f]})
    return gruppi


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Uso: python3 prepara_trasporti.py <file.osm.pbf>")
    rel = Relazioni()
    rel.apply_file(sys.argv[1], osmium.osm.RELATION)
    print("Fermate nelle linee:", len(rel.linee_nodo), "nodi,", len(rel.linee_via), "banchine;",
          "stop_area:", len(rel.aree_fermata))
    pt = Punti(rel)
    pt.apply_file(sys.argv[1], locations=True, idx="flex_mem")
    nomi_b1, nomi_bivio = ramo_b1(rel, pt)
    print("Diramazione B1:", ", ".join(sorted(nomi_b1)) or "non trovata",
          "· bivio:", ", ".join(sorted(nomi_bivio)) or "-")
    assegna_linee(rel, pt)
    ricavate = stazioni_dai_punti_di_fermata(rel, pt)
    if ricavate:
        print("Stazioni ricavate dai punti di fermata:", ", ".join(
            "%s (%s)" % (s["nome"], ", ".join(sorted(l[1] for l in s["linee"]))) for s in ricavate))
    pt.stazioni += ricavate
    dal_binario, aggiunte = stazioni_dal_binario(pt)
    if aggiunte:
        print("Linee prese dal binario:", ", ".join(
            "%s (%s)" % (n, ", ".join(sorted(l))) for n, l in sorted(aggiunte.items())))
    pt.stazioni += dal_binario

    aree = carica_poligoni(QUARTIERI_PATH, ("codice", "denominazione", "tipo", "municipio"))
    candidati = []   # (categoria, nome, lat, lon, linee)
    tram = []
    for s in pt.stazioni:
        if not s["nome"] or not s["linee"]:
            continue
        if s["tipo"] == "tram":
            tram.append({"nome": nome_pulito(s["nome"], "tram"), "lat": s["lat"], "lon": s["lon"],
                         "linee": {l[1] for l in s["linee"] if l[0] == "tram"}})
            continue
        per_cat = defaultdict(set)
        for c, l in s["linee"]:
            per_cat[c].add(l)
        for c, linee in per_cat.items():
            candidati.append((c, nome_pulito(s["nome"], c), s["lat"], s["lon"], linee))
    for g in raggruppa_tram(tram):
        candidati.append(("tram", g["nome"], g["lat"], g["lon"], g["linee"]))

    # La stessa stazione disegnata due volte (nodo e area, o due nodi vicini): una sola.
    unici = {}
    for c, nome, lat, lon, linee in candidati:
        chiave = (c, nome)
        vecchio = unici.get(chiave)
        if vecchio and metri((vecchio[2], vecchio[3]), (lat, lon)) <= STESSA_FERMATA_METRI:
            vecchio[4] |= linee
            continue
        unici[chiave if not vecchio else (c, nome, lat, lon)] = [c, nome, lat, lon, set(linee)]

    nuove, fuori = [], Counter()
    for c, nome, lat, lon, linee in unici.values():
        area = trova_area(lon, lat, aree) or trova_area_vicina(lon, lat, aree)
        if not area:
            fuori[c] += 1
            continue
        nota = CHIUSE.get((c, nome))
        if nota:
            print("  chiusa per lavori:", nome, "-", nota)
            # "prevista" la toglie dai servizi attivi dei 15 minuti; info l = chiusa per
            # lavori, cosi' la mappa scrive "(chiusa per lavori)" e non "(prevista)".
            extra = ("", dettaglio(c, linee) + " · " + nota, "prevista", {"l": 1})
        else:
            extra = ("", dettaglio(c, linee))
        nuove.append((c, nome, area["codice"], area["municipio"], round(lat, 5), round(lon, 5), extra))

    d = json.loads(OUT_PATH.read_text(encoding="utf-8"))
    altre = [(d["c"][p[0]], p[1], p[2], p[3], p[4], p[5], tuple(p[6:])) for p in d["p"]
             if d["c"][p[0]] not in CATEGORIE]
    conta = Counter(p[0] for p in nuove)
    print("dentro Roma: " + ", ".join("%s %d" % (c, conta[c]) for c in CATEGORIE)
          + " · fuori dalle aree: " + ", ".join("%s %d" % kv for kv in sorted(fuori.items())))
    linee_viste = defaultdict(set)
    for p in nuove:
        for l in re.split(r", | e ", re.sub(r"^(Line[ae]|Tram) ", "", p[6][1])):
            linee_viste[p[0]].add(l)
    for c in CATEGORIE:
        print("  linee %s: %s" % (c, ", ".join(ordina_linee(linee_viste[c]))))
    scrivi(accorpa_doppioni(altre + nuove))


if __name__ == "__main__":
    main()
