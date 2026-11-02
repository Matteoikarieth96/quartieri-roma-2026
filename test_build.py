import json
import sys
from pathlib import Path

import pytest

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))

import build  # noqa: E402


def intestazioni_generali(config):
    return {h["key"]: h["value"] for h in config["headers"][0]["headers"]}


def test_anteprima_ha_x_robots_tag():
    gen = intestazioni_generali(build.config_vercel(produzione=False))
    assert gen["X-Robots-Tag"] == "noindex, nofollow"


def test_produzione_toglie_x_robots_tag():
    gen = intestazioni_generali(build.config_vercel(produzione=True))
    assert "X-Robots-Tag" not in gen


@pytest.mark.parametrize("produzione", [False, True])
def test_header_di_sicurezza(produzione):
    cfg = build.config_vercel(produzione)
    gen = intestazioni_generali(cfg)
    assert gen["X-Content-Type-Options"] == "nosniff"
    assert gen["Referrer-Policy"] == "strict-origin-when-cross-origin"
    csp = gen["Content-Security-Policy-Report-Only"]
    assert "font-src 'self' data:" in csp and "tile.openstreetmap.org" in csp
    assert "frame-ancestors" not in csp
    assert "X-Frame-Options" not in json.dumps(cfg)


def test_produzione_toglie_il_meta_noindex():
    html = "<head>\n" + build.META_NOINDEX + "\n<title>x</title></head>"
    out = build.senza_noindex(html)
    assert "noindex" not in out and "<title>x</title>" in out


def test_senza_noindex_fallisce_se_il_meta_manca():
    with pytest.raises(SystemExit):
        build.senza_noindex("<head></head>")


def test_template_ha_il_meta_noindex():
    assert build.META_NOINDEX in (BASE / "mappa-quartieri.template.html").read_text(encoding="utf-8")


def test_produzione_fallisce_senza_rete(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "RETE_SRC", tmp_path / "manca")
    monkeypatch.setattr(build, "RETE_OUT", tmp_path / "out" / "rete")
    monkeypatch.setattr(build, "QUINDICI_VECCHIO_OUT", tmp_path / "out" / "v.json")
    with pytest.raises(SystemExit):
        build.copia_rete(produzione=True)
    assert build.copia_rete(produzione=False) is None


def test_licenze_presenti():
    assert "BSD 2-Clause" in (BASE / "vendor" / "leaflet" / "LICENSE").read_text(encoding="utf-8")
    assert "SIL OPEN FONT LICENSE" in (BASE / "vendor" / "fonts" / "OFL.txt").read_text(encoding="utf-8")


def test_copertura_in_cache_lunga():
    sorgenti = [h["source"] for h in build.config_vercel(False)["headers"]]
    assert "/copertura/(.*)" in sorgenti


def test_copertura_riscritta_e_validata(tmp_path, monkeypatch):
    src = tmp_path / "copertura.json"
    monkeypatch.setattr(build, "COPERTURA_NEL_RILASCIO", True)   # nel rilascio e' spenta: qui si prova il codice
    monkeypatch.setattr(build, "COPERTURA_SRC", src)
    monkeypatch.setattr(build, "COPERTURA_OUT", tmp_path / "out" / "copertura")
    assert build.copia_copertura() is None          # senza file: niente strato, build avanti
    base = {"esagono": {"lato": 144, "lat0": 41.9, "lon0": 12.5, "kx": 82900, "ky": 110540},
            "categorie": ["nido", "salute"], "soglia": 15, "oltre": 61, "abitanti_min": 50,
            "fonti": "testo che non deve arrivare in dist", "celle": [0, 0, 120, 5, 61]}
    src.write_text(json.dumps(base), encoding="utf-8")
    assert build.copia_copertura()
    out = json.loads((tmp_path / "out" / "copertura" / "copertura.json").read_text(encoding="utf-8"))
    assert out["celle"] == [0, 0, 120, 5, 61] and "fonti" not in out
    base["celle"] = [0, 0, 120, 5]                   # una cella monca
    src.write_text(json.dumps(base), encoding="utf-8")
    with pytest.raises(SystemExit):
        build.copia_copertura()


def test_copertura_coerente_coi_dati():
    d = json.loads((BASE / "data" / "copertura" / "copertura.json").read_text(encoding="utf-8"))
    passo = 3 + len(d["categorie"])
    celle = d["celle"]
    assert len(celle) % passo == 0 and len(celle) // passo > 5000
    assert "salute" in d["categorie"]
    assert all(celle[i + 2] >= d["abitanti_min"] for i in range(0, len(celle), passo))


# ---------- Intro: il contorno di Roma ----------

def _municipi():
    return json.loads((BASE / "data" / "municipi-roma.geojson").read_text(encoding="utf-8"))


def _area(anello):
    return sum(anello[i][0] * anello[(i + 1) % len(anello)][1] - anello[(i + 1) % len(anello)][0] * anello[i][1]
               for i in range(len(anello))) / 2.0


def test_contorno_e_l_unione_dei_municipi():
    # Due anelli: il contorno principale e l'isola amministrativa del Municipio XV. Il buco del
    # Vaticano e le schegge cadono; antiorari, quindi con area positiva.
    anelli = build.contorno_unione(_municipi())
    assert len(anelli) == 2
    aree = [_area(a) for a in anelli]
    assert 0.130 < aree[0] < 0.145 and 0.0008 < aree[1] < 0.0016      # gradi quadrati
    assert len(anelli[0]) > 500


def test_contorno_senza_confini_interni():
    # Nessuno spigolo del contorno e' condiviso fra due municipi: se un confine interno
    # restasse, comparirebbe come spigolo percorso in entrambi i versi dai municipi.
    g = _municipi()
    verso = {}
    for f in g["features"]:
        geo = f["geometry"]
        for pol in ([geo["coordinates"]] if geo["type"] == "Polygon" else geo["coordinates"]):
            for anello in pol:
                pts = [(round(c[0], 6), round(c[1], 6)) for c in anello]
                for a, b in zip(pts, pts[1:]):
                    verso.setdefault(frozenset((a, b)), set()).add((a, b))
    interni = {e for e, versi in verso.items() if len(versi) > 1}
    assert len(interni) > 100           # i municipi si toccano davvero, per molti spigoli
    for anello in build.contorno_unione(g):
        for a, b in zip(anello, anello[1:] + anello[:1]):
            assert frozenset((a, b)) not in interni


def test_intro_svg_un_tratto_solo_con_il_riquadro_dei_municipi():
    import math
    import re
    g = _municipi()
    svg = build.costruisci_intro_svg(g)
    assert svg.count("<path") == 1 and 'pathLength="1"' in svg and 'id="intro-tratto"' in svg
    d = re.search(r' d="([^"]+)"', svg).group(1)
    quota = float(re.search(r'data-anello="([0-9.]+)"', svg).group(1))
    assert 0.85 < quota < 1.0          # l'anello principale e' quasi tutto il tratto
    assert 1 <= d.count("M") <= 2 and d.count("M") == d.count("Z")      # niente confini interni: al massimo due sottopercorsi
    # il riquadro e' quello dei municipi (x lineare in longitudine, y in Mercatore)
    lon = [c[0] for f in g["features"] for pol in ([f["geometry"]["coordinates"]] if f["geometry"]["type"] == "Polygon" else f["geometry"]["coordinates"]) for an in pol for c in an]
    lat = [c[1] for f in g["features"] for pol in ([f["geometry"]["coordinates"]] if f["geometry"]["type"] == "Polygon" else f["geometry"]["coordinates"]) for an in pol for c in an]
    attr = {k: float(re.search(r'data-%s="([^"]+)"' % k, svg).group(1)) for k in ("ovest", "est", "nord", "sud")}
    assert attr["ovest"] == pytest.approx(min(lon), abs=1e-6) and attr["est"] == pytest.approx(max(lon), abs=1e-6)
    assert attr["nord"] == pytest.approx(max(lat), abs=1e-6) and attr["sud"] == pytest.approx(min(lat), abs=1e-6)
    larg, alt = (int(v) for v in re.search(r'viewBox="0 0 (\d+) (\d+)"', svg).groups())
    merc = lambda la: math.degrees(math.log(math.tan(math.pi / 4 + math.radians(la) / 2)))
    scala = larg / (attr["est"] - attr["ovest"])
    assert alt == math.ceil((merc(attr["nord"]) - merc(attr["sud"])) * scala)      # altezza arrotondata per eccesso
    # tutti i punti del tratto stanno dentro il riquadro, e il primo e' sulla costa (foce del Tevere)
    num = [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?", d)]
    xs, ys = num[0::2], num[1::2]
    assert min(xs) >= 0 and max(xs) <= larg and min(ys) >= 0 and max(ys) <= alt
    x0 = (build.FOCE_TEVERE[0] - attr["ovest"]) * scala
    assert abs(xs[0] - x0) < 25


def test_template_ha_i_punti_dell_intro():
    t = (BASE / "mappa-quartieri.template.html").read_text(encoding="utf-8")
    for pezzo in ("<<INTRO_SVG>>", 'localStorage.getItem("rq-intro")', 'localStorage.setItem("rq-intro"',
                  "I.contorno = function", "I.conta = function", "I.composta = function", "I.ponteCambiato = function",
                  "disegnato: function (cb)", "saltata: false", "data-anello"):
        assert pezzo in t, pezzo
    assert "intro-municipi" not in t and "data-m=" not in t       # via il disegno dei municipi
    # la scritta e' una sola, il cartello: niente parametri di prova ne' varianti
    for avanzo in ("ritmo", "?titolo", "intro-t-", "intro-lt"):
        assert avanzo not in t, avanzo
