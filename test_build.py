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


def test_produzione_fallisce_senza_rete_bici(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "RETE_BICI_SRC", tmp_path / "manca")
    monkeypatch.setattr(build, "RETE_BICI_OUT", tmp_path / "out" / "rete-bici")
    with pytest.raises(SystemExit):
        build.copia_rete_bici(produzione=True)
    # Per scelta (--senza-bici) o in anteprima esce col solo "a piedi".
    assert build.copia_rete_bici(produzione=True, senza_bici=True) is None
    assert build.copia_rete_bici(produzione=False) is None


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


# ---------- Statistiche anonime (Umami) ----------

ID_FINTO = "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e"
LINK_FINTO = "https://statistiche.romaquartieri.it/share/abc123/romaquartieri.it"


ID_VERO = "e64e0e86-8411-4550-a522-5042428e6f63"
LINK_VERO = "https://statistiche.romaquartieri.it/share/yOxOhcv40CICQKN3"
SRI_VERO = "sha384-ZMxgpYfO/phGz4GiYTIZhcauuGKTb2onmOB5gsiigjmBR38DGAmIna5J1Y/dM/13"


@pytest.fixture
def senza_env(monkeypatch):
    # Nessuna variabile d'ambiente che scavalchi le costanti.
    monkeypatch.delenv("MAPPA_STATISTICHE_ID", raising=False)
    monkeypatch.delenv("MAPPA_STATISTICHE_LINK", raising=False)
    monkeypatch.delenv("MAPPA_STATISTICHE_SRI", raising=False)
    return monkeypatch


@pytest.fixture
def statistiche(senza_env):
    # Costanti vuote, come in un fork che le spegne.
    senza_env.setattr(build, "STATISTICHE_WEBSITE_ID", "")
    senza_env.setattr(build, "STATISTICHE_LINK_PUBBLICO", "")
    return senza_env


def _template():
    return (BASE / "mappa-quartieri.template.html").read_text(encoding="utf-8")


def _csp():
    return intestazioni_generali(build.config_vercel(True))["Content-Security-Policy-Report-Only"]


def _direttiva(csp, nome):
    return next(d.strip() for d in csp.split(";") if d.strip().startswith(nome + " "))


def test_statistiche_spente_senza_id(statistiche):
    assert build.tag_statistiche() == ""
    out = build.applica_statistiche(_template())
    assert 'id="rq-statistiche"' not in out and "script.js" not in out and "data-website-id" not in out
    assert "statistiche.romaquartieri.it" not in out
    assert "<<STATISTICHE" not in out and "<</STATISTICHE" not in out
    assert "statistiche.romaquartieri.it" not in _csp()


def test_statistiche_tag_con_id(statistiche):
    statistiche.setattr(build, "STATISTICHE_WEBSITE_ID", ID_FINTO)
    tag = build.tag_statistiche()
    assert tag.startswith("<script async ") and tag.endswith("></script>") and " defer" not in tag
    for attributo in ('id="rq-statistiche"', 'src="https://statistiche.romaquartieri.it/script.js"',
                      'data-website-id="' + ID_FINTO + '"', 'data-domains="romaquartieri.it"',
                      'data-auto-track="false"', 'data-do-not-track="true"',
                      'data-exclude-search="true"', 'data-exclude-hash="true"'):
        assert attributo in tag, attributo
    out = build.applica_statistiche(_template())
    testa = out[:out.index("</head>")]
    assert testa.count(tag) == 1 and out.count('id="rq-statistiche"') == 1
    # il tag arriva dopo MAPPA_TRACCIA, che ne ascolta il caricamento
    assert testa.index("window.MAPPA_TRACCIA = function") < testa.index(tag)


@pytest.mark.skipif(not build.STATISTICHE_WEBSITE_ID, reason="ID svuotato (fork senza statistiche, vedi README)")
def test_statistiche_del_repository_accese(senza_env):
    # Le costanti committate: il sito vero e il link pubblico vero.
    assert build.STATISTICHE_WEBSITE_ID == ID_VERO and build.STATISTICHE_LINK_PUBBLICO == LINK_VERO
    tag = build.tag_statistiche()
    assert 'data-website-id="' + ID_VERO + '"' in tag and 'data-domains="romaquartieri.it"' in tag
    assert 'data-auto-track="false"' in tag and "data-distinct-id" not in tag and "data-performance" not in tag
    assert 'integrity="' + SRI_VERO + '"' in tag and 'crossorigin="anonymous"' in tag
    out = build.applica_statistiche(_template())
    assert out.count('id="rq-statistiche"') == 1 and out.count('href="' + LINK_VERO + '"') == 1
    csp = _csp()
    assert "https://statistiche.romaquartieri.it" in _direttiva(csp, "script-src")
    assert "https://statistiche.romaquartieri.it" in _direttiva(csp, "connect-src")


def test_statistiche_spente_dalla_variabile_d_ambiente(senza_env):
    # MAPPA_STATISTICHE_ID vuota spegne lo script anche con l'ID nel file (build di prova, fork).
    senza_env.setenv("MAPPA_STATISTICHE_ID", "")
    assert build.tag_statistiche() == ""
    assert "statistiche.romaquartieri.it" not in _csp() and "statistiche.romaquartieri.it" not in build.csp_report_only()


def test_statistiche_id_dalla_variabile_d_ambiente(statistiche):
    statistiche.setenv("MAPPA_STATISTICHE_ID", ID_FINTO)
    assert ID_FINTO in build.tag_statistiche()


def test_statistiche_id_non_valido(statistiche):
    statistiche.setattr(build, "STATISTICHE_WEBSITE_ID", "non-un-uuid\" onload=\"x")
    with pytest.raises(SystemExit):
        build.tag_statistiche()


def test_sri_vuoto_niente_integrity(senza_env):
    senza_env.setattr(build, "STATISTICHE_SRI", "")
    tag = build.tag_statistiche()
    assert "integrity=" not in tag and "crossorigin=" not in tag


def test_sri_pieno_integrity_e_crossorigin(senza_env):
    hash_ = "sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8wC"
    senza_env.setattr(build, "STATISTICHE_SRI", hash_)
    tag = build.tag_statistiche()
    assert 'integrity="' + hash_ + '"' in tag and 'crossorigin="anonymous"' in tag
    senza_env.setenv("MAPPA_STATISTICHE_ID", "")      # senza ID niente tag, quindi niente integrity
    assert build.tag_statistiche() == ""


def test_sri_dalla_variabile_d_ambiente(senza_env):
    # MAPPA_STATISTICHE_SRI vuota toglie l'integrity anche con l'hash nel file (dist delle suite).
    senza_env.setattr(build, "STATISTICHE_SRI", "sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8wC")
    senza_env.setenv("MAPPA_STATISTICHE_SRI", "")
    assert "integrity=" not in build.tag_statistiche() and "crossorigin=" not in build.tag_statistiche()


def test_sri_non_valido(senza_env):
    senza_env.setattr(build, "STATISTICHE_SRI", 'md5-abc" onerror="x')
    with pytest.raises(SystemExit):
        build.tag_statistiche()


def test_csp_con_le_statistiche(statistiche):
    statistiche.setattr(build, "STATISTICHE_WEBSITE_ID", ID_FINTO)
    csp = _csp()
    for direttiva in ("script-src", "connect-src"):
        assert "https://statistiche.romaquartieri.it" in _direttiva(csp, direttiva), direttiva
    assert "statistiche" not in _direttiva(csp, "img-src")
    assert "tile.openstreetmap.org" in _direttiva(csp, "connect-src")


def test_link_statistiche_solo_col_link_pubblico(statistiche):
    t = _template()
    assert "Le statistiche sono pubbliche" in t
    senza = build.applica_statistiche(t)
    assert "Le statistiche sono pubbliche" not in senza and 'id="ab-statistiche"' not in senza
    statistiche.setattr(build, "STATISTICHE_LINK_PUBBLICO", LINK_FINTO)
    con = build.applica_statistiche(t)
    assert con.count('href="' + LINK_FINTO + '"') == 1 and "Le statistiche sono pubbliche" in con
    assert "<<STATISTICHE" not in con and "<</STATISTICHE" not in con
    # il link sta nel pannello "Cos'e'", accanto alla nota sulla privacy
    pannello = con[con.index('id="about-panel"'):con.index('id="tour-veil"')]
    assert 'id="ab-statistiche"' in pannello
    # il link e' indipendente dall'ID: senza ID niente script, ma il link resta
    assert "data-website-id" not in con


def test_link_statistiche_non_https(statistiche):
    statistiche.setattr(build, "STATISTICHE_LINK_PUBBLICO", "javascript:alert(1)")
    with pytest.raises(SystemExit):
        build.applica_statistiche(_template())


def test_testo_visibile_delle_statistiche_senza_lineette():
    t = _template()
    blocco = t[t.index("<!--<<STATISTICHE_LINK>>-->"):t.index("<!--<</STATISTICHE_LINK>>-->")]
    assert "—" not in blocco and "--" not in blocco.replace("<!--<<STATISTICHE_LINK>>-->", "")
    # il commento sopra il blocco esce nell'HTML pubblico: niente "provvisorio"
    inizio = t.index("<!--<<STATISTICHE_LINK>>-->")
    assert "provvisori" not in t[inizio - 300:inizio]


def test_eventi_agganciati_nel_codice():
    # Gli undici eventi passano da traccia/MAPPA_TRACCIA, con i nomi concordati.
    codice = _template() + (BASE / "vista-3d" / "aggancio.js").read_text(encoding="utf-8")
    for evento in ('"municipio"', '"quartiere"', '"via"', '"ricerca-vuota"', '"servizio"', '"15-minuti"',
                   '"vista"', '"condividi"', '"dove-sono"', '"intro"', '"link-condiviso"'):
        assert ("traccia(" + evento) in codice or ("MAPPA_TRACCIA(" + evento) in codice, evento
    # mai l'hash o la query nell'URL inviato; Global Privacy Control spegne tutto
    assert "p.url = location.pathname;" in codice
    assert "navigator.globalPrivacyControl === true" in codice and 'stato = gpc ? "spento"' in codice
    # il 3D si conta a 3D aperta (in apri3d), non sul clic del tasto
    assert 'else if (daTasto && aperta) traccia("vista", { modo: "3D" })' in codice
    assert 'btn3d.addEventListener("click", function () { apri3d(null, true); });' in codice


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
