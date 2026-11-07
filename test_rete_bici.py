"""Test della rete per la bici e delle piste ciclabili: quali vie OSM entrano e quali si
disegnano. Serve pyosmium: senza, il file si salta."""

import pytest

osmium = pytest.importorskip("osmium")

import prepara_rete_bici as bici  # noqa: E402


def test_pista_in_uso_dentro():
    assert bici.tipo_ciclabile({"highway": "cycleway"}) == 0
    assert bici.velocita({"highway": "cycleway"}) == 16.0


@pytest.mark.parametrize("tag", [
    {"construction": "yes"}, {"construction": "cycleway"}, {"proposed": "yes"},
    {"disused": "yes"}, {"abandoned": "yes"}, {"opening_date": "2999-01-01"},
])
def test_pista_non_realizzata_fuori(tag):
    t = dict({"highway": "cycleway"}, **tag)
    assert bici.tipo_ciclabile(t) is None
    assert bici.velocita(t) is None


def test_cantiere_e_progetto_fuori():
    for hw in ("construction", "proposed"):
        assert bici.tipo_ciclabile({"highway": hw, "construction": "cycleway"}) is None
        assert bici.velocita({"highway": hw}) is None


def test_apertura_passata_resta():
    assert bici.tipo_ciclabile({"highway": "cycleway", "opening_date": "2020-05-01"}) == 0


def test_corsia_bus_non_e_una_corsia_ciclabile():
    for v in ("share_busway", "shared_busway", "opposite_share_busway"):
        t = {"highway": "primary", "cycleway:right": v}
        assert bici.tipo_ciclabile(t) is None
        assert bici.velocita(t) == 15.0   # ma si pedala meglio


def test_corsia_ciclabile_tratteggiata():
    assert bici.tipo_ciclabile({"highway": "secondary", "cycleway:right": "lane"}) == 1
    assert bici.tipo_ciclabile({"highway": "secondary", "cycleway": "track"}) == 0


def test_ciclopedonale_chiuso_alle_auto_resta_pista():
    assert bici.tipo_ciclabile({"highway": "path", "access": "no", "bicycle": "designated"}) == 0
    assert bici.tipo_ciclabile({"highway": "path", "access": "no"}) is None


def test_extraurbana_principale_e_vehicle_no_fuori():
    assert bici.velocita({"highway": "primary", "motorroad": "yes"}) is None
    assert bici.velocita({"highway": "residential", "vehicle": "no"}) is None
    assert bici.velocita({"highway": "residential", "vehicle": "no", "bicycle": "yes"}) == 14.0
