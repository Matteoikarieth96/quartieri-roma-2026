#!/usr/bin/env python3
"""
Copertura dei 15 minuti su tutta Roma: per ogni esagono abitato (circa 250 m da lato
a lato) il tempo a piedi fino al servizio essenziale piu' vicino, categoria per
categoria. E' il dato della prima vista della 2D: dove i servizi essenziali NON si
raggiungono a piedi in 15 minuti.

Stesso calcolo del pulsante "A piedi in 15 minuti", fatto una volta per tutta la
citta' invece che da un punto: la rete pedonale di data/rete/ (prepara_rete_pedonale.py),
i servizi di data/servizi/servizi.json, 4,8 km/h, il punto e il servizio agganciati
alla strada piu' vicina. Al contrario del browser si parte dai servizi: un Dijkstra
con tutte le sedi di una categoria come sorgenti da' a ogni incrocio la distanza dalla
sede piu' vicina.

Abitanti: la griglia di popolazione GHS-POP 2025 (Commissione europea, JRC, CC BY 4.0),
pixel di 3 secondi d'arco (circa 90 x 70 m), sommati per esagono. Gli esagoni sotto
SOGLIA_ABITANTI (zone agricole, parchi grandi, aree industriali) restano fuori: non si
colorano. Il tempo di un esagono si misura dal suo baricentro pesato sugli abitanti,
cioe' da dove la gente abita davvero.

Serve numpy, scipy, tifffile e imagecodecs (il GeoTIFF e' compresso LZW); non sono
dipendenze del build: il dato si rifa' solo quando cambiano rete o servizi. La griglia si scarica dal sito del GHSL, tessera
R5_C20 del prodotto GHS_POP_E2025_GLOBE_R2023A_4326_3ss:
  https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_POP_GLOBE_R2023A/
  GHS_POP_E2025_GLOBE_R2023A_4326_3ss/V1-0/tiles/

Uso:
    python3 prepara_copertura_15_minuti.py <GHS_POP_..._R5_C20.tif>

Scrive data/copertura/copertura.json:
  {"esagono": {"lato": metri, "lat0", "lon0", "kx", "ky"},
   "categorie": [...], "soglia": minuti, "abitanti_min": N,
   "celle": [q, r, abitanti, minuti categoria 1, ..., minuti categoria n, q, r, ...]}
q e r sono le coordinate assiali dell'esagono (punta in alto) nel piano locale
x = (lon - lon0) * kx, y = (lat - lat0) * ky; i minuti vanno da 1 a OLTRE (61 = oltre
un'ora o nessuna strada).
"""

import json
import math
import sys
from pathlib import Path

import numpy as np
import tifffile
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra

SCRIPT_DIR = Path(__file__).resolve().parent
RETE_DIR = SCRIPT_DIR / "data" / "rete"
SERVIZI = SCRIPT_DIR / "data" / "servizi" / "servizi.json"
MUNICIPI = SCRIPT_DIR / "data" / "municipi-roma.geojson"
OUT = SCRIPT_DIR / "data" / "copertura" / "copertura.json"

VEL = 80                    # metri al minuto, 4,8 km/h: come Q15_VEL della mappa
SOGLIA = 15                 # minuti
OLTRE = 61                  # oltre un'ora, o nessuna strada vicina
LATO = 144.0                # metri dal centro al vertice: 250 m da lato a lato, 0,054 km²
ABITANTI_MIN = 50           # sotto, l'esagono non si colora (circa 900 abitanti per km²)
AGGANCIO_MAX = 300          # metri dalla strada, come l'aggancio dei servizi nel browser

LAT0, LON0 = 41.9, 12.5
KX = 111320 * math.cos(math.radians(LAT0))
KY = 110540.0

# Categorie essenziali, nell'ordine del file: chiave -> categorie del registro.
# La salute conta le Case della Comunita' attive e i pronto soccorso generali.
ESSENZIALI = [
    ("nido", ["nido"]),
    ("infanzia", ["infanzia"]),
    ("primaria", ["primaria"]),
    ("media", ["media"]),
    ("farmacie", ["farmacie"]),
    ("salute", ["casa_comunita", "pronto_soccorso"]),
    ("parchi", ["parchi_e_aree_gioco"]),
]


# ---------- esagoni ----------

def in_metri(lat, lon):
    return (np.asarray(lon) - LON0) * KX, (np.asarray(lat) - LAT0) * KY


def esagono_di(x, y):
    """Coordinate assiali (q, r) dell'esagono a punta in alto che contiene (x, y)."""
    qf = (math.sqrt(3) / 3 * x - y / 3) / LATO
    rf = (2 / 3 * y) / LATO
    sf = -qf - rf
    q, r, s = np.rint(qf), np.rint(rf), np.rint(sf)
    dq, dr, ds = np.abs(q - qf), np.abs(r - rf), np.abs(s - sf)
    fix_q = (dq > dr) & (dq > ds)
    fix_r = ~fix_q & (dr > ds)
    q = np.where(fix_q, -r - s, q)
    r = np.where(fix_r, -q - s, r)
    return q.astype(np.int64), r.astype(np.int64)


def centro_esagono(q, r):
    x = LATO * math.sqrt(3) * (q + r / 2)
    y = LATO * 1.5 * r
    return LAT0 + y / KY, LON0 + x / KX


# ---------- popolazione ----------

def leggi_popolazione(tif, sud, ovest, nord, est):
    """Pixel della griglia GHS-POP dentro il riquadro: (lat, lon, abitanti) dei pixel abitati.
    Legge solo le tessere interne del GeoTIFF che toccano il riquadro."""
    with tifffile.TiffFile(tif) as t:
        pg = t.pages[0]
        sx, sy = pg.tags["ModelPixelScaleTag"].value[:2]
        x0, y0 = pg.tags["ModelTiepointTag"].value[3:5]
        c0, c1 = int((ovest - x0) / sx), int((est - x0) / sx) + 1
        r0, r1 = int((y0 - nord) / sy), int((y0 - sud) / sy) + 1
        tw, tl = pg.tilewidth, pg.tilelength
        per_riga = -(-pg.imagewidth // tw)
        out = np.zeros((r1 - r0, c1 - c0), dtype=np.float64)
        fh = t.filehandle
        for tr in range(r0 // tl, (r1 - 1) // tl + 1):
            for tc in range(c0 // tw, (c1 - 1) // tw + 1):
                i = tr * per_riga + tc
                fh.seek(pg.dataoffsets[i])
                blocco = pg.decode(fh.read(pg.databytecounts[i]), i)[0].reshape(tl, tw)
                ra, ca = tr * tl, tc * tw
                a0, a1 = max(r0, ra), min(r1, ra + tl)
                b0, b1 = max(c0, ca), min(c1, ca + tw)
                out[a0 - r0:a1 - r0, b0 - c0:b1 - c0] = blocco[a0 - ra:a1 - ra, b0 - ca:b1 - ca]
    out[out < 0] = 0                     # nodata (-200) e simili
    rr, cc = np.nonzero(out > 0)
    lat = y0 - (rr + r0 + 0.5) * sy
    lon = x0 + (cc + c0 + 0.5) * sx
    return lat, lon, out[rr, cc]


# ---------- confine del comune ----------

def anelli_comune():
    d = json.loads(MUNICIPI.read_text())
    anelli = []
    for f in d["features"]:
        g = f["geometry"]
        poligoni = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        for p in poligoni:
            for anello in p:
                anelli.append(np.asarray(anello, dtype=np.float64))
    return anelli


def dentro_comune(lat, lon, anelli):
    """Pari-dispari su tutti gli anelli dei municipi: i buchi si annullano da soli."""
    dentro = np.zeros(len(lat), dtype=bool)
    for a in anelli:
        xa, ya = a[:-1, 0], a[:-1, 1]
        xb, yb = a[1:, 0], a[1:, 1]
        for i in range(len(xa)):
            attraversa = (ya[i] > lat) != (yb[i] > lat)
            if not attraversa.any():
                continue
            xi = xa[i] + (lat - ya[i]) * (xb[i] - xa[i]) / ((yb[i] - ya[i]) or 1e-12)
            dentro ^= attraversa & (lon < xi)
    return dentro


# ---------- rete pedonale ----------

def leggi_rete():
    archi = []          # (a, b, lunghezza, [(lat, lon), ...])
    indice = json.loads((RETE_DIR / "indice.json").read_text())
    for k in indice["riquadri"]:
        for a, b, lun, f in json.loads((RETE_DIR / ("r%s.json" % k)).read_text())["e"]:
            la, lo = f[0], f[1]
            pts = [(la / 1e5, lo / 1e5)]
            for i in range(2, len(f), 2):
                la += f[i]
                lo += f[i + 1]
                pts.append((la / 1e5, lo / 1e5))
            archi.append((a, b, lun, pts))
    return archi


class Aggancio:
    """La strada piu' vicina a un punto: arco, metri lungo l'arco, metri per arrivarci.
    Come q15Aggancia della mappa: lunghezze lungo il tracciato riscalate sulla lunghezza
    dell'arco, distanze nel piano locale."""

    PASSO = 0.002       # celle dell'indice, circa 220 x 165 m

    def __init__(self, archi):
        sa, sb, arco, s0, s1 = [], [], [], [], []
        for i, (_, _, lun, pts) in enumerate(archi):
            p = np.asarray(pts)
            x, y = in_metri(p[:, 0], p[:, 1])
            seg = np.hypot(np.diff(x), np.diff(y))
            cum = np.concatenate([[0], np.cumsum(seg)])
            k = lun / cum[-1] if cum[-1] else 1
            for j in range(len(p) - 1):
                sa.append((x[j], y[j]))
                sb.append((x[j + 1], y[j + 1]))
                arco.append(i)
                s0.append(cum[j] * k)
                s1.append(cum[j + 1] * k)
        self.a, self.b = np.asarray(sa), np.asarray(sb)
        self.arco, self.s0, self.s1 = np.asarray(arco), np.asarray(s0), np.asarray(s1)
        # indice a celle: ogni segmento nelle celle del suo riquadro
        passo_x, passo_y = self.PASSO * KX, self.PASSO * KY
        self.passo = (passo_x, passo_y)
        lo = np.minimum(self.a, self.b)
        hi = np.maximum(self.a, self.b)
        self.celle = {}
        for i in range(len(self.a)):
            for cx in range(int(lo[i, 0] // passo_x), int(hi[i, 0] // passo_x) + 1):
                for cy in range(int(lo[i, 1] // passo_y), int(hi[i, 1] // passo_y) + 1):
                    self.celle.setdefault((cx, cy), []).append(i)

    def __call__(self, lat, lon, massimo=AGGANCIO_MAX):
        x, y = in_metri(lat, lon)
        x, y = float(x), float(y)
        px, py = self.passo
        raggio = int(math.ceil(massimo / min(px, py)))
        cx0, cy0 = int(x // px), int(y // py)
        cand = []
        for cx in range(cx0 - raggio, cx0 + raggio + 1):
            for cy in range(cy0 - raggio, cy0 + raggio + 1):
                cand.extend(self.celle.get((cx, cy), ()))
        if not cand:
            return None
        c = np.unique(np.asarray(cand))
        a, b = self.a[c], self.b[c]
        d = b - a
        l2 = (d ** 2).sum(1)
        t = np.where(l2 > 0, np.clip(((x - a[:, 0]) * d[:, 0] + (y - a[:, 1]) * d[:, 1]) / np.where(l2 > 0, l2, 1), 0, 1), 0)
        qx, qy = a[:, 0] + t * d[:, 0], a[:, 1] + t * d[:, 1]
        dist = np.hypot(qx - x, qy - y)
        j = int(np.argmin(dist))
        if dist[j] > massimo:
            return None
        k = c[j]
        return int(self.arco[k]), float(self.s0[k] + t[j] * (self.s1[k] - self.s0[k])), float(dist[j])


def grafo(archi):
    """Grafo non orientato sugli incroci, con un nodo in piu' (l'ultimo) come super-sorgente."""
    ids = {}
    for a, b, _, _ in archi:
        ids.setdefault(a, len(ids))
        ids.setdefault(b, len(ids))
    return ids


def distanze(archi, ids, sorgenti, limite):
    """Metri dalla sede piu' vicina a ogni incrocio. sorgenti: (arco, s, d) agganciati."""
    n = len(ids) + 1
    sup = n - 1
    da, a_, w = [], [], []
    for a, b, lun, _ in archi:
        ia, ib = ids[a], ids[b]
        da += [ia, ib]
        a_ += [ib, ia]
        w += [lun, lun]
    for e, s, d in sorgenti:
        a, b, lun, _ = archi[e]
        da += [sup, sup]
        a_ += [ids[a], ids[b]]
        w += [d + s, d + lun - s]
    da, a_, w = np.asarray(da), np.asarray(a_), np.maximum(np.asarray(w, dtype=np.float64), 1e-3)
    # archi doppi: csr_matrix li sommerebbe, si tiene il piu' corto
    ordine = np.lexsort((w, a_, da))
    da, a_, w = da[ordine], a_[ordine], w[ordine]
    primo = np.ones(len(da), dtype=bool)
    primo[1:] = (da[1:] != da[:-1]) | (a_[1:] != a_[:-1])
    m = csr_matrix((w[primo], (da[primo], a_[primo])), shape=(n, n))
    return dijkstra(m, directed=True, indices=sup, limit=limite)


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Uso: python3 prepara_copertura_15_minuti.py <GHS_POP_E2025_..._R5_C20.tif>")
    if not (RETE_DIR / "indice.json").exists():
        raise SystemExit("Manca la rete pedonale in " + str(RETE_DIR) + " (prepara_rete_pedonale.py).")

    # 1. Abitanti per esagono, solo dentro il comune.
    sud, ovest, nord, est = 41.64, 12.22, 42.17, 12.87
    plat, plon, pab = leggi_popolazione(sys.argv[1], sud, ovest, nord, est)
    px, py = in_metri(plat, plon)
    q, r = esagono_di(px, py)
    chiave = (q + 10000) * 100000 + (r + 10000)
    uniche, inv = np.unique(chiave, return_inverse=True)
    ab = np.bincount(inv, weights=pab)
    bx = np.bincount(inv, weights=pab * px) / np.maximum(ab, 1e-9)
    by = np.bincount(inv, weights=pab * py) / np.maximum(ab, 1e-9)
    eq = uniche // 100000 - 10000
    er = uniche % 100000 - 10000
    clat, clon = np.array([centro_esagono(a, b) for a, b in zip(eq, er)]).T
    nel_comune = dentro_comune(clat, clon, anelli_comune())
    print("Abitanti nel comune (GHS-POP 2025): %d" % ab[nel_comune].sum())
    tenere = nel_comune & (ab >= ABITANTI_MIN)
    print("Esagoni con almeno %d abitanti: %d su %d nel comune, %.1f%% degli abitanti"
          % (ABITANTI_MIN, tenere.sum(), nel_comune.sum(), 100 * ab[tenere].sum() / ab[nel_comune].sum()))
    eq, er, ab, bx, by = eq[tenere], er[tenere], ab[tenere], bx[tenere], by[tenere]
    blat, blon = LAT0 + by / KY, LON0 + bx / KX

    # 2. Rete, aggancio dei baricentri.
    archi = leggi_rete()
    ids = grafo(archi)
    aggancia = Aggancio(archi)
    print("Rete: %d archi, %d incroci" % (len(archi), len(ids)))
    celle = [aggancia(la, lo) for la, lo in zip(blat, blon)]
    senza = sum(1 for c in celle if c is None)
    print("Esagoni senza strada entro %d m: %d" % (AGGANCIO_MAX, senza))

    # 3. Servizi essenziali attivi, agganciati.
    sv = json.loads(SERVIZI.read_text())
    cat_nomi = sv["c"]
    minuti = np.full((len(eq), len(ESSENZIALI)), OLTRE, dtype=np.int64)
    limite = (OLTRE - 1) * VEL
    for j, (chiave_ess, del_registro) in enumerate(ESSENZIALI):
        idx = {cat_nomi.index(c) for c in del_registro}
        sorgenti, fuori = [], 0
        for p in sv["p"]:
            if p[0] not in idx or (len(p) > 8 and p[8] == "prevista"):
                continue
            ag = aggancia(p[4], p[5])
            if ag is None:
                fuori += 1
                continue
            sorgenti.append(ag)
        dist = distanze(archi, ids, sorgenti, limite)
        for i, c in enumerate(celle):
            if c is None:
                continue
            e, s, d = c
            a, b, lun, _ = archi[e]
            t = min(dist[ids[a]] + s, dist[ids[b]] + lun - s) + d
            if t <= limite:
                minuti[i, j] = max(1, int(round(t / VEL)))
        entro = minuti[:, j] <= SOGLIA
        print("%-9s %4d sedi (%d senza strada) · abitanti a piu' di %d minuti: %4.1f%%"
              % (chiave_ess, len(sorgenti), fuori, SOGLIA, 100 * ab[~entro].sum() / ab.sum()))

    mancano = (minuti > SOGLIA).sum(1)
    print("Abitanti per numero di essenziali mancanti:")
    for k in range(len(ESSENZIALI) + 1):
        print("  %d: %4.1f%%  (%d esagoni)" % (k, 100 * ab[mancano == k].sum() / ab.sum(), (mancano == k).sum()))

    flat = []
    for i in range(len(eq)):
        flat += [int(eq[i]), int(er[i]), int(round(ab[i], -1))] + [int(m) for m in minuti[i]]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "esagono": {"lato": LATO, "lat0": LAT0, "lon0": LON0, "kx": round(KX, 3), "ky": KY},
        "categorie": [c for c, _ in ESSENZIALI],
        "soglia": SOGLIA, "oltre": OLTRE, "abitanti_min": ABITANTI_MIN,
        "fonti": "Rete pedonale OpenStreetMap (ODbL); servizi come nella mappa; abitanti GHS-POP 2025, "
                 "Commissione europea JRC (CC BY 4.0)",
        "celle": flat,
    }, separators=(",", ":")))
    print("Scritto %s: %d esagoni, %.0f KB" % (OUT.relative_to(SCRIPT_DIR), len(eq), OUT.stat().st_size / 1024))


if __name__ == "__main__":
    main()
