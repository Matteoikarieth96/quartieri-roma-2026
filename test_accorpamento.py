"""Test dell'accorpamento dei servizi (importa_servizi.accorpa_doppioni) sui casi
trovati nei controlli del 2026-10-29 e del 2026-10-31, e sul servizi.json scritto."""

import json

import pytest

from importa_servizi import OUT_PATH, accorpa_doppioni, distanza_metri


def punto(categoria, nome, lat, lon, *extra):
    return (categoria, nome, "QU.X.01", "X", lat, lon, tuple(extra))


def nomi(punti):
    return sorted(p[1] for p in punti)


def test_villa_fiorelli_un_parco_solo():
    out = accorpa_doppioni([
        punto("parchi_e_aree_gioco", "Parco di Villa Fiorelli", 41.88457, 12.52342),
        punto("parchi_e_aree_gioco", "Villa Fiorelli", 41.88483, 12.52309),
        punto("centri_anziani", "Villa Fiorelli", 41.8852, 12.52222),
    ])
    assert sorted((p[0], p[1]) for p in out) == [
        ("centri_anziani", "Villa Fiorelli"), ("parchi_e_aree_gioco", "Villa Fiorelli")]


@pytest.mark.parametrize("a, b, atteso", [
    ("Parco San Sebastiano", "Parco di San Sebastiano", "Parco San Sebastiano"),
    ("Parco Giancarlo Sbragia", "Parco Giancarlo Sbragia (Parco FAO)", "Parco Giancarlo Sbragia"),
    ("Villa Lazzaroni", "Villa Lazzaroni,Villa Lazzaroni", "Villa Lazzaroni"),
    ("Parco Falcone Borsellino", "Parco Falcone e Borsellino", "Parco Falcone Borsellino"),
])
def test_parchi_stesso_nome_base(a, b, atteso):
    out = accorpa_doppioni([punto("parchi_e_aree_gioco", a, 41.9, 12.5),
                            punto("parchi_e_aree_gioco", b, 41.9009, 12.5)])  # 100 m
    assert nomi(out) == [atteso]


def test_parco_grande_fino_a_300_metri():
    vicini = [punto("parchi_e_aree_gioco", "Parco Villa Gordiani", 41.9, 12.5),
              punto("parchi_e_aree_gioco", "Villa Gordiani", 41.9025, 12.5)]  # 278 m
    assert nomi(accorpa_doppioni(vicini)) == ["Villa Gordiani"]
    lontani = [punto("parchi_e_aree_gioco", "Parco delle Sabine", 41.9, 12.5),
               punto("parchi_e_aree_gioco", "Parco delle Sabine", 41.9, 12.51)]  # 830 m
    assert len(accorpa_doppioni(lontani)) == 2


def test_playground_senza_nome_restano():
    out = accorpa_doppioni([punto("parchi_e_aree_gioco", "playground", 41.9, 12.5),
                            punto("parchi_e_aree_gioco", "playground", 41.9015, 12.5)])
    assert len(out) == 2


def test_nome_contenuto_vicino_fuori_dalle_scuole():
    out = accorpa_doppioni([punto("sanita", "Apulia", 41.9, 12.5),
                            punto("sanita", "Poliambulatorio via Apulia", 41.90007, 12.5)])
    assert nomi(out) == ["Poliambulatorio via Apulia"]
    out = accorpa_doppioni([punto("sanita", "Casa Di Cura Salus Infirmorum", 41.9, 12.5),
                            punto("sanita", 'Casa di cura convenzionata "Salus Infirmorum"', 41.9, 12.5)])
    assert nomi(out) == ["Casa Di Cura Salus Infirmorum"]
    # oltre 60 m no
    lontani = [punto("parchi_e_aree_gioco", "Parco Tor Tre Teste - Via Davide Campari - Via dei Berio", 41.9, 12.5),
               punto("parchi_e_aree_gioco", "Parco Tor Tre Teste - Via dei Berio", 41.9012, 12.5)]
    assert len(accorpa_doppioni(lontani)) == 2


def test_nomi_che_differiscono_solo_per_un_numero():
    out = accorpa_doppioni([punto("sanita", "Poliambulatorio Boccea 265", 41.9, 12.5),
                            punto("sanita", "Poliambulatorio Boccea 625", 41.90003, 12.5)])
    assert nomi(out) == ["Poliambulatorio Boccea"]


def test_scuole_stesso_civico_fino_a_150_metri():
    out = accorpa_doppioni([
        punto("infanzia", "Andersen", 41.9, 12.5, "Via del Podere Trieste 20"),
        punto("infanzia", "Andersen - Comunale", 41.9008, 12.5, "Via del Podere Trieste 20"),
    ])
    assert len(out) == 1 and out[0][6][0] == "Via del Podere Trieste 20"


def test_plessi_lontani_e_civici_diversi_restano():
    out = accorpa_doppioni([
        punto("infanzia", "Salvo D'Acquisto", 41.9, 12.5, "Via Selinunte 3"),
        punto("infanzia", "Salvo D'Acquisto", 41.9016, 12.5, "Via Selinunte 33"),  # 178 m
        punto("impianti_sportivi", "I.C. Piazza De Cupis", 41.95, 12.5),
        punto("impianti_sportivi", "I.C piazza De Cupis", 41.9514, 12.5),  # 156 m
    ])
    assert len(out) == 4


def test_categorie_diverse_restano():
    out = accorpa_doppioni([
        punto("infanzia", "Mozart", 41.9, 12.5, "Viale di Castel Porziano 512"),
        punto("primaria", "Mozart", 41.9, 12.5, "Viale di Castel Porziano 512"),
    ])
    assert len(out) == 2


def test_farmacie_vicine_una_sola_e_la_comunale_vince():
    out = accorpa_doppioni([
        punto("farmacie", "Farmacia", 41.9, 12.5, "Via Pietro Gasparri 105"),
        punto("farmacie", "Farmacia comunale", 41.9, 12.5, "Via Pietro Gasparri 105"),
        punto("farmacie", "Farmacia", 41.9005, 12.5, "Via Ernesto Lugaro 4"),  # 55 m
    ])
    assert out == [punto("farmacie", "Farmacia comunale", 41.9, 12.5, "Via Pietro Gasparri 105")]
    lontane = [punto("farmacie", "Farmacia", 41.9, 12.5, "Via A 1"),
               punto("farmacie", "Farmacia", 41.9008, 12.5, "Via B 2")]  # 89 m
    assert len(accorpa_doppioni(lontane)) == 2


def _scritti():
    d = json.loads(OUT_PATH.read_text(encoding="utf-8"))
    return [(d["c"][r[0]], r[1], r[2], r[3], r[4], r[5], tuple(r[6:])) for r in d["p"]]


def test_servizi_scritti_gia_accorpati():
    punti = _scritti()
    assert len(accorpa_doppioni(punti)) == len(punti)


def test_servizi_scritti_villa_fiorelli_e_nomi_puliti():
    punti = _scritti()
    fiorelli = [(p[0], p[1]) for p in punti if "Fiorelli" in p[1] and p[0] != "nido"]
    assert sorted(fiorelli) == [("centri_anziani", "Villa Fiorelli"), ("parchi_e_aree_gioco", "Villa Fiorelli")]
    assert not [p for p in punti if p[0] != "farmacie" and p[1].count(",") and
                len({s.strip() for s in p[1].split(",")}) == 1]
    farmacie = [p for p in punti if p[0] == "farmacie"]
    assert all(distanza_metri(a[4], a[5], b[4], b[5]) > 60
               for i, a in enumerate(farmacie) for b in farmacie[i + 1:] if abs(a[4] - b[4]) < 0.001)
