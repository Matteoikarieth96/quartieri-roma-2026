/*
 * Vista 3D della mappa "Quartieri di Roma 2026" (MapLibre GL, vendorizzato in vendor/maplibre-gl/).
 *
 * Modulo a parte: il build lo copia in dist/3d/ e la mappa 2D lo scarica solo al primo
 * "3D". Non carica dati: riceve dalla 2D aree, municipi, registro delle categorie e
 * servizi gia' pronti (contratto in window.Vista3D.apri, sotto) e restituisce cosa si
 * sceglie. Niente layer di testo (servirebbero i glyph di un servizio esterno): nomi,
 * etichette delle aree e cartiglio (piccolo, solo a Roma e nel municipio: nell'area c'e' la
 * scheda della 2D) sono HTML sovrapposto; i numeri dei grappoli sono
 * immagini disegnate al volo.
 *
 *   Vista3D.supportato()          -> true se il browser ha WebGL
 *   Vista3D.apri(opt)             -> crea l'unica istanza di Map dentro opt.contenitore
 *     opt.contenitore             elemento vuoto, gia' visibile
 *     opt.aree, opt.municipi      FeatureCollection della 2D (aree gia' decodificate)
 *     opt.palette, opt.amaranto   colori dei municipi (stessa rampa della 2D) e del brand
 *     opt.romani                  { "8": "VIII", ... }
 *     opt.tipi                    { "QUARTIERE": "Quartiere", ... }
 *     opt.categorie               registro delle categorie dei servizi (SERVIZI_CATEGORIE: chiave,
 *                                 gruppo, etichetta, singolare...)
 *     opt.gruppi                  gruppi del registro, in ordine (SERVIZI_GRUPPI: chiave, etichetta)
 *     opt.attive                  { chiave: bool }, lo stesso oggetto della 2D (caselle)
 *     opt.icone                   { chiave: svg }, le icone illustrate della 2D (ICONE_SVG)
 *     opt.grappolo                (punti) -> html dentro il grappolo, quello della 2D (htmlGrappolo)
 *     opt.servizi()               Promise dei punti [{ props: {categoria, nome, codice_area,
 *                                 municipio}, latlng: {lat, lng} }] o null se non disponibili
 *     opt.tipiAttivi              { RIONE: bool, QUARTIERE: bool, "ZONA FUNZIONALE": bool }, i filtri
 *                                 per tipo della 2D (activeTipi); assente: tutti accesi
 *     opt.selezione               { tipo: "roma" } | { tipo: "municipio", arabo } | { tipo: "area", codice }
 *     opt.riduciMovimento         true: niente voli ne' crescite, si salta allo stato finale
 *     opt.mobile                  true su telefono (window.MAPPA_MQ_TELEFONO)
 *     opt.onSeleziona(sel)        ogni scelta fatta in 3D (tocco, vista d'insieme, municipio)
 *     opt.onArea(props|null)      a ogni ingresso in un'area (proprieta' della feature, per la
 *                                 scheda della 2D) e all'uscita dal livello area (null)
 *     opt.scheda()                l'elemento della scheda sopra la 3D (o null): a livello area
 *                                 la camera inquadra l'area nello spazio libero accanto (desktop)
 *                                 o sopra (telefono), e le etichette non le finiscono sotto
 *     opt.cartiglio()             telefono, a Roma e nel municipio: px occupati in basso dal cartiglio
 *                                 della 2D sopra la 3D (0 se non c'e'), la camera ci inquadra sopra
 *     opt.alto()                  facoltativa, telefono: px occupati in alto sopra la 3D (la card della
 *                                 guida), se piu' dei 96 della barra della ricerca
 *     opt.pannello()              px da lasciare liberi a destra per il pannello Servizi sopra la 3D
 *                                 (0 se non c'e'): a livello area su desktop la camera li evita
 *     opt.compattaPannello(si)    facoltativa: riduce (true) o ripristina (false) il pannello Servizi alla sola testata;
 *                                 true restituisce se ha cambiato qualcosa
 *     opt.onErrore(messaggio)     la 3D non puo' continuare (WebGL perso, Map non creata)
 *     opt.via                     facoltativa: la via aperta, come in Vista3D.via
 *     opt.ingresso                facoltativa, solo per Roma all'avvio: la 3D nasce sotto l'intro,
 *                                 piatta, sovrapposta al disegno e con lo stesso aspetto (fondo crema,
 *                                 il solo contorno di Roma), e aspetta il via; al via Roma si compone
 *                                 tessera per tessera ("il mosaico", vedi attendiIngresso).
 *                                 { disegno() -> { ovest, est, nord, sud, left, top, width } (il
 *                                   rettangolo del disegno nella finestra) o null (intro finita: la
 *                                   camera parte dall'inquadratura piatta di Roma),
 *                                   contorno() -> anelli del contorno di Roma in gradi
 *                                   [[[lon, lat], ...], ...] (gli stessi punti del tratto) o null,
 *                                   breve -> true alla seconda visita: mosaico compresso,
 *                                   pronta(allinea, parti, salta) -> la mappa e' disegnata nella posa
 *                                   del disegno; allinea() la rimette sul disegno (finestra cambiata),
 *                                   parti(breve) inclina la camera e fa cadere le tessere (breve ===
 *                                   true: versione breve, l'intro non c'e' piu'), salta() porta
 *                                   subito alla Roma di sempre, senza animazioni,
 *                                   conta(atterrate, totali) -> tessere a terra per tipo, cumulative
 *                                   ({ RIONE, QUARTIERE, "ZONA FUNZIONALE" }), al piu' una volta per
 *                                   fotogramma e solo quando cambiano,
 *                                   composta() -> l'ultima tessera e' a terra (la discesa verso la
 *                                   Roma di sempre e' gia' partita); una volta sola, mai dopo salta() }
 *   Vista3D.seleziona(sel)        vola a una selezione decisa fuori (elenco, municipio)
 *   Vista3D.filtraTipi(attivi)    i filtri per tipo cambiati nella 2D (stessa forma di opt.tipiAttivi)
 *   Vista3D.attiveCambiate()      le caselle del pannello Servizi della 2D sono cambiate: rilegge
 *                                 opt.attive e ridisegna i servizi (icone nell'area, numeri nel municipio)
 *   Vista3D.via(v)                la via aperta { nome, linee: [[[lon, lat], ...]] } (o null): si dipinge
 *                                 sul tetto delle tessere d'area che attraversa
 *   Vista3D.selezione()           selezione corrente
 *   Vista3D.chiudi()              distrugge la Map (una sola istanza alla volta)
 *   Vista3D.stato()               { aperta, pronta, livello, munK } (per i test)
 */
(function () {
  "use strict";

  // Servizi dentro un'area: gli stessi marcatori HTML della 2D (.servizio-marker con la
  // SVG illustrata, .servizio-cluster col numero, balzo), raggruppati con la stessa griglia
  // della 2D sulle coordinate del mondo, ciascuno alzato alla quota della tessera nel suo
  // punto (proiezione esatta, non una traslazione unica). Nella vista municipio i servizi
  // non sono punti: il numero sta nell'etichetta di ogni area.
  var SERVIZI_ICON_MIN = 28, SERVIZI_ICON_MAX = 36;
  var TILE_URL = (typeof window.MAPPA_TILE_URL === "string" && window.MAPPA_TILE_URL) || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  // Stile della 2D (template: stileBase, opacitaBase, preparaPattern, stileMaschera, TESSERA)
  var ZOOM_VICINO = 14;                                   // da vicino il colore si alleggerisce
  var OPAC = { area: 0.42, zf: 0.5, areaVicino: 0.26, zfVicino: 0.32 };
  // La base OSM sale con la tessera d'area: sul tetto (opaco) sta la carta dell'area,
  // le stesse tile ritagliate sul contorno, velata del colore del municipio come la
  // selezione della 2D (CARTA_VELO). Le pareti sono il contorno dell'area, estruso.
  var CARTA_VELO = 0.3;
  // il tetto sta questi px sopra la cima del blocco delle pareti (vedi strCarta)
  var TETTO_STACCO = 1.5;
  // la tessera d'area sale con la sua forma nelle tessere della sorgente; oltre questa attesa
  // (ms) si sale comunque, senza carta finche' le pareti non ci sono
  var ATTESA_FORMA = 6000;
  // e, se l'area e' ancora fuori dall'inquadratura, con la carta del tetto: senza, nei voli
  // lunghi il tetto arrivava a colore pieno e diventava carta di colpo a meta' salita. Le
  // tile arrivano dalla rete: oltre questa attesa (ms) si sale col tetto a colore pieno.
  var ATTESA_CARTA = 2000;
  var VELO = { colore: "#1C2024", opacita: 0.38 };
  var MASCHERA = { colore: "#ffffff", opacita: 0.58 };
  // Roma intera: ingresso dall'alto verso una vista inclinata.
  // Le aree si alzano per tipo (H_TIPO, in metri) staccate da una fuga di ~38 m, e la
  // camera vola dall'alto, piatta e col nord in alto, a una vista inclinata e ruotata
  // di 17 gradi. Municipio e area restano col nord in alto.
  var ROMA_BEARING = -17, ROMA_FUGA = 38, ROMA_DURATA = 1800;
  // Fondo della mappa e opacita' dei confini dei municipi, quelli di sempre
  var FONDO = "#EDE8E1", MUN_LINEA = 0.55;
  // Sotto l'intro base OSM, maschera e confini dei municipi non sono a 0 ma a VELATO (invisibile
  // sul crema): a opacita' 0 MapLibre non li disegna, e programmi e texture si preparavano tutti
  // al primo fotogramma della discesa (lo schermo restava fermo ~250 ms, misurato a 390 px).
  var VELATO = 0.003;
  // Ingresso dall'intro (opt.ingresso): la posa del disegno e' piu' lontana di quanto la 3D
  // permetta (zoom minimo, limiti del trascinamento): si sciolgono per l'ingresso e tornano a
  // Roma composta (sciogliIngresso).
  var INGRESSO = { zoomMin: 5 };
  // "Il mosaico", l'ingresso dall'intro (attendiIngresso, avviaMosaico). Sotto l'intro la 3D
  // ha l'aspetto del disegno: fondo `fondo` (il --bg della pagina), il contorno di Roma largo
  // `linea` px, nient'altro. Al via, dopo `attesa` ms (la dissolvenza dell'intro copre la
  // cucitura), la camera si inclina a `pitch` gradi e ruota a ROMA_BEARING (curvaSu: parte da
  // ferma), inquadrando Roma coi tetti alti `tetti` volte H_TIPO; si posa quando cade l'ultima
  // tessera, mai prima di `camera` ms. Le tessere aspettano parcheggiate sopra la camera (base
  // e cima a `parcheggio` metri: fuori dalla vista a ogni inclinazione) e partono nella finestra
  // del loro tipo (`tipi`, ms dal via: prima i rioni, poi i quartieri, poi le zone funzionali),
  // dal Campidoglio (`centro`) verso l'esterno, con uno scarto stabile di +-`scarto` ms per
  // tessera. Ognuna appare `px` px sopra il suo posto (`pxTel` su telefono, a 390 px di
  // larghezza; in mezzo, in proporzione fino a 600 px) gia' tinta per `tinta` dal `crema` al suo
  // colore (un fantasma che non si legge come nebbia), e' piena nel primo 35% della caduta
  // (`caduta` ms), accende l'impronta a terra nell'ultimo tratto e all'arrivo si assesta:
  // l'altezza scende di `schiaccia` e torna in `assesta` ms, mai sopra. I rioni cadono coi tetti
  // piu' alti (`tettiRioni`), per leggersi al centro; nella discesa tornano a 1x con gli altri.
  // `anticipo` ms prima dell'ultimo atterraggio parte la discesa (`discesa` ms): tetti a 1x,
  // camera di cameraRoma, base, maschera e confini che tornano, il contorno che si spegne.
  // `normale`: la prima visita (citta' composta a ~2,6 s dal via, camera a 40 gradi a ~1 s,
  // discesa di ~1,1 s); `breve`: la seconda visita (opt.ingresso.breve); `solo`: la 3D arrivata
  // a intro finita (parti(true)), nessuna dissolvenza da aspettare.
  var MOSAICO = {
    fondo: "#F9F6F4", crema: "#F9F6F4", linea: 2, pitch: 60, tetti: 3.5, tettiRioni: 5, parcheggio: 5e6, schiaccia: 0.06,
    tinta: 0.35, centro: [12.483, 41.893],
    // i rioni partono col via (la citta' si muove subito, mentre il disegno si dissolve), i
    // quartieri su una finestra lunga (meno tessere in aria insieme)
    normale: { attesa: 180, camera: 2100, caduta: 630, assesta: 270, px: 46, pxTel: 30, anticipo: 150, discesa: 1125, scarto: 33,
               tipi: { RIONE: [0, 300], QUARTIERE: [570, 1725], "ZONA FUNZIONALE": [1245, 1950] } },
    breve: { attesa: 120, camera: 700, caduta: 260, assesta: 120, px: 28, pxTel: 28, anticipo: 60, discesa: 450, scarto: 22,
             tipi: { RIONE: [0, 100], QUARTIERE: [180, 440], "ZONA FUNZIONALE": [380, 490] } },
    solo: { attesa: 40, camera: 700, caduta: 260, assesta: 120, px: 28, pxTel: 28, anticipo: 60, discesa: 450, scarto: 22,
            tipi: { RIONE: [70, 120], QUARTIERE: [100, 360], "ZONA FUNZIONALE": [300, 410] } }
  };
  var ZOOM_MIN = 8;
  function limiti(c) { return [[c.romaBox[0] - 0.6, c.romaBox[1] - 0.45], [c.romaBox[2] + 0.6, c.romaBox[3] + 0.45]]; }
  // A Roma si scelgono i municipi: sotto il mouse le aree del municipio si schiariscono di
  // questa frazione verso il crema (desktop)
  var EVIDENZA = 0.3;
  function pitchRoma() { return S.opt.mobile ? 48 : 52; }
  // Vista municipio: le aree si alzano con un'altezza per tipo (l'unico dato detto con
  // l'altezza). Valori relativi, moltiplicati per k (metri per unita'): k e' tarato su
  // MUN_PARETE px di altezza per il rione alla camera d'arrivo; con l'inclinazione la
  // parete a vista e' circa l'80%: ~52 px il rione, ~35 il quartiere, ~18 la zona
  // funzionale, piu' di 12 px fra un tipo e l'altro (misurato in test_vista_3d.py).
  var H_TIPO = { RIONE: 900, QUARTIERE: 600, "ZONA FUNZIONALE": 320 }, H_TIPO_MIN = 320, MUN_PARETE = 65;
  var MINUSCOLE = { di: 1, del: 1, della: 1, delle: 1, dei: 1, degli: 1, dello: 1, e: 1, a: 1, al: 1, alla: 1, alle: 1, ai: 1, da: 1, in: 1, la: 1, le: 1, lo: 1, il: 1, "de'": 1 };

  var S = null;        // stato dell'istanza aperta
  var cache = null;    // geometrie preparate (restano fra un'apertura e l'altra)

  // ---------- utilita' ----------
  function fold(s) { return String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, ""); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function titolo(s) {
    return String(s || "").toLowerCase().split(" ").map(function (w, i) {
      if (i > 0 && MINUSCOLE[w]) return w;
      return w.replace(/(^|['’\-.(])([a-zà-ÿ])/g, function (m, a, b) { return a + b.toUpperCase(); });
    }).join(" ");
  }
  function km2(s) {
    if (typeof s !== "number" || !(s > 0)) return "";
    var dec = s < 1 ? 2 : 1;
    return s.toLocaleString("it-IT", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + " km²";
  }
  function numero(n) { return n.toLocaleString("it-IT"); }
  // come scurisci della 2D: il contorno di un'area e' il suo colore scurito
  function scurisci(hex, f) {
    var n = parseInt(hex.slice(1), 16);
    return "rgb(" + Math.round(((n >> 16) & 255) * f) + "," + Math.round(((n >> 8) & 255) * f) + "," + Math.round((n & 255) * f) + ")";
  }
  // verso il crema del fondo di una frazione k (le tessere di Roma in rilievo)
  function schiarisci(hex, k) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    function m(c, t) { return Math.round(c + (t - c) * k); }
    return "rgb(" + m(r, 244) + "," + m(g, 240) + "," + m(b, 234) + ")";
  }
  function colore(m) { return S.opt.palette[(m - 1) % S.opt.palette.length] || "#9aa0a6"; }
  // Filtri per tipo della 2D (activeTipi): una copia, e una chiave per sapere se cambiano.
  function copiaTipi(a) { var o = {}; Object.keys(H_TIPO).forEach(function (t) { o[t] = !a || a[t] !== false; }); return o; }
  function chiaveTipi(t) { return Object.keys(H_TIPO).map(function (k) { return t[k] ? 1 : 0; }).join(""); }
  function tipoAttivo(k) { var e = cache.byCode[k]; return !!e && S.tipi[e.p.tipo] !== false; }

  function poligoni(g) { return g.type === "Polygon" ? [g.coordinates] : (g.type === "MultiPolygon" ? g.coordinates : []); }
  function bbox(g, b) {
    b = b || [180, 90, -180, -90];
    poligoni(g).forEach(function (pol) { pol[0].forEach(function (p) {
      if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1];
      if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1];
    }); });
    return b;
  }
  // Il mondo con dei buchi: gli anelli esterni di `g` (come creaVelo e la maschera della
  // 2D; un buco interno all'area resta coperto, limite noto della 2D).
  var MONDO = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  function mondoBucato(geometrie) {
    var anelli = [MONDO];
    geometrie.forEach(function (g) { poligoni(g).forEach(function (pol) { anelli.push(pol[0]); }); });
    return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: anelli } }] };
  }
  // Ogni poligono si stringe verso il proprio baricentro di circa `metri`: la fuga fra
  // le tessere di Roma in rilievo (qui la forma esatta non conta, il bordo si').
  function stringi(g, metri) {
    return { type: "MultiPolygon", coordinates: poligoni(g).map(function (pol) {
      var o = pol[0], cx = 0, cy = 0;
      o.forEach(function (p) { cx += p[0]; cy += p[1]; }); cx /= o.length; cy /= o.length;
      var b = bbox({ type: "Polygon", coordinates: [o] });
      var raggio = Math.max((b[2] - b[0]) * 111320 * Math.cos(cy * Math.PI / 180), (b[3] - b[1]) * 110540) / 2 || 1;
      var k = Math.max(0.86, 1 - metri / raggio);
      return pol.map(function (r) { return r.map(function (p) { return [cx + (p[0] - cx) * k, cy + (p[1] - cy) * k]; }); });
    }) };
  }
  function esagono(lon, lat, r) {
    var dLat = r / 110540, dLon = r / (111320 * Math.cos(lat * Math.PI / 180)), anello = [];
    for (var i = 0; i <= 6; i++) { var a = Math.PI / 3 * (i % 6) + Math.PI / 6; anello.push([lon + Math.cos(a) * dLon, lat + Math.sin(a) * dLat]); }
    return [anello];
  }
  // Bordo di larghezza costante attorno al contorno (anche sulle forme concave): un
  // rettangolo per lato, centrato sul lato, piu' un esagono su ogni vertice per chiudere
  // i giunti. E' l'inviluppo del contorno a distanza w/2, senza offset di poligoni:
  // i pezzi si sovrappongono, ma hanno stesso colore e stessa quota.
  function bordo(g, w) {
    var pezzi = [], lat0 = (bbox(g)[1] + bbox(g)[3]) / 2;
    var mx = 111320 * Math.cos(lat0 * Math.PI / 180), my = 110540, h = w / 2;
    poligoni(g).forEach(function (pol) { pol.forEach(function (r) {
      for (var i = 0; i < r.length - 1; i++) {
        var a = r[i], b = r[i + 1];
        var dx = (b[0] - a[0]) * mx, dy = (b[1] - a[1]) * my, L = Math.sqrt(dx * dx + dy * dy);
        if (L < 0.5) continue;
        var nx = -dy / L * h / mx, ny = dx / L * h / my;
        pezzi.push([[[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny], [a[0] + nx, a[1] + ny]]]);
        pezzi.push(esagono(a[0], a[1], h * 1.04));
      }
    }); });
    return { type: "MultiPolygon", coordinates: pezzi };
  }

  function prepara(opt) {
    if (cache && cache.aree === opt.aree) return cache;
    var c = { aree: opt.aree, byCode: {}, perMun: {}, romaBox: null, kmqRoma: 0, munBox: {}, munGeo: {}, tessere: null, municipi: null, maschera: null };
    var feats = [];
    opt.aree.features.forEach(function (f) {
      var p = f.properties || {};
      if (!p.codice || !f.geometry) return;
      var m = parseInt(p.municipio_num_arabo, 10) || 0;
      c.byCode[p.codice] = { p: p, g: f.geometry, m: m, box: bbox(f.geometry) };
      (c.perMun[m] = c.perMun[m] || []).push(p.codice);
      c.romaBox = bbox(f.geometry, c.romaBox);
      c.kmqRoma += p.superficie_kmq || 0;
      // la forma vera, senza fughe: la citta' e' piatta e disegnata come la 2D
      feats.push({ type: "Feature", properties: { codice: p.codice, m: m, zf: p.tipo === "ZONA FUNZIONALE" }, geometry: f.geometry });
    });
    c.tessere = { type: "FeatureCollection", features: feats };
    c.municipi = { type: "FeatureCollection", features: opt.municipi.features.map(function (f) {
      var m = parseInt(f.properties.municipio, 10);
      c.munBox[m] = bbox(f.geometry); c.munGeo[m] = f.geometry;
      return { type: "Feature", properties: { m: m }, geometry: f.geometry };
    }) };
    // Roma in rilievo (solo a livello Roma): ogni area stretta verso il proprio baricentro
    // (la fuga fra le tessere), alta per tipo, del colore del municipio appena schiarito di
    // un tono stabile per area (dal codice: niente casualita' fra un'apertura e l'altra).
    c.roma = { type: "FeatureCollection", features: feats.map(function (f) {
      var e = c.byCode[f.properties.codice], cod = f.properties.codice, hsh = 0;
      for (var i = 0; i < cod.length; i++) hsh = (hsh * 31 + cod.charCodeAt(i)) % 997;
      var base = opt.palette[(e.m - 1) % opt.palette.length] || "#9aa0a6", tono = 0.7 * (hsh % 7) / 20 * 0.6;
      // colHov: lo stesso tono un po' piu' chiaro, per il municipio sotto il mouse
      return { type: "Feature", properties: { codice: cod, m: e.m, col: schiarisci(base, tono), colHov: schiarisci(base, tono + EVIDENZA) }, geometry: stringi(e.g, ROMA_FUGA) };
    }) };
    // Roma intera (i contorni dei municipi), per inquadrarla tutta sopra il cartiglio
    c.romaGeo = { type: "MultiPolygon", coordinates: [].concat.apply([], opt.municipi.features.map(function (f) { return f.geometry ? poligoni(f.geometry) : []; })) };
    // maschera fuori Roma: il mondo bucato dai municipi (costruisciMaschera della 2D)
    c.maschera = mondoBucato(opt.municipi.features.map(function (f) { return f.geometry; }).filter(Boolean));
    cache = c;
    return c;
  }

  // Registro della 2D: categoria -> voce, gruppi in ordine (letti a ogni apertura).
  function registro(opt) {
    var r = { cat: {}, gruppi: (opt.gruppi || []).slice() };
    (opt.categorie || []).forEach(function (c) { r.cat[c.chiave] = c; });
    return r;
  }
  function gruppoDi(chiave) { var c = S.reg.cat[chiave]; return c ? c.gruppo : ""; }
  function singolare(chiave) { var c = S.reg.cat[chiave]; return c ? (c.singolare || c.etichetta) : chiave; }
  function categorieDelGruppo(g) {
    return Object.keys(S.reg.cat).filter(function (k) { return S.reg.cat[k].gruppo === g; });
  }

  // Un punto dentro l'area (per l'etichetta nella vista municipio): il baricentro dei
  // vertici del poligono piu' grande, o il punto interno piu' vicino.
  function dentroAnello(x, y, r) {
    var d = false;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      var xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) d = !d;
    }
    return d;
  }
  function dentro(pol, x, y) {
    if (!dentroAnello(x, y, pol[0])) return false;
    for (var k = 1; k < pol.length; k++) if (dentroAnello(x, y, pol[k])) return false;
    return true;
  }
  function puntoInterno(g) {
    var pol = poligoni(g).map(function (p) { var b = bbox({ type: "Polygon", coordinates: p }); return { p: p, a: (b[2] - b[0]) * (b[3] - b[1]), b: b }; })
      .sort(function (a, b) { return b.a - a.a; })[0];
    if (!pol) return null;
    var o = pol.p[0], cx = 0, cy = 0;
    o.forEach(function (q) { cx += q[0]; cy += q[1]; }); cx /= o.length; cy /= o.length;
    if (dentro(pol.p, cx, cy)) return [cx, cy];
    var best = null, bd = Infinity, b = pol.b;
    for (var i = 1; i < 12; i++) for (var j = 1; j < 12; j++) {
      var x = b[0] + (b[2] - b[0]) * i / 12, y = b[1] + (b[3] - b[1]) * j / 12;
      var d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d < bd && dentro(pol.p, x, y)) { bd = d; best = [x, y]; }
    }
    return best || [cx, cy];
  }

  // ---------- animazione ----------
  function ease(t) { var v = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; return Math.min(1, Math.max(0, v)); }
  function easeBack(t) { var c1 = 1.15, c3 = c1 + 1; return Math.max(0, 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)); }
  // Il mosaico: la camera parte da ferma (velocita' 0, nessuno scatto), e' al massimo a un
  // sesto della durata e si posa piano: 1 - (1 - t)^5 (1 + 5t), derivata 30 t (1 - t)^4.
  function curvaSu(t) { t = Math.min(1, Math.max(0, t)); return 1 - Math.pow(1 - t, 5) * (1 + 5 * t); }
  // la discesa: sinusoidale, da ferma a ferma
  function curvaSeno(t) { t = Math.min(1, Math.max(0, t)); return (1 - Math.cos(Math.PI * t)) / 2; }
  function tween(chiave, durata, passo, fine, curva) {
    if (S.tween[chiave]) cancelAnimationFrame(S.tween[chiave]);
    S.tween[chiave] = null;
    if (S.opt.riduciMovimento || durata <= 0) { passo(1); if (fine) fine(); return; }
    var t0 = performance.now(), mio = S;
    (function frame(ora) {
      if (S !== mio) return;
      var t = Math.max(0, Math.min(1, (ora - t0) / durata));   // il timestamp di rAF puo' precedere t0
      passo((curva || ease)(t));
      if (t < 1) S.tween[chiave] = requestAnimationFrame(frame);
      else { S.tween[chiave] = null; if (fine) fine(); }
    })(t0);
  }
  // Ritardo sullo stesso orologio dei fotogrammi (requestAnimationFrame + performance.now),
  // non su setTimeout: tessere, camera e ritardi restano allineati anche se il dispositivo
  // perde fotogrammi.
  function dopo(ms, fn) {
    var gen = S.gen, mio = S, fino = performance.now() + (S.opt.riduciMovimento ? 0 : ms);
    if (ms <= 0 || S.opt.riduciMovimento) { fn(); return; }
    (function giro() {
      if (S !== mio || S.gen !== gen) return;
      if (performance.now() >= fino) fn(); else requestAnimationFrame(giro);
    })();
  }

  // Visibilita' delle aree (feature-state `v`, 0..1): moltiplica l'opacita' di
  // riempimento, retino e contorno. Le espressioni si scrivono una volta sola: un'opacita'
  // che legge lo stato della feature e' "data-driven", e MapLibre a ogni setPaintProperty
  // rifa' tutte le tessere della sorgente. Scritta a ogni fotogramma (prima si cambiava qui
  // il fattore t) ricaricava le aree per tutto il passaggio: il worker restava indietro e
  // nei voli lunghi pareti della tessera, aree e maschera sparivano a pezzi.
  // Ogni passaggio e' una sola interpolazione continua: per ogni area si scrivono una volta
  // il valore di partenza (`vis0`, quello visibile in quel momento, anche a meta' di un
  // passaggio) e quello d'arrivo (`vis`); a ogni fotogramma cambia solo `v` delle aree che
  // si muovono. Mai filtri, mai sorgenti ricaricate: era questo lo sfarfallio fra una zona e l'altra.
  function espressioni() {
    var v = ["coalesce", ["feature-state", "v"], 0];
    // come opacitaBase della 2D: sopra lo zoom 14 il colore si alleggerisce
    var opac = function (lontano, vicino) { return ["step", ["zoom"], ["*", v, lontano], ZOOM_VICINO, ["*", v, vicino]]; };
    S.map.setPaintProperty("aree-fill", "fill-opacity", opac(OPAC.area, OPAC.areaVicino));
    S.map.setPaintProperty("aree-retino", "fill-opacity", opac(OPAC.zf, OPAC.zfVicino));
    S.map.setPaintProperty("aree-linea", "line-opacity", ["*", v, 0.7]);
  }
  // mappa = { codice: 0|1 } (le aree assenti vanno a 0)
  function visibilita(mappa, durata, fine) {
    var t = S.t, moto = [];
    Object.keys(cache.byCode).forEach(function (k) {
      var st = S.st[k] || { vis0: 0, vis: 0 };
      var n = { vis0: st.vis0 + (st.vis - st.vis0) * t, vis: mappa[k] ? 1 : 0 };
      if (n.vis0 !== n.vis) moto.push(k);
      if (n.vis0 === st.vis0 && n.vis === st.vis) return;
      S.st[k] = n;
      S.map.setFeatureState({ source: "aree", id: k }, { vis0: n.vis0, vis: n.vis, v: n.vis0 });
    });
    if (S.tween.aree) { cancelAnimationFrame(S.tween.aree); S.tween.aree = null; }
    // Niente da muovere: ogni area e' gia' ferma dove deve stare (anche a meta' di un
    // passaggio). Si chiude l'eventuale passaggio in corso (la sua fine apparteneva alla
    // selezione di prima) e si risponde subito.
    if (!moto.length) {
      S.t = 1;
      if (fine) fine();
      return;
    }
    S.t = 0;
    tween("aree", durata == null ? 900 : durata, function (q) {
      S.t = q;
      moto.forEach(function (k) { var st = S.st[k]; S.map.setFeatureState({ source: "aree", id: k }, { v: st.vis0 + (st.vis - st.vis0) * q }); });
    }, fine);
  }

  // Velo della 2D (TESSERA.velo*): il fuori si scurisce, il buco e' la sagoma di cio'
  // che si guarda. A terra sopra le aree, sotto le estrusioni (strVelo, senza tessere).
  // La sagoma di uno strato cambia solo a strato spento (sotto un velo visibile il buco
  // salterebbe da una forma all'altra). Fra due sagome si passa con una dissolvenza
  // incrociata: "velo-vecchio" tiene la sagoma corrente a opacita' 0, prende il posto del
  // velo e scende mentre il velo risale col buco nuovo.
  function opacita(id) { return S.veloOp[id] || 0; }
  function veloOp(id, v) { S.veloOp[id] = v; S.map.triggerRepaint(); }
  function veloA(b, durata) {
    var a = opacita("velo");
    tween("velo", durata == null ? 900 : durata, function (k) { veloOp("velo", a + (b - a) * k); });
  }
  function bucoIn(id, g) {
    if (opacita(id) > 0.01) S.veloSalti++;            // per i test: mai sotto un velo visibile
    S.veloG[id] = g || null;
    if (id === "velo") S.veloBuco = g; else S.vecchioBuco = g;
    S.map.triggerRepaint();
  }
  // a velo vecchio spento, la sagoma corrente pronta per la prossima dissolvenza
  function preparaVecchio() {
    if (S.vecchioBuco !== S.veloBuco && opacita("velo-vecchio") <= 0.01 && !S.tween.vecchio) bucoIn("velo-vecchio", S.veloBuco);
  }
  function veloSu(g, durata) {
    var d = durata == null ? 900 : durata, a = opacita("velo");
    if (g === S.veloBuco) { veloA(VELO.opacita, d); return; }
    if (a <= 0.01) {
      if (S.tween.velo) { cancelAnimationFrame(S.tween.velo); S.tween.velo = null; }
      veloOp("velo", 0);
      bucoIn("velo", g); preparaVecchio();
      veloA(VELO.opacita, d);
      return;
    }
    if (S.vecchioBuco === S.veloBuco && opacita("velo-vecchio") <= 0.01 && !S.tween.vecchio) {
      // nello stesso fotogramma il vecchio (stessa sagoma) sostituisce il
      // velo, che a opacita' 0 cambia sagoma e poi risale
      if (S.tween.velo) { cancelAnimationFrame(S.tween.velo); S.tween.velo = null; }
      veloOp("velo-vecchio", a);
      veloOp("velo", 0);
      bucoIn("velo", g);
      // Fuori da entrambi i buchi i due strati si sommano: 1 - (1 - v)(1 - w). Il vecchio
      // segue la curva del velo (stessa durata, stessa ease, stesso fotogramma di partenza)
      // in modo che la somma vada da a a VELO.opacita senza avvallamento (con w = a(1 - k)
      // scendeva al 34% a meta').
      tween("vecchio", d, function (k) {
        var v = VELO.opacita * k, T = a + (VELO.opacita - a) * k;
        veloOp("velo-vecchio", Math.max(0, 1 - (1 - T) / (1 - v)));
      }, preparaVecchio);
      veloA(VELO.opacita, d);
      return;
    }
    // ripiego (una scelta nuova a meta' dissolvenza): il velo scende, cambia sagoma a
    // velo spento e risale
    tween("velo", Math.max(120, 350 * a / VELO.opacita), function (k) { veloOp("velo", a * (1 - k)); }, function () {
      bucoIn("velo", g); preparaVecchio();
      veloA(VELO.opacita, d);
    });
  }
  function veloGiu(durata) { veloA(0, durata); }

  // ---------- camera ----------
  // A Roma e nel municipio in basso c'e' il cartiglio piccolo (CARTIGLIO_SPAZIO px col suo
  // margine). Nell'area c'e' la scheda della 2D: su telefono chiusa in basso (la sua altezza
  // piu' 16 px), su desktop in basso a sinistra (l'area si inquadra alla sua destra).
  var CARTIGLIO_SPAZIO = { tel: 104, desk: 130 }, SPAZIO_MIN = 120;
  function schedaSopra() {
    var el = S.livello === "area" && S.opt.scheda ? S.opt.scheda() : null;
    return el && el.offsetHeight ? el : null;
  }
  function padding() {
    var sch = schedaSopra();
    if (S.opt.mobile) return { top: Math.max(96, (S.opt.alto && S.opt.alto()) || 0), bottom: sch ? sch.offsetHeight + 16 : Math.max(CARTIGLIO_SPAZIO.tel, (S.opt.cartiglio && S.opt.cartiglio()) || 0), left: 22, right: 22 };
    if (sch) {
      // La tessera nello spazio libero fra la scheda (a sinistra) e il pannello Servizi (in
      // alto a destra). Nelle finestre strette (tablet, telefono in orizzontale) li' non resta
      // spazio (era negativo: lo zoom diventava NaN e la 3D non arrivava mai): si prova sopra
      // la scheda, poi sotto il pannello, sempre evitandolo. Il primo spazio di almeno SPAZIO_MIN px per
      // lato, altrimenti il piu' grande.
      var W = S.el.clientWidth, H = S.el.clientHeight, b = S.el.getBoundingClientRect(), r = sch.getBoundingClientRect();
      var accanto = Math.max(70, r.right - b.left + 24), sopra = Math.max(70, b.bottom - r.top + 16);
      var larg = function (p) { return W - p.left - p.right; }, alt = function (p) { return H - p.top - p.bottom; };
      var area = function (p) { return Math.max(0, larg(p)) * Math.max(0, alt(p)); };
      var scegli = function () {
        var pan = S.opt.pannello ? S.opt.pannello() || 0 : 0;
        var rp = Math.max(24, pan + 24);
        // fondo del pannello (px dal bordo alto della mappa): sotto di esso c'e' una fascia libera
        var fp = pan && S.opt.pannelloFondo ? S.opt.pannelloFondo() || 0 : 0;
        var prove = [
          { top: 70, bottom: 70, left: accanto, right: Math.max(70, pan + 24) },
          { top: 70, bottom: sopra, left: 24, right: Math.max(24, pan + 24) },
          { top: 24, bottom: 24, left: accanto, right: rp },
          { top: 24, bottom: sopra, left: 24, right: rp }
        ];
        if (fp) {
          prove.push({ top: fp + 16, bottom: 24, left: accanto, right: 24 });
          prove.push({ top: fp + 16, bottom: sopra, left: 24, right: 24 });
        }
        var buona = prove.filter(function (p) { return larg(p) >= SPAZIO_MIN && alt(p) >= SPAZIO_MIN; })[0];
        if (buona) return { p: buona, ok: true, pan: pan };
        // ripiego: accanto alla scheda e al pannello, margini minimi
        var ultima = { top: 24, bottom: 24, left: r.right - b.left + 10, right: pan + 10 };
        prove.push(ultima);
        return { p: prove.slice().sort(function (p, q) { return area(q) - area(p); })[0], ok: false, pan: pan };
      };
      // Prima col pannello Servizi come l'ha lasciato la persona; se la tessera non ha
      // SPAZIO_MIN px liberi, il pannello si riduce alla sola testata (libera la colonna) e si
      // riprova. A ogni nuova camera si parte di nuovo dal pannello com'era.
      if (S.opt.compattaPannello) S.opt.compattaPannello(false);
      var ris = scegli();
      if (!ris.ok && ris.pan && S.opt.compattaPannello && S.opt.compattaPannello(true)) {
        var ris2 = scegli();
        if (ris2.ok) ris = ris2; else S.opt.compattaPannello(false);
      }
      var scelta = ris.p;
      // mai un padding piu' grande dell'area: MapLibre non saprebbe inquadrare
      scelta = Object.assign({}, scelta);
      var resto = function (tot, x, y) {
        var max = Math.max(0, tot - 40);
        if (x + y > max) { var k = max / (x + y || 1); return [Math.floor(x * k), Math.floor(y * k)]; }
        return [x, y];
      };
      var v = resto(W, scelta.left, scelta.right), h = resto(H, scelta.top, scelta.bottom);
      scelta.left = v[0]; scelta.right = v[1]; scelta.top = h[0]; scelta.bottom = h[1];
      return scelta;
    }
    return { top: 70, bottom: CARTIGLIO_SPAZIO.desk, left: 70, right: 70 };
  }
  // Nord in alto, come la 2D, nel municipio e nell'area (bearing 0); Roma intera ruotata (ROMA_BEARING).
  function vola(opt) {
    S.camArrivo = opt;
    if (S.opt.riduciMovimento) S.map.jumpTo(opt);
    else S.map.flyTo(Object.assign({ duration: 2500, curve: 1.42, essential: true }, opt));
    return opt.zoom;
  }
  // Inclinazioni (nord sempre in alto): l'area un po' piu' inclinata del municipio, cosi'
  // la tessera che si alza si vede; su telefono 2 gradi in meno.
  function pitchFocus() { return S.opt.mobile ? 44 : 46; }
  function pitchMunicipio() { return pitchFocus() - 4; }
  // Metri per pixel allo zoom z di MapLibre: il mondo e' largo 512 * 2^z px (tessere da
  // 512), quindi 40075016,686 / 512 = 78271,517 m/px allo zoom 0 sull'equatore.
  function mppA(lat, z) { return 78271.517 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z); }
  // Altezza della tessera d'area allo zoom z: AREA_PARETE px di parete a vista al centro
  // dell'area, all'inclinazione dell'area (la parete a schermo e' circa altezza / mpp *
  // sin(inclinazione)). Misurata in test_vista_3d.py (batteria_area: fra 40 e 80 px).
  var AREA_PARETE = 60;
  function altezzaArea(e, z) {
    var mpp = mppA((e.box[1] + e.box[3]) / 2, z);
    return Math.max(6, Math.min(900, mpp * AREA_PARETE / Math.sin(pitchFocus() * Math.PI / 180)));
  }
  // cameraForBounds non conosce l'inclinazione (la parte vicina si allarga,
  // quella lontana si stringe) ne' i tetti alzati. Si cerca la camera d'arrivo proiettando
  // il contorno vero (a terra e, se `quota(z)` da' metri, anche sul tetto) su una copia
  // della camera: tutto dentro lo schermo, sopra il cartiglio o la scheda, con `alto` px liberi sopra.
  // `bearing` (facoltativo, 0 di norma) solo per Roma intera.
  function inquadra(geo, box, pitch, maxZoom, alto, quota, durata, bearing) {
    var arrivo = arrivoCamera(geo, box, pitch, maxZoom, alto, quota, bearing);
    if (durata) arrivo.duration = durata;
    return vola(arrivo);
  }
  // La camera d'arrivo di inquadra, senza volarci ({ center, zoom, bearing, pitch }).
  // zoomMin (facoltativo): lo zoom minimo del calcolo, se la mappa ora ne ha un altro.
  function arrivoCamera(geo, box, pitch, maxZoom, alto, quota, bearing, zoomMin) {
    var pad = padding(), tr = S.map.transform.clone();
    // durante l'ingresso dall'intro la mappa e' senza limiti: l'arrivo si calcola con quelli di sempre
    if (S.ingresso) tr.setMaxBounds(maplibregl.LngLatBounds.convert(limiti(cache)));
    if (zoomMin != null) tr.minZoom = zoomMin;
    var pts = [];
    poligoni(geo).forEach(function (pol) {
      var r = pol[0], passo = Math.max(1, Math.floor(r.length / 160));
      for (var i = 0; i < r.length; i += passo) pts.push(new maplibregl.LngLat(r[i][0], r[i][1]));
    });
    var mcs = quota ? pts.map(function (ll) { return maplibregl.MercatorCoordinate.fromLngLat(ll); }) : null;
    // su telefono si stringono i margini
    var L = S.opt.mobile ? 14 : pad.left, R = tr.width - (S.opt.mobile ? 14 : pad.right), T = pad.top + alto, B = tr.height - pad.bottom - 10;
    S.dimInquadra = tr.width + "x" + tr.height;
    var rot = bearing || 0;
    var cam = S.map.cameraForBounds([[box[0], box[1]], [box[2], box[3]]], { padding: pad, bearing: rot }) || {};
    var centro = maplibregl.LngLat.convert(cam.center || [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]), z = cam.zoom || 11;
    tr.bearing = rot; tr.pitch = pitch;
    var misura = function () {
      tr.center = centro; tr.zoom = z;
      var b = [Infinity, Infinity, -Infinity, -Infinity], h = quota ? quota(z) : 0;
      var su = function (q) { b[0] = Math.min(b[0], q.x); b[1] = Math.min(b[1], q.y); b[2] = Math.max(b[2], q.x); b[3] = Math.max(b[3], q.y); };
      pts.forEach(function (ll) { su(tr.locationPoint(ll)); });
      if (h) mcs.forEach(function (mc) { su(tr.coordinatePoint(mc, h)); });
      return b;
    };
    // il centro del contorno a schermo va al centro dello spazio libero
    var centra = function () {
      var b = misura(), dx = (b[0] + b[2]) / 2 - (L + R) / 2, dy = (b[1] + b[3]) / 2 - (T + B) / 2;
      centro = tr.pointLocation(new maplibregl.Point(tr.width / 2 + dx, tr.height / 2 + dy));
    };
    for (var i = 0; i < 10; i++) {
      var b = misura(), sc = Math.min((R - L) / (b[2] - b[0]), (B - T) / (b[3] - b[1]));
      if (!(sc > 0 && isFinite(sc))) break;               // niente spazio: resta lo zoom di cameraForBounds
      z = Math.min(maxZoom, z + Math.log(sc) / Math.LN2 * 0.9);
      centra();
    }
    // Ultimi ritocchi, ricentrando a ogni passo: lo spazio libero non contiene sempre il
    // centro dello schermo, e allontanandosi attorno a quello il contorno ne usciva (su un
    // tablet lo zoom scendeva di 1,5 livelli, la tessera restava minuscola).
    for (var j = 0; j < 30; j++) {
      var f = misura();
      if (f[0] >= L - 1 && f[2] <= R + 1 && f[1] >= T - 1 && f[3] <= B + 1) break;
      z -= 0.05;
      centra();
    }
    return { center: [centro.lng, centro.lat], zoom: z, bearing: rot, pitch: pitch };
  }
  // Finestra cambiata (telefono ruotato, finestra ridimensionata): la camera reinquadra la
  // selezione corrente, senza rifare il passaggio; a passaggio in corso aspetta che finisca
  // (una selezione nuova cancella l'attesa e inquadra da se').
  function riquadra() {
    if (!S || !S.sel) return;
    if (!S.pronta || S.map.isMoving()) { S.timer.push(setTimeout(riquadra, 300)); return; }
    var sel = S.sel, c = cache;
    // la soglia del telefono della 2D (suMobile): ruotato, il telefono puo' passarla
    S.opt.mobile = window.matchMedia(window.MAPPA_MQ_TELEFONO || "(max-width: 720px)").matches;
    if (sel.tipo === "roma") cameraRoma(600);
    else if (sel.tipo === "municipio") inquadra(c.munGeo[sel.arabo], c.munBox[sel.arabo], pitchMunicipio(), 14, MUN_PARETE, null, 600);
    else { var e = c.byCode[sel.codice]; inquadra(e.g, e.box, pitchFocus(), 16.2, 12, function (zz) { return altezzaArea(e, zz); }, 600); }
  }
  // Roma intera come l'ingresso di prima: inclinata e ruotata, tutta nello schermo sopra
  // il cartiglio, tetti compresi (le tessere piu' alte, i rioni).
  function cameraRoma(durata) {
    return inquadra(cache.romaGeo, cache.romaBox, pitchRoma(), 12, 0, function () { return H_TIPO.RIONE; }, durata, ROMA_BEARING);
  }
  // La stessa camera senza volarci (il mosaico ci arriva con la sua discesa), calcolata con lo
  // zoom minimo di sempre anche durante l'ingresso: e' l'arrivo che darebbe cameraRoma.
  function arrivoRoma() {
    return arrivoCamera(cache.romaGeo, cache.romaBox, pitchRoma(), 12, 0, function () { return H_TIPO.RIONE; }, ROMA_BEARING, ZOOM_MIN);
  }
  // Municipio: tutto il contorno, con lo spazio per le pareti in alto.
  function cameraMunicipio(m, pitch, maxZoom) { return inquadra(cache.munGeo[m], cache.munBox[m], pitch, maxZoom, MUN_PARETE); }

  // ---------- mappa ----------
  function creaMappa(el, c) {
    // Su Chrome MapLibre usa un solo worker (Safari fino a 3): le otto sorgenti GeoJSON
    // stavano in coda una dietro l'altra, e a ogni livello di zoom attraversato da un volo
    // lungo le loro tessere arrivavano con 0,3-0,6 s di ritardo (aree a rettangoli, tetto
    // senza pareti). Conta solo prima della prima mappa della pagina.
    var nw = Math.min(3, Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 2)));
    if (maplibregl.getWorkerCount && maplibregl.setWorkerCount && maplibregl.getWorkerCount() < nw) maplibregl.setWorkerCount(nw);
    var map = new maplibregl.Map({
      container: el,
      style: {
        version: 8,
        // Niente transizioni di stile (MapLibre ne mette 300 ms a ogni setPaintProperty): ogni
        // passaggio e' gia' animato qui, fotogramma per fotogramma. Con la transizione lo
        // scambio fra velo e velo vecchio arrivava in ritardo mentre il buco nuovo era gia'
        // disegnato: la destinazione restava scoperta per un fotogramma o due.
        transition: { duration: 0, delay: 0 },
        sources: {
          osm: { type: "raster", tiles: [TILE_URL], tileSize: 256, maxzoom: 19,
                 // su telefono il testo corto della 2D; le fonti complete sono in "Cos'e'"
                 attribution: (S.opt.mobile ? "Progetto indipendente · Dati: Roma Capitale · © " : "Progetto indipendente · Dati: Roma Capitale, GeoRoma e altre fonti · © ") +
                   "<a href=\"https://www.openstreetmap.org/copyright\" target=\"_blank\" rel=\"noopener\">" + (S.opt.mobile ? "OpenStreetMap</a>" : "OpenStreetMap contributors</a>") }
        },
        layers: [
          // sotto l'intro (mosaico) il fondo crema della pagina e la base velata (VELATO): le
          // tile arrivano e si disegnano gia', pronte per la discesa
          { id: "fondo", type: "background", paint: { "background-color": S.ingresso ? MOSAICO.fondo : FONDO } },
          { id: "osm", type: "raster", source: "osm",
            // a colori come la 2D
            paint: { "raster-saturation": 0, "raster-contrast": 0, "raster-opacity": S.ingresso ? VELATO : 1, "raster-fade-duration": 150 } }
        ]
      },
      bounds: [[c.romaBox[0], c.romaBox[1]], [c.romaBox[2], c.romaBox[3]]],
      fitBoundsOptions: { padding: 20 },
      minZoom: S.ingresso ? INGRESSO.zoomMin : ZOOM_MIN, maxZoom: 18, maxPitch: 70,
      maxBounds: S.ingresso ? null : limiti(c),
      bearing: 0, dragRotate: false, pitchWithRotate: false, touchPitch: false,
      attributionControl: false,
      antialias: !S.opt.mobile,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      fadeDuration: 0,
      // etichette dei tasti in italiano, come quelli della 2D
      locale: { "NavigationControl.ZoomIn": "Ingrandisci", "NavigationControl.ZoomOut": "Riduci" }
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    // Attribuzione sempre leggibile (mai compressa nell'icona): su telefono in alto a destra,
    // il basso e' del cartiglio e della scheda.
    map.addControl(new maplibregl.AttributionControl({ compact: false }), S.opt.mobile ? "top-right" : "bottom-right");
    // Zoom in alto a sinistra come nella 2D, con la "vista d'insieme" alla sua destra (vista-3d.css)
    if (!S.opt.mobile) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    return map;
  }

  // Retino delle zone funzionali, come preparaPattern della 2D: una tessera per colore
  // di PALETTE, fondo al 16%, riga di 2,4 px all'85%, passo di 7 px a 45 gradi. Il passo
  // in diagonale di 7 px vuole una tessera di 7*radice(2) = ~10 px per ripetersi senza giunte.
  function registraRetini() {
    var pr = Math.min(window.devicePixelRatio || 1, 2), lato = 10, px = Math.round(lato * pr);
    S.opt.palette.forEach(function (col, i) {
      var id = "retino-" + i;
      if (S.map.hasImage(id)) return;
      var cv = document.createElement("canvas"); cv.width = px; cv.height = px;
      var x = cv.getContext("2d");
      x.scale(px / lato, px / lato);
      x.globalAlpha = 0.16; x.fillStyle = col; x.fillRect(0, 0, lato, lato);
      x.globalAlpha = 0.85; x.strokeStyle = col; x.lineWidth = 2.4; x.lineCap = "square";
      // righe "/" (la verticale ruotata di 45 gradi della 2D), ripetute oltre i bordi
      [-lato, 0, lato].forEach(function (o) { x.beginPath(); x.moveTo(o - 1, lato + 1); x.lineTo(o + lato + 1, -1); x.stroke(); });
      S.map.addImage(id, x.getImageData(0, 0, px, px), { pixelRatio: px / lato });
    });
  }

  function aggiungiLayer(c) {
    var map = S.map, palette = S.opt.palette;
    map.setLight({ anchor: "map", color: "#FFF6EC", intensity: 0.42, position: [1.4, 205, 38] });
    map.addSource("aree", { type: "geojson", data: c.tessere, promoteId: "codice" });
    map.addSource("municipi", { type: "geojson", data: c.municipi });
    map.addSource("maschera", { type: "geojson", data: c.maschera });
    map.addSource("roma", { type: "geojson", data: c.roma, promoteId: "codice" });
    map.addSource("focus", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    // il municipio che si alza: le sue aree e i loro bordi, per codice (stato `k` per area)
    ["mun", "mun-bordo"].forEach(function (id) {
      map.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "codice" });
    });
    S.colMun = ["match", ["get", "m"]]; S.colLinea = ["match", ["get", "m"]];
    var retino = ["match", ["get", "m"]];
    palette.forEach(function (col, i) { S.colMun.push(i + 1, col); S.colLinea.push(i + 1, scurisci(col, 0.62)); retino.push(i + 1, "retino-" + i); });
    S.colMun.push("#9aa0a6"); S.colLinea.push(scurisci("#9aa0a6", 0.62)); retino.push("retino-0");
    registraRetini();

    // Tutto piatto e a terra, come la 2D: maschera fuori Roma, riempimento (o retino per
    // le zone funzionali), contorno, confini dei municipi, velo; sopra solo le estrusioni
    // del focus. Filtri fissati qui una volta sola, mai cambiati nei passaggi.
    // Sotto l'intro (mosaico) maschera e confini nascono velati (VELATO): tornano nella discesa (aspetto).
    map.addLayer({ id: "maschera", type: "fill", source: "maschera",
      paint: { "fill-color": MASCHERA.colore, "fill-opacity": S.ingresso ? VELATO : MASCHERA.opacita, "fill-antialias": false } });
    map.addLayer({ id: "aree-fill", type: "fill", source: "aree", filter: ["!=", ["get", "zf"], true],
      paint: { "fill-color": S.colMun, "fill-opacity": 0, "fill-antialias": false } });
    map.addLayer({ id: "aree-retino", type: "fill", source: "aree", filter: ["==", ["get", "zf"], true],
      paint: { "fill-pattern": retino, "fill-opacity": 0, "fill-antialias": false } });
    map.addLayer({ id: "aree-linea", type: "line", source: "aree",
      paint: { "line-color": S.colLinea, "line-width": 1, "line-opacity": 0 } });
    // confini dei municipi come la 2D (.municipio-line: amaranto, 1,4 px, 55%); quello del
    // municipio scelto si accende con l'opacita', non con un filtro
    map.addLayer({ id: "mun-line", type: "line", source: "municipi",
      paint: { "line-color": S.opt.amaranto, "line-opacity": S.ingresso ? VELATO : MUN_LINEA, "line-width": 1.4 } });
    // Solo sotto l'intro: il contorno di Roma, lo stesso tratto del disegno (anelli di
    // opt.ingresso.contorno()), nello stesso punto; si spegne nella discesa e resta spento.
    var anelli = S.ingresso ? contornoIngresso() : null;
    if (anelli) {
      map.addSource("contorno", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: anelli } } });
      map.addLayer({ id: "contorno", type: "line", source: "contorno", layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": S.opt.amaranto, "line-width": MOSAICO.linea, "line-opacity": 1 } });
    }
    map.addLayer(strVelo("velo"));
    map.addLayer(strVelo("velo-vecchio"));
    map.addLayer({ id: "mun-focus", type: "line", source: "municipi",
      // il confine del municipio scelto si accende con una dissolvenza breve dello stile
      paint: { "line-color": S.opt.amaranto, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 14, 5], "line-opacity": 0,
               "line-opacity-transition": { duration: 300, delay: 0 } } });
    espressioni();
    // Municipio alzato: ogni area del colore pieno del municipio (come la selezione della
    // 2D), alta hTipo * k; sopra, il contorno scurito come bordo estruso alla stessa quota
    // (le linee stanno a terra). k arriva come feature-state: un'espressione con ["get"]
    // cambiata con setPaintProperty rifarebbe le tessere della sorgente a ogni fotogramma.
    // Nascosti finche' la piu' bassa non supera i 2 m (vedi altezzaMun).
    var k = ["coalesce", ["feature-state", "k"], 0], hk = ["*", ["get", "hTipo"], k];
    map.addLayer({ id: "mun-ext", type: "fill-extrusion", source: "mun", layout: { visibility: "none" }, paint: {
      "fill-extrusion-color": ["get", "col"], "fill-extrusion-height": hk, "fill-extrusion-base": 0, "fill-extrusion-opacity": 1 } });
    map.addLayer({ id: "mun-bordo", type: "fill-extrusion", source: "mun-bordo", layout: { visibility: "none" }, paint: {
      "fill-extrusion-color": ["get", "col"], "fill-extrusion-base": ["max", 0, ["-", hk, 1]], "fill-extrusion-height": ["+", hk, 2],
      "fill-extrusion-opacity": 1, "fill-extrusion-vertical-gradient": false } });
    S.munVis = "none";
    // Roma in rilievo: altezza per area come feature-state `h` (metri), scritta a ogni
    // fotogramma della crescita (mai un'espressione con ["get"] cambiata, mai un filtro).
    // Sempre accesa (uno strato a visibility none ferma la sua sorgente: la crescita
    // partirebbe senza tessere); a terra ha opacita' 0 e non si disegna.
    // Col mosaico anche la base e' per area (feature-state `b`, metri: la tessera che cade, o
    // parcheggiata sopra la camera), e il colore va dal crema al suo (`c`, preparaEvidenza);
    // finito il mosaico b vale 0 e c 1: stesso disegno di sempre, espressioni mai cambiate.
    map.addLayer({ id: "roma-ext", type: "fill-extrusion", source: "roma", paint: {
      "fill-extrusion-color": ["get", "col"], "fill-extrusion-height": ["coalesce", ["feature-state", "h"], 0],
      "fill-extrusion-base": S.ingresso ? ["coalesce", ["feature-state", "b"], 0] : 0,
      "fill-extrusion-opacity": 0, "fill-extrusion-vertical-gradient": true } });
    S.romaSu = false; S.romaOp = 0;
    // Tessera del focus: un blocco solo, il contorno dell'area estruso (pareti amaranto),
    // e sopra il tetto disegnato da strCarta alla stessa quota (colore del municipio, poi la
    // carta, col bordo amaranto dipinto nella texture). Prima le pareti erano un anello di
    // pezzi sovrapposti (un rettangolo per lato e un esagono per vertice) con lastra e bordo
    // estrusi uno o due metri sopra: facce quasi coincidenti, e in movimento la profondita'
    // le alternava a ogni fotogramma (pareti che sfarfallavano e cambiavano spessore).
    map.addLayer({ id: "focus-wall", type: "fill-extrusion", source: "focus", paint: {
      "fill-extrusion-color": S.opt.amaranto, "fill-extrusion-height": 0, "fill-extrusion-base": 0, "fill-extrusion-opacity": 1 } });
    map.addLayer(strCarta("focus-carta", function () {
      return { c: S.carta, h: S.focusH, su: S.focusVis === "visible" && !!(S.focus && S.focus.forma) };
    }));
    // La tessera uscente (vedi passaAllaUscente): stessa forma della attiva, gia' nelle tessere della
    // sua sorgente e a opacita' 0; al cambio d'area prende la quota della attiva e scende
    // mentre l'attiva sale con la forma nuova.
    map.addSource("focus-giu", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "focus-giu-wall", type: "fill-extrusion", source: "focus-giu", paint: {
      "fill-extrusion-color": S.opt.amaranto, "fill-extrusion-height": 0, "fill-extrusion-base": 0, "fill-extrusion-opacity": 0 } });
    map.addLayer(strCarta("focus-giu-carta", function () {
      return { c: S.giu.carta, h: S.giu.h, su: S.giu.h >= 2 };
    }));
  }

  // ---------- carta sul tetto della tessera d'area ----------
  // Le tile OSM dell'area, a uno zoom vicino a quello d'arrivo, composte in un canvas e
  // ritagliate sul contorno: e' la texture di un rettangolo alla quota del tetto, allineato
  // al mondo (gli angoli sono i bordi delle tile in coordinate mercatore). Lo strato WebGL
  // (custom, "3d") condivide la profondita' delle estrusioni: le pareti restano davanti e
  // dietro come prima. Si disegna solo con la tessera su (S.focusVis "visible"); finche' le
  // tile arrivano il tetto e' il colore pieno del municipio, poi la carta lo sostituisce
  // nello stesso fotogramma. Niente addLayer ne' setData durante le transizioni: lo strato
  // c'e' da subito. Una via aperta (S.via) si dipinge sulla carta, ritagliata sul contorno,
  // come la 2D: inchiostro scuro col bordo bianco. La carta senza via resta (c.nuda): la via
  // si toglie o cambia senza ricaricare le tile (c.rifai), e nessuna superficie in piu'.
  function caricaCarta(e, col, z, W) {
    var zt = Math.max(10, Math.min(18, Math.round(z) + 1)), n, x0, y0, x1, y1;
    var tx = function (lon, k) { return (lon + 180) / 360 * k; };
    var ty = function (lat, k) { var r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * k; };
    for (;; zt--) {
      n = Math.pow(2, zt);
      x0 = Math.floor(tx(e.box[0], n)); x1 = Math.floor(tx(e.box[2], n));
      y0 = Math.floor(ty(e.box[3], n)); y1 = Math.floor(ty(e.box[1], n));
      if ((x1 - x0 + 1) * 256 <= 4096 && (y1 - y0 + 1) * 256 <= 4096) break;
    }
    // c.canvas e' sempre il tetto da disegnare (c.ver cambia a ogni canvas nuovo): subito il
    // colore pieno del municipio, poi la carta (c.pronta) quando arrivano tutte le tile.
    var c = { pronta: false, finita: false, ver: 0, box: [x0 / n, y0 / n, (x1 + 1) / n, (y1 + 1) / n], lat: (e.box[1] + e.box[3]) / 2 };
    var larg = (x1 - x0 + 1) * 256, alt = (y1 - y0 + 1) * 256;
    // il contorno (con i buchi) in pixel della texture
    var contorno = new Path2D();
    poligoni(e.g).forEach(function (pol) { pol.forEach(function (r) {
      r.forEach(function (q, i) {
        var px = (tx(q[0], n) - x0) * 256, py = (ty(q[1], n) - y0) * 256;
        if (i) contorno.lineTo(px, py); else contorno.moveTo(px, py);
      });
      contorno.closePath();
    }); });
    // il bordo amaranto largo W metri, tutto dentro il contorno: il tetto finisce dove
    // finiscono le pareti (le tile hanno 256 px a zt)
    var mppTex = 40075016.686 * Math.cos((e.box[1] + e.box[3]) / 2 * Math.PI / 180) / (256 * n);
    var bordoTetto = function (g) {
      g.save(); g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
      g.clip(contorno, "evenodd");
      g.lineWidth = 2 * W / mppTex; g.lineJoin = "round"; g.strokeStyle = S.opt.amaranto;
      g.stroke(contorno);
      g.restore();
    };
    // la via larga come nella 2D (9 px il bordo, 5 l'inchiostro) alla camera d'arrivo
    var pxTex = mppA(c.lat, z) / mppTex;
    var conVia = function (cv) {
      var v = S && S.via, b = e.box;
      c.via = ""; c.viaUsata = v;
      if (!v) return cv;
      // i tratti della via che toccano il riquadro dell'area
      var tratti = v.linee.filter(function (l) {
        var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        l.forEach(function (q) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); });
        return x0 <= b[2] && x1 >= b[0] && y0 <= b[3] && y1 >= b[1];
      });
      if (!tratti.length) return cv;
      var o = document.createElement("canvas"), g = o.getContext("2d"), via = new Path2D();
      o.width = cv.width; o.height = cv.height;
      g.drawImage(cv, 0, 0);
      tratti.forEach(function (l) { l.forEach(function (q, i) {
        var px = (tx(q[0], n) - x0) * 256, py = (ty(q[1], n) - y0) * 256;
        if (i) via.lineTo(px, py); else via.moveTo(px, py);
      }); });
      g.save(); g.clip(contorno, "evenodd");
      g.lineCap = "round"; g.lineJoin = "round";
      g.strokeStyle = "rgba(255,255,255,0.95)"; g.lineWidth = 9 * pxTex; g.stroke(via);
      g.strokeStyle = "#241B1A"; g.lineWidth = 5 * pxTex; g.stroke(via);
      g.restore();
      c.via = v.nome;
      return o;
    };
    var pubblica = function (cv) { c.nuda = cv; c.canvas = conVia(cv); c.ver++; if (S && S.map) S.map.triggerRepaint(); };
    c.rifai = function () { if (c.nuda) pubblica(c.nuda); };
    var base = document.createElement("canvas"), gb = base.getContext("2d");
    base.width = larg; base.height = alt;
    gb.fillStyle = col; gb.fill(contorno, "evenodd");
    bordoTetto(gb);
    pubblica(base);
    var cv = document.createElement("canvas"), g = cv.getContext("2d");
    cv.width = larg; cv.height = alt;
    g.fillStyle = "#EDE8E1"; g.fillRect(0, 0, cv.width, cv.height);   // una tile persa e' fondo, non un buco
    var manca = (x1 - x0 + 1) * (y1 - y0 + 1), rotte = 0;
    var fine = function () {
      if (--manca > 0) return;
      c.finita = true;
      if (rotte * 4 > cv.width / 256 * cv.height / 256) return;     // OSM irraggiungibile: resta il tetto pieno
      // ritaglio sul contorno (con i buchi), il velo del colore del municipio, il bordo
      g.globalCompositeOperation = "destination-in"; g.fill(contorno, "evenodd");
      g.globalCompositeOperation = "source-atop"; g.globalAlpha = CARTA_VELO; g.fillStyle = col;
      g.fillRect(0, 0, cv.width, cv.height);
      bordoTetto(g);
      c.pronta = true;
      pubblica(cv);
    };
    for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) (function (x, y) {
      var im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = function () { g.drawImage(im, (x - x0) * 256, (y - y0) * 256); fine(); };
      im.onerror = function () { rotte++; fine(); };
      im.src = TILE_URL.replace("{z}", zt).replace("{x}", x).replace("{y}", y);
    })(x, y);
    return c;
  }
  // `tetto()` dice cosa disegnare: { c: carta, h: quota, su: si disegna } (la tessera attiva
  // e quella uscente, vedi passaAllaUscente). La texture si carica anche a tessera spenta:
  // la uscente la ha gia' pronta quando prende il posto della attiva.
  function strCarta(id, tetto) {
    var gl, prog, va, vao, buf, tex, caricata, loc = {};
    var VS = "uniform mat4 u_m; uniform float u_z; uniform vec4 u_box; attribute vec2 a_uv; varying vec2 v_uv;" +
      "void main() { v_uv = a_uv; gl_Position = u_m * vec4(mix(u_box.xy, u_box.zw, a_uv), u_z, 1.0); }";
    var FS = "precision mediump float; uniform sampler2D u_tex; varying vec2 v_uv;" +
      "void main() { vec4 c = texture2D(u_tex, v_uv); if (c.a < 0.01) discard; gl_FragColor = c; }";
    var sh = function (tipo, src) { var o = gl.createShader(tipo); gl.shaderSource(o, src); gl.compileShader(o); return o; };
    var collega = function () {
      gl.linkProgram(prog);
      if (gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
      if (window.console) console.warn("Vista 3D: shader non collegato", gl.getProgramInfoLog(prog));
      gl.deleteProgram(prog); prog = null;
    };
    return {
      id: id, type: "custom", renderingMode: "3d",
      onAdd: function (map, g) {
        gl = g; prog = gl.createProgram();
        gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
        collega();
        if (!prog) return;
        ["u_m", "u_z", "u_box", "u_tex"].forEach(function (k) { loc[k] = gl.getUniformLocation(prog, k); });
        loc.a_uv = gl.getAttribLocation(prog, "a_uv");
        // un vertex array tutto suo (WebGL2): disegnando con quello legato da MapLibre i suoi
        // attributi accesi facevano fallire il disegno (su desktop il piano non compariva)
        var ext = !gl.createVertexArray && gl.getExtension("OES_vertex_array_object");
        va = gl.createVertexArray ? { crea: function () { return gl.createVertexArray(); }, lega: function (v) { gl.bindVertexArray(v); }, ora: gl.VERTEX_ARRAY_BINDING }
          : ext ? { crea: function () { return ext.createVertexArrayOES(); }, lega: function (v) { ext.bindVertexArrayOES(v); }, ora: ext.VERTEX_ARRAY_BINDING_OES } : null;
        var prima = va && gl.getParameter(va.ora);
        if (va) { vao = va.crea(); va.lega(vao); }
        buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc.a_uv);
        gl.vertexAttribPointer(loc.a_uv, 2, gl.FLOAT, false, 0, 0);
        if (va) va.lega(prima);
        tex = gl.createTexture();
      },
      render: function (g, m) {
        var t = S && tetto(), c = t && t.c;
        if (!prog || !c || !c.canvas) return;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        if (caricata !== c.canvas) {
          caricata = c.canvas;
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c.canvas);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        }
        if (!t.su) return;
        // Il tetto sta TETTO_STACCO px sopra la cima del blocco (in metri allo zoom corrente):
        // alla stessa quota le due superfici si contendevano la profondita' (meta' carta e
        // meta' amaranto, divise sulla diagonale del rettangolo), e lo spiraglio mostra solo
        // la cima amaranto del blocco, del colore del bordo. Quota in unita' mercatore alla
        // latitudine del centro, come le estrusioni.
        var stacco = mppA(c.lat, S.map.getZoom()) * TETTO_STACCO;
        var z = maplibregl.MercatorCoordinate.fromLngLat(S.map.getCenter(), t.h + stacco).z;
        // Coordinate relative all'angolo del rettangolo, con la traslazione nella matrice in
        // doppia precisione: in mercatore assoluto (float32 nello shader) il tetto tremava di
        // mezzo pixel a ogni movimento rispetto alle pareti.
        var b = c.box, mo = new Float32Array(16);
        for (var i = 0; i < 12; i++) mo[i] = m[i];
        for (var r = 0; r < 4; r++) mo[12 + r] = m[r] * b[0] + m[4 + r] * b[1] + m[8 + r] * z + m[12 + r];
        gl.useProgram(prog);
        gl.uniformMatrix4fv(loc.u_m, false, mo);
        gl.uniform1f(loc.u_z, 0);
        gl.uniform4f(loc.u_box, 0, 0, b[2] - b[0], b[3] - b[1]);
        gl.uniform1i(loc.u_tex, 0);
        if (!va) return;
        var prima = gl.getParameter(va.ora);
        va.lega(vao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        va.lega(prima);
      }
    };
  }

  // ---------- velo ----------
  // Il velo senza sorgente GeoJSON: un rettangolo a tutto schermo del colore del velo, tranne
  // dentro il buco (stencil pari/dispari dei contorni esterni, a ventaglio). Come sorgente
  // a ogni buco nuovo MapLibre buttava le sue tessere: nei voli lunghi (zoom che scende e
  // risale) non c'erano ne' tessere ne' madri e restavano i pezzi della vista di prima, un
  // rettangolo scuro che scivolava. Ora il velo copre sempre tutto lo schermo e il buco
  // cambia nello stesso fotogramma.
  function strVelo(id) {
    var gl, prog, va, vao, quad, loc = {}, pronto = null;
    var VS = "uniform mat4 u_m; attribute vec2 a_pos; void main() { gl_Position = u_m * vec4(a_pos, 0.0, 1.0); }";
    var FS = "precision mediump float; uniform vec4 u_col; void main() { gl_FragColor = u_col; }";
    var sh = function (tipo, src) { var o = gl.createShader(tipo); gl.shaderSource(o, src); gl.compileShader(o); return o; };
    var collega = function () {
      gl.linkProgram(prog);
      if (gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
      if (window.console) console.warn("Vista 3D: shader non collegato", gl.getProgramInfoLog(prog));
      gl.deleteProgram(prog); prog = null;
    };
    var I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    var rgb = [1, 3, 5].map(function (i) { return parseInt(VELO.colore.substr(i, 2), 16) / 255; });
    // contorni esterni del buco in coordinate mercatore, relative al primo punto (float32
    // a zoom 16 sbaglierebbe di metri): l'origine entra nella matrice, calcolata in doppia
    var buco = function (g) {
      if (pronto && pronto.g === g) return pronto;
      if (pronto) gl.deleteBuffer(pronto.buf);
      var v = [], parti = [], o = null;
      poligoni(g).forEach(function (pol) {
        var r = pol[0], da = v.length / 2;
        r.forEach(function (q) {
          var mc = maplibregl.MercatorCoordinate.fromLngLat(q);
          if (!o) o = [mc.x, mc.y];
          v.push(mc.x - o[0], mc.y - o[1]);
        });
        parti.push([da, r.length]);
      });
      var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
      pronto = { g: g, buf: buf, parti: parti, o: o || [0, 0] };
      return pronto;
    };
    var attributo = function (buf) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc.a_pos);
      gl.vertexAttribPointer(loc.a_pos, 2, gl.FLOAT, false, 0, 0);
    };
    return {
      id: id, type: "custom", renderingMode: "2d",
      onAdd: function (map, g) {
        gl = g; prog = gl.createProgram();
        gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
        collega();
        if (!prog) return;
        loc.u_m = gl.getUniformLocation(prog, "u_m"); loc.u_col = gl.getUniformLocation(prog, "u_col");
        loc.a_pos = gl.getAttribLocation(prog, "a_pos");
        // un vertex array tutto suo, come la carta del tetto
        var ext = !gl.createVertexArray && gl.getExtension("OES_vertex_array_object");
        va = gl.createVertexArray ? { crea: function () { return gl.createVertexArray(); }, lega: function (v) { gl.bindVertexArray(v); }, ora: gl.VERTEX_ARRAY_BINDING }
          : ext ? { crea: function () { return ext.createVertexArrayOES(); }, lega: function (v) { ext.bindVertexArrayOES(v); }, ora: ext.VERTEX_ARRAY_BINDING_OES } : null;
        if (va) vao = va.crea();
        quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      },
      render: function (g, m) {
        var a = S && S.veloOp[id];
        if (!prog || !a || a <= 0.001 || !va) return;
        var prima = gl.getParameter(va.ora);
        va.lega(vao);
        gl.useProgram(prog);
        gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
        var b = S.veloG[id];
        if (b) {
          // il buco nello stencil: ogni ventaglio inverte, dentro resta dispari
          var h = buco(b), o = h.o, mm = Array.prototype.slice.call(m);
          for (var i = 0; i < 4; i++) mm[12 + i] = m[i] * o[0] + m[4 + i] * o[1] + m[12 + i];
          gl.enable(gl.STENCIL_TEST); gl.stencilMask(0xFF);
          gl.clearStencil(0); gl.clear(gl.STENCIL_BUFFER_BIT);
          gl.colorMask(false, false, false, false);
          gl.stencilFunc(gl.ALWAYS, 0, 0xFF); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
          gl.uniformMatrix4fv(loc.u_m, false, mm);
          attributo(h.buf);
          h.parti.forEach(function (pt) { gl.drawArrays(gl.TRIANGLE_FAN, pt[0], pt[1]); });
          gl.colorMask(true, true, true, true);
          gl.stencilFunc(gl.EQUAL, 0, 0xFF); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        } else gl.disable(gl.STENCIL_TEST);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.uniformMatrix4fv(loc.u_m, false, I);
        gl.uniform4f(loc.u_col, rgb[0] * a, rgb[1] * a, rgb[2] * a, a);
        attributo(quad);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        if (b) {
          // stencil a zero e maschere di ritaglio di MapLibre da rifare: lo strato dopo
          // (mun-focus) e' della stessa sorgente di quello prima e le darebbe per buone
          gl.clear(gl.STENCIL_BUFFER_BIT);
          if (S.map.painter) S.map.painter.currentStencilSource = undefined;
        }
        va.lega(prima);
      }
    };
  }

  // ---------- quota: icone ed etichette sul piano della tessera ----------
  function urlSvg(svg) { return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); }
  // Spostamento a schermo fra il punto a terra e lo stesso punto a `metri` di quota:
  // proiezione esatta della camera (pitch, prospettiva), punto per punto.
  function scostamento(ll, metri) {
    if (!metri) return [0, 0];
    var t = S.map.transform, mc = maplibregl.MercatorCoordinate.fromLngLat(ll);
    var a = t.coordinatePoint(mc, metri), b = t.coordinatePoint(mc, 0);
    return [Math.round(a.x - b.x), Math.round(a.y - b.y)];
  }
  function quotaServizi() { return S.livello === "area" ? (S.focusH || 0) + 3 : 0; }
  function quota() {
    if (!S) return;
    var qs = quotaServizi();
    (S.marcatori || []).forEach(function (m) { m.marker.setOffset(scostamento(m.ll, qs)); });
    // nella vista municipio ogni nome sta sul tetto della sua tessera (quota per tipo)
    (S.etichette || []).forEach(function (e) {
      var q = e.kRoma ? (S.romaH[e.kRoma] || 0) + 3 : (e.h ? e.h * (S.munK || 0) + 3 : S.quotaEtichette);
      e.el.setAttribute("data-quota", Math.round(q));
      e.marker.setOffset(scostamento(e.ll, q));
    });
  }

  // ---------- DOM sovrapposto ----------
  function creaDom(el) {
    var d = document.createElement("div");
    d.className = "v3d-ui" + (S.opt.mobile ? "" : " v3d-con-zoom");
    d.innerHTML =
      '<button type="button" class="v3d-reset" hidden>&#8592;&nbsp; Vista d\'insieme</button>' +
      '<div class="v3d-cartiglio v3d-out" aria-live="polite">' +
        '<div class="v3d-nome"></div><div class="v3d-meta"></div>' +
      '</div>' +
      // stesse classi del tooltip dei servizi della 2D (stile e freccia identici)
      '<div class="v3d-popup leaflet-tooltip servizio-tooltip leaflet-tooltip-top" role="status" hidden></div>';
    el.appendChild(d);
    S.ui = {
      reset: d.querySelector(".v3d-reset"), cart: d.querySelector(".v3d-cartiglio"),
      nome: d.querySelector(".v3d-nome"), meta: d.querySelector(".v3d-meta"), popup: d.querySelector(".v3d-popup")
    };
    S.ui.reset.addEventListener("click", function () { scegli({ tipo: "roma" }); });
  }

  // Il cartiglio (piccolo: nome e una riga di dati) non si ricrea: cambia il testo dentro
  // gli stessi elementi, con una dissolvenza breve solo se il nome cambia davvero.
  function cartiglio(nome, meta, medio) {
    var u = S.ui, gen = S.gen;
    var cambia = u.nome.textContent !== nome || u.cart.hidden;
    if (cambia) u.cart.classList.add("v3d-out");
    dopo(cambia && !S.opt.riduciMovimento ? 300 : 0, function () {
      if (S.gen !== gen) return;
      u.cart.hidden = false;
      u.meta.innerHTML = meta;
      if (cambia) { u.nome.textContent = nome; u.nome.classList.toggle("v3d-nome-medio", !!medio); }
      adattaNome();
      // un fotogramma a v3d-out dopo hidden = false, cosi' la dissolvenza in entrata parte
      requestAnimationFrame(function () { if (S && S.gen === gen) u.cart.classList.remove("v3d-out"); });
    });
  }
  // Nell'area il cartiglio sparisce (c'e' la scheda della 2D): dissolvenza, poi via.
  function nascondiCartiglio() {
    var u = S.ui, gen = S.gen;
    u.cart.classList.add("v3d-out");
    dopo(S.opt.riduciMovimento ? 0 : 300, function () { if (S.gen === gen) u.cart.hidden = true; });
  }

  // Nome su due righe al massimo, sempre (a 32 px al massimo): si parte dalla misura del CSS e si
  // scende finche' il testo, bilanciato, sta in due righe.
  function adattaNome() {
    var el = S && S.ui && S.ui.nome;
    if (!el || !el.textContent) return;
    el.style.fontSize = "";
    var cs = getComputedStyle(el), size = parseFloat(cs.fontSize), minimo = 18;
    var righe = function () { var lh = parseFloat(getComputedStyle(el).lineHeight) || size * 0.95; return Math.round(el.scrollHeight / lh); };
    while (righe() > 2 && size > minimo) { size -= 2; el.style.fontSize = size + "px"; }
  }

  // Popup dei servizi: stesso contenuto del tooltip della 2D (nome, "prevista", categoria),
  // appoggiato sopra l'icona.
  function testoServizio(p) {
    var nome = (p.nome === singolare(p.cat) && p.ind) ? p.ind : p.nome;
    return esc(nome) + (p.prevista ? (p.chiusa ? " (chiusa per lavori)" : " (prevista)") : "") + '<span class="st-cat">' + esc(singolare(p.cat)) + "</span>";
  }
  function popup(el, html, elenco) {
    var p = S.ui.popup, r = el.getBoundingClientRect(), b = S.el.getBoundingClientRect();
    p.innerHTML = html; p.hidden = false;
    p.classList.toggle("servizio-elenco", !!elenco);
    var w = S.el.clientWidth, x = r.left + r.width / 2 - b.left;
    // come la 2D (scegliServizio): l'icona scelta resta accesa, le altre si spengono
    S.el.querySelectorAll(".attiva").forEach(function (x) { x.classList.remove("attiva"); });
    el.classList.add("attiva");
    S.el.classList.add("servizi-scelta");
    p.style.left = Math.max(110, Math.min(w - 110, x)) + "px";
    p.style.top = (r.top - b.top + (elenco ? 0 : r.height * 0.15)) + "px";
  }
  function chiudiPopup() {
    if (!S || !S.ui) return;
    if (S.opt.chiudiScheda) S.opt.chiudiScheda();
    S.ui.popup.hidden = true;
    S.el.classList.remove("servizi-scelta");
    S.el.querySelectorAll(".attiva").forEach(function (x) { x.classList.remove("attiva"); });
  }

  // ---------- focus ----------
  function altezzaFocus(h) {
    var map = S.map;
    S.focusH = h;
    map.setPaintProperty("focus-wall", "fill-extrusion-height", h);
    // A terra la tessera non si disegna: tetto e pareti starebbero alla quota delle tessere
    // di sfondo e i due colori si contenderebbero i pixel (il glitch fra una zona e l'altra).
    // Con un'area caricata e ancora a terra lo strato resta acceso a opacita' 0 (non si
    // disegna): uno strato a visibility none ferma la sua sorgente, e la forma nuova
    // arrivava solo al primo fotogramma visibile, quando la crescita era gia' partita.
    var vis = h >= 2 ? "visible" : (S.focus ? "spento" : "none");
    if (S.focusVis !== vis) {
      S.focusVis = vis;
      map.setLayoutProperty("focus-wall", "visibility", vis === "none" ? "none" : "visible");
      map.setPaintProperty("focus-wall", "fill-extrusion-opacity", vis === "visible" ? 1 : 0);
    }
    if (S.marcatori && S.marcatori.length) quota();
  }
  // La tessera del focus scende prima di cambiare forma: mai una geometria nuova con le
  // pareti di quella vecchia.
  function abbassaFocus(fine, durata) {
    var da = S.focusH || 0;
    if (!S.focus || da <= 0) { if (fine) fine(); return; }
    tween("focus", durata || 450, function (k) { altezzaFocus(da * (1 - k)); }, fine);
  }
  // A tessera cresciuta e camera arrivata la parete a vista resta quella dell'arrivo a ogni
  // zoom: con l'altezza fissa in metri, avvicinandosi (rotella, dita, tasti)
  // il tetto cresceva sullo schermo fino a superare la camera, che finiva dentro la tessera.
  // Durante il volo d'arrivo l'altezza resta quella calcolata per la camera d'arrivo.
  function seguiZoom() {
    if (S.livello !== "area" || !S.focus || !S.focus.su || S.tween.focus || S.zoomArrivo != null) return;
    altezzaFocus(altezzaArea(cache.byCode[S.focus.codice], S.map.getZoom()));
  }
  // se lo zoom non e' quello previsto (un gesto in volo) la tessera si adegua in un attimo
  function adeguaFocus(fine) {
    if (S.livello !== "area" || !S.focus || !S.focus.su || S.tween.focus) { if (fine) fine(); return; }
    var da = S.focusH, a = altezzaArea(cache.byCode[S.focus.codice], S.map.getZoom());
    if (Math.abs(a - da) < 1) { if (fine) fine(); return; }
    tween("focus", 250, function (k) { altezzaFocus(da + (a - da) * k); }, fine);
  }
  // fine della crescita: da qui la tessera segue lo zoom
  function focusSu(fine) {
    S.focus.su = true;
    if (S.zoomArrivo != null) { if (fine) fine(); return; }
    adeguaFocus(fine);
  }
  function svuotaFocus() {
    var vuoto = { type: "FeatureCollection", features: [] };
    S.focus = null; S.carta = null;
    S.map.getSource("focus").setData(vuoto);
    altezzaFocus(0);
  }

  // ---------- tessera uscente ----------
  // Nel cambio d'area la tessera di prima scende mentre la nuova sale, senza passare da
  // terra: la uscente ("focus-giu") tiene gia' nelle sue tessere la forma della attiva, a
  // opacita' 0, e al cambio ne prende quota e carta nello stesso fotogramma. Una sorgente
  // sola obbligava a scendere a 0 prima del setData della forma nuova: scendi, cambia, risali.
  var GIU_DURATA = 600;
  function altezzaGiu(h) {
    S.giu.h = h;
    S.map.setPaintProperty("focus-giu-wall", "fill-extrusion-height", h);
    var o = h >= 2 ? 1 : 0;
    if (S.giu.o !== o) { S.giu.o = o; S.map.setPaintProperty("focus-giu-wall", "fill-extrusion-opacity", o); }
    S.map.triggerRepaint();
  }
  // la forma della attiva anche nella uscente, appena questa e' libera (a terra)
  function preparaGiu() {
    if (S.tween.giu || !S.focus || S.giu.codice === S.focus.codice) return;
    S.giu.codice = S.focus.codice; S.giu.carta = S.carta;
    S.map.getSource("focus-giu").setData({ type: "FeatureCollection", features: [{ type: "Feature",
      properties: { codice: S.focus.codice }, geometry: cache.byCode[S.focus.codice].g }] });
  }
  // la uscente puo' prendere il posto della attiva: e' a terra e nelle sue tessere c'e' solo
  // la forma della attiva (con un cambio in volo non c'e' ancora: si scende come prima)
  function giuPronta() {
    if (S.tween.giu || !S.focus || S.focusH < 2 || S.giu.codice !== S.focus.codice) return false;
    var fs = S.map.querySourceFeatures("focus-giu");
    return fs.length > 0 && fs.every(function (f) { return f.properties.codice === S.focus.codice; });
  }
  function passaAllaUscente() {
    var da = S.focusH;
    altezzaGiu(da);
    altezzaFocus(0);
    tween("giu", GIU_DURATA, function (k) { altezzaGiu(da * (1 - k)); }, function () { altezzaGiu(0); preparaGiu(); });
  }

  // ---------- municipio alzato ----------
  // k (metri per unita' di hTipo) su ogni area caricata. Come altezzaFocus: sotto i 2 m
  // (misurati sulla piu' bassa, la zona funzionale) gli strati sono nascosti, mai
  // disegnati a terra sopra le tessere piatte.
  function altezzaMun(k) {
    var map = S.map;
    S.munK = k;
    S.munCodici.forEach(function (c) {
      // l'area scelta dal municipio passa alla tessera del focus, che parte dalla sua quota
      var kc = c === S.munFuori ? 0 : k;
      map.setFeatureState({ source: "mun", id: c }, { k: kc });
      map.setFeatureState({ source: "mun-bordo", id: c }, { k: kc });
    });
    var vis = k * H_TIPO_MIN >= 2 ? "visible" : "none";
    if (S.munVis !== vis) {
      S.munVis = vis;
      ["mun-ext", "mun-bordo"].forEach(function (id) { map.setLayoutProperty(id, "visibility", vis); });
    }
    if (S.etichette && S.etichette.length) quota();
  }
  function fermaMun() { if (S.tween.mun) { cancelAnimationFrame(S.tween.mun); S.tween.mun = null; } }
  // Il municipio scende prima di cambiare forma (o tipi): mai una sorgente nuova sopra 0.
  function abbassaMun(fine) {
    var da = S.munK || 0;
    if (da <= 0) { fermaMun(); if (fine) fine(); return; }
    tween("mun", 450, function (t) { altezzaMun(da * (1 - t)); }, fine);
  }
  // Solo a k 0 (strati nascosti): le aree del municipio m coi tipi accesi, e i loro bordi
  // larghi W metri (rifatti solo se cambia la larghezza).
  function caricaMun(m, W) {
    var col = colore(m), lin = scurisci(col, 0.62), ext = [], brd = [];
    altezzaMun(0);
    S.munCodici = []; S.munFuori = null;
    (cache.perMun[m] || []).forEach(function (k) {
      if (!tipoAttivo(k)) return;
      var e = cache.byCode[k], h = H_TIPO[e.p.tipo] || H_TIPO.QUARTIERE;
      if (!e.bordoMun || e.bordoMun.W !== W) e.bordoMun = { W: W, g: bordo(e.g, W) };
      S.munCodici.push(k);
      ext.push({ type: "Feature", properties: { codice: k, m: m, tipo: e.p.tipo, hTipo: h, col: col }, geometry: e.g });
      brd.push({ type: "Feature", properties: { codice: k, hTipo: h, col: lin }, geometry: e.bordoMun.g });
    });
    S.munM = m; S.munChiave = chiaveTipi(S.tipi);
    S.map.getSource("mun").setData({ type: "FeatureCollection", features: ext });
    S.map.getSource("mun-bordo").setData({ type: "FeatureCollection", features: brd });
    altezzaMun(0);
  }
  // Sale (o si adegua) fino a kt, col rimbalzo della tessera d'area.
  function alzaMun(kt, fine) {
    var da = S.munK || 0;
    tween("mun", da > 0 ? 600 : 1300, function (t) { altezzaMun(da + (kt - da) * t); }, fine, da > 0 ? ease : easeBack);
  }
  // Il municipio m alzato coi tipi accesi: se e' gia' quello caricato resta su e si
  // adegua, altrimenti scende, cambia e risale dopo `attesa` ms (la camera quasi arrivata).
  // Le etichette escono a crescita finita, ciascuna sulla sua tessera.
  // Ogni chiamata annulla quelle prima (munGen): un filtro cambiato in volo rifa' solo questo.
  // Si sale solo a sorgenti caricate (setData e' asincrono): a riposo l'attesa e' 0, e con
  // le tessere di prima ancora in memoria un tipo appena spento si sarebbe alzato per un
  // fotogramma.
  function municipioSu(m, attesa) {
    var mg = ++S.munGen, gen = S.gen, t0 = performance.now(), ist = S;
    var mio = function () { return S === ist && S.gen === gen && S.munGen === mg; };
    var sale = function () {
      if (!mio()) return;
      if (!(S.map.isSourceLoaded("mun") && S.map.isSourceLoaded("mun-bordo"))) { requestAnimationFrame(sale); return; }
      S.munFuori = null;
      alzaMun(S.munKt, function () {
        if (!mio()) return;
        mostraEtichette((cache.perMun[m] || []).filter(tipoAttivo), 0);
        segnaPronta("mun");
      });
    };
    if (S.munM === m && S.munChiave === chiaveTipi(S.tipi) && S.munK > 0) { sale(); return; }
    abbassaMun(function () {
      if (!mio()) return;
      caricaMun(m, S.munW);
      dopo(Math.max(0, attesa - (performance.now() - t0)), sale);
    });
  }

  // ---------- Roma in rilievo (l'ingresso di prima) ----------
  // Quota d'arrivo di un'area a livello Roma: per tipo, 0 se il tipo e' spento.
  function hRoma(k) { return tipoAttivo(k) ? (H_TIPO[cache.byCode[k].p.tipo] || H_TIPO.QUARTIERE) : 0; }
  function scriviRoma(alt) {
    var max = 0;
    Object.keys(alt).forEach(function (k) {
      var h = alt[k];
      if (S.romaH[k] !== h) { S.romaH[k] = h; S.map.setFeatureState({ source: "roma", id: k }, { h: h }); }
    });
    Object.keys(S.romaH).forEach(function (k) { if (S.romaH[k] > max) max = S.romaH[k]; });
    // sotto i 2 m non si disegna (mai tetti a terra sopra le aree piatte della 2D)
    var su = max >= 2, op = su ? 0.9 : 0;
    S.romaSu = su;
    if (S.romaOp !== op) { S.romaOp = op; S.map.setPaintProperty("roma-ext", "fill-extrusion-opacity", op); }
    if (S.livello === "roma" && S.etichette.length) quota();
  }
  // Dalla quota visibile ora (anche a meta' di un passaggio) a `arrivo` ({codice: metri},
  // assenti a 0). L'area in S.romaFermo resta dov'e': la tessera del focus la prende in consegna.
  function romaVerso(arrivo, durata, fine, curva) {
    var da = {}, uguale = true;
    Object.keys(cache.byCode).forEach(function (k) { da[k] = S.romaH[k] || 0; if (da[k] !== (arrivo[k] || 0)) uguale = false; });
    if (uguale) { if (S.tween.roma) { cancelAnimationFrame(S.tween.roma); S.tween.roma = null; } if (fine) fine(); return; }
    tween("roma", durata, function (t) {
      var alt = {};
      Object.keys(da).forEach(function (k) { if (k !== S.romaFermo) alt[k] = da[k] + ((arrivo[k] || 0) - da[k]) * t; });
      scriviRoma(alt);
    }, fine, curva);
  }
  function romaSu(durata, fine) {
    var alt = {};
    Object.keys(cache.byCode).forEach(function (k) { alt[k] = hRoma(k); });
    romaVerso(alt, durata, fine);
  }
  function romaGiu(durata) { romaVerso({}, durata == null ? 600 : durata); }

  // ---------- servizi ----------
  function dimensioneIcona(z) {
    var t = Math.max(0, Math.min(1, (z - 13) / 5)); // come la 2D: 13 -> 28 px, 18 -> 36 px
    return Math.round(SERVIZI_ICON_MIN + (SERVIZI_ICON_MAX - SERVIZI_ICON_MIN) * t);
  }
  // Id interni delle SVG univoci per istanza (come svgConIdUnici della 2D).
  var seqIcona = 0;
  function svgUnica(svg) {
    var suf = "-v" + (seqIcona++);
    return svg.replace(/id="([^"]+)"/g, function (m, id) { return 'id="' + id + suf + '"'; })
      .replace(/url\(#([^)]+)\)/g, function (m, id) { return "url(#" + id + suf + ")"; })
      .replace(/aria-labelledby="([^"]+)"/g, function (m, id) { return 'aria-labelledby="' + id + suf + '"'; });
  }
  function togliMarcatori() {
    chiudiVentaglio();
    (S.marcatori || []).forEach(function (m) { m.marker.remove(); });
    S.marcatori = [];
  }
  // Pixel su cui si fanno i gruppi. Telefono: quelli dello schermo, durante il volo della
  // camera d'arrivo (zoom, inclinazione, rotazione), a fermo della camera corrente; sulla
  // vista inclinata le distanze in verticale si accorciano. Desktop (approvato cosi'): le
  // coordinate del mondo allo zoom.
  function proiettore() {
    if (!S.opt.mobile) {
      var z = S.zoomArrivo != null ? S.zoomArrivo : S.map.getZoom(), mondo = 512 * Math.pow(2, z);
      return {
        su: function (ll) { var mc = maplibregl.MercatorCoordinate.fromLngLat([ll.lng, ll.lat]); return { x: mc.x * mondo, y: mc.y * mondo }; },
        giu: function (x, y) { var l = new maplibregl.MercatorCoordinate(x / mondo, y / mondo).toLngLat(); return [l.lng, l.lat]; }
      };
    }
    var tr = S.map.transform, a = S.camArrivo;
    if (S.zoomArrivo != null && a && a.center) {
      tr = tr.clone();
      tr.center = maplibregl.LngLat.convert(a.center); tr.zoom = a.zoom; tr.bearing = a.bearing; tr.pitch = a.pitch;
    }
    // sul tetto della tessera, dove i marcatori stanno davvero (quota() li alza): a terra la
    // prospettiva accorciava le distanze in verticale e due grappoli finivano per toccarsi
    var h = S.livello === "area" && S.focus ? altezzaArea(cache.byCode[S.focus.codice], tr.zoom) + 3 : 0;
    function alto(l) { var mc = maplibregl.MercatorCoordinate.fromLngLat(l), a = tr.coordinatePoint(mc, h), b = tr.coordinatePoint(mc, 0); return [a.x - b.x, a.y - b.y]; }
    return {
      su: function (ll) { return tr.coordinatePoint(maplibregl.MercatorCoordinate.fromLngLat([ll.lng, ll.lat]), h); },
      giu: function (x, y) {
        var l = tr.pointLocation(new maplibregl.Point(x, y));
        for (var i = 0; i < 2; i++) { var d = alto(l); l = tr.pointLocation(new maplibregl.Point(x - d[0], y - d[1])); }
        return [l.lng, l.lat];
      }
    };
  }
  // Gruppi sulla distanza vera, niente griglia: con le celle fisse due
  // punti a 5 px in celle vicine restavano icone sovrapposte, due a 45 px nella stessa cella
  // facevano un grappolo, e ogni quarto di zoom rimescolava tutto. Ora un grappolo nasce solo
  // da 3 punti in su le cui icone si coprirebbero oltre un quarto; i punti soli e le coppie
  // restano icone. Poi la spinta stacca i segni che si toccano ancora: chi si sposta di oltre
  // 3 px porta con se' il luogo vero (`vero`), dove resta un puntino.
  function raggruppa(punti, dim) {
    var pr = proiettore(), D = Math.max(dim, 30), soglia = dim * 0.75;
    var pt = punti.map(function (p) { var x = pr.su(p.latlng); return { p: p, x: x.x, y: x.y, preso: false }; });
    var segni = [];
    function icona(e) { segni.push({ punti: [e.p], x0: e.x, y0: e.y, x: e.x, y: e.y - dim / 2, lato: dim, icona: true }); }
    pt.forEach(function (a) {
      if (a.preso) return;
      a.preso = true;
      var g = [a];
      pt.forEach(function (b) { if (!b.preso && Math.abs(b.x - a.x) < soglia && Math.abs(b.y - a.y) < soglia) { b.preso = true; g.push(b); } });
      if (g.length < 3) { g.forEach(icona); return; }
      var x = 0, y = 0;
      g.forEach(function (e) { x += e.x; y += e.y; });
      x /= g.length; y /= g.length;
      segni.push({ punti: g.map(function (e) { return e.p; }), x0: x, y0: y, x: x, y: y, lato: D });
    });
    // dove la spinta non basta (tanti grappoli in poco spazio) un grappolo che ne tocca
    // ancora un altro, o un'icona, se li prende, e si spinge di nuovo
    for (var giro = 0; giro < 12; giro++) {
      spingi(segni);
      var c = toccaGrappolo(segni);
      if (!c) break;
      var a = segni[c[0]], b = segni[c[1]], na = a.punti.length, nb = b.punti.length, n = na + nb;
      segni.splice(c[1], 1);
      segni[c[0]] = { punti: a.punti.concat(b.punti), lato: D,
        x0: (a.x0 * na + b.x0 * nb) / n, y0: (a.y0 * na + b.y0 * nb) / n, x: (a.x * na + b.x * nb) / n, y: (a.y * na + b.y * nb) / n };
    }
    var grappoli = [], icone = [];
    segni.forEach(function (e) {
      // l'icona sta sopra il suo punto (ancora in basso): il centro e' mezza icona piu' su
      var y = e.icona ? e.y + dim / 2 : e.y, mosso = Math.abs(e.x - e.x0) + Math.abs(y - e.y0) > 3;
      if (!e.icona) grappoli.push({ punti: e.punti, pos: pr.giu(e.x, y) });
      else icone.push({ punto: e.punti[0], pos: mosso ? pr.giu(e.x, y) : null, vero: mosso ? [e.punti[0].latlng.lng, e.punti[0].latlng.lat] : null });
    });
    return { grappoli: grappoli, icone: icone };
  }
  function toccaGrappolo(segni) {
    for (var i = 0; i < segni.length; i++) for (var j = i + 1; j < segni.length; j++) {
      var a = segni[i], b = segni[j], min = (a.lato + b.lato) / 2 + 1;
      if ((!a.icona || !b.icona) && Math.abs(a.x - b.x) < min && Math.abs(a.y - b.y) < min) return [i, j];
    }
    return null;
  }
  // Separa i segni (centro e lato in pixel) che si toccano, di quel che basta, in coppia.
  function spingi(segni) {
    for (var giro = 0; giro < 400; giro++) {
      var mosso = false;
      for (var i = 0; i < segni.length; i++) for (var j = i + 1; j < segni.length; j++) {
        var a = segni[i], b = segni[j], min = (a.lato + b.lato) / 2 + 4, dx = b.x - a.x, dy = b.y - a.y;
        if (Math.abs(dx) >= min || Math.abs(dy) >= min) continue;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < 0.01) { var ang = (i + j) * 2.4; dx = Math.cos(ang); dy = Math.sin(ang); d = 1; }
        var passo = (min - d) / 2 + 0.5;
        a.x -= dx / d * passo; a.y -= dy / d * passo; b.x += dx / d * passo; b.y += dy / d * passo;
        mosso = true;
      }
      if (!mosso) return;
    }
  }
  // Il grappolo si apre sul posto: le sue icone in cerchio, a giri se sono tante,
  // un filo verso il centro, il resto in trasparenza. Su telefono bersagli da 44 px. Si
  // richiude col secondo tocco, un tocco sulla mappa, uno zoom, una rotazione.
  function chiudiVentaglio() {
    var v = S && S.ventaglio;
    if (!v) return;
    S.ventaglio = null;
    v.marcatori.forEach(function (m) { m.remove(); });
    S.el.classList.remove("v3d-ventaglio-su");
    ["click", "zoomstart", "rotatestart", "pitchstart"].forEach(function (t) { S.map.off(t, chiudiVentaglio); });
  }
  function apriVentaglio(g, ll, elG, dim) {
    var stesso = S.ventaglio && S.ventaglio.el === elG;
    chiudiVentaglio();
    if (stesso) return;
    var icone = S.opt.icone || {}, passo = Math.max(dim + 8, S.opt.mobile ? 46 : 0), pos = [], r = 0, k = 0;
    // il giro ha il raggio in cui la corda fra due vicine e' il passo; i giri dopo, un passo piu' in la'
    while (k < g.length) {
      r += r ? passo : Math.max(dim + 12, passo / (2 * Math.sin(Math.PI / Math.max(3, Math.min(g.length, 8)))));
      var nel = Math.min(g.length - k, Math.max(1, Math.floor(Math.PI / Math.asin(Math.min(1, passo / (2 * r))))));
      for (var i = 0; i < nel; i++, k++) { var ang = -Math.PI / 2 + 2 * Math.PI * i / nel; pos.push([r * Math.cos(ang), r * Math.sin(ang)]); }
    }
    var base = scostamento(ll, quotaServizi()), lato = Math.ceil(2 * r + dim + 12), c = lato / 2, marcatori = [];
    var fili = document.createElement("div");
    fili.className = "v3d-fili";
    fili.innerHTML = '<svg width="' + lato + '" height="' + lato + '" aria-hidden="true"><circle cx="' + c + '" cy="' + c + '" r="' + (c - 1) + '"/>' +
      pos.map(function (q) { return '<line x1="' + c + '" y1="' + c + '" x2="' + (c + q[0]) + '" y2="' + (c + q[1]) + '"/>'; }).join("") + "</svg>";
    marcatori.push(new maplibregl.Marker({ element: fili, anchor: "center", offset: base }).setLngLat(ll).addTo(S.map));
    g.forEach(function (s, i) {
      var box = document.createElement("div"), el = document.createElement("div");
      box.className = "v3d-servizio v3d-ventaglio";
      box.appendChild(el);
      el.className = "servizio-marker" + (S.opt.riduciMovimento ? "" : " servizio-balzo") + (s.props.prevista ? " servizio-prevista" : "");
      el.setAttribute("style", "width:" + dim + "px;height:" + dim + "px;" + (S.opt.riduciMovimento ? "" : "animation-delay:" + Math.min(i * 25, 300) + "ms;"));
      el.setAttribute("data-categoria", s.props.categoria);
      el.innerHTML = svgUnica(icone[s.props.categoria]);
      el.addEventListener("click", function (ev) { ev.stopPropagation(); apriServizio(s, el); });
      marcatori.push(new maplibregl.Marker({ element: box, anchor: "center", offset: [base[0] + pos[i][0], base[1] + pos[i][1]] }).setLngLat(ll).addTo(S.map));
    });
    S.el.classList.add("v3d-ventaglio-su");
    S.ventaglio = { el: elG, marcatori: marcatori };
    ["click", "zoomstart", "rotatestart", "pitchstart"].forEach(function (t) { S.map.on(t, chiudiVentaglio); });
    // se esce dallo schermo, la mappa scorre quel che basta (lo scorrimento non lo chiude)
    var b = S.el.getBoundingClientRect(), e = elG.getBoundingClientRect(), mx = e.left + e.width / 2 - b.left, my = e.top + e.height / 2 - b.top, m = lato / 2 + 8;
    var sx = Math.min(0, mx - m) + Math.max(0, mx + m - b.width), sy = Math.min(0, my - m - 60) + Math.max(0, my + m - b.height);
    if (sx || sy) S.map.panBy([sx, sy], { duration: S.opt.riduciMovimento ? 0 : 300 });
  }
  function apriServizio(s, el) {
    if (S.opt.schedaServizio) { chiudiPopup(); S.opt.schedaServizio(s.props, s.latlng, el); return; }
    popup(el, testoServizio({ nome: s.props.nome, ind: s.props.indirizzo, prevista: s.props.prevista,
      chiusa: !!(s.props.info && s.props.info.l), cat: s.props.categoria }), false);
  }
  // Allo zoom d'arrivo durante il volo; si rifanno solo quando cambia lo zoom.
  function disegnaServizi(conBalzo) {
    togliMarcatori();
    if (S.modoServizi === "municipio") { contaNelleEtichette(); return 0; }
    var icone = S.opt.icone || {};
    var punti = (S.puntiFocus || []).filter(function (s) { return S.opt.attive[s.props.categoria] && icone[s.props.categoria]; });
    if (!punti.length) return 0;
    var z = S.zoomArrivo != null ? S.zoomArrivo : S.map.getZoom(), dim = dimensioneIcona(z);
    var gruppi = raggruppa(punti, dim);
    var voci = gruppi.icone.map(function (i) { return { g: [i.punto], pos: i.pos, vero: i.vero }; })
      .concat(gruppi.grappoli.map(function (c) { return { g: c.punti, pos: c.pos }; }));
    var animo = conBalzo && !S.opt.riduciMovimento;
    voci.forEach(function (v, idx) {
      // involucro per il Marker (MapLibre lo posiziona con transform), dentro l'elemento
      // della 2D, il cui balzo anima a sua volta transform
      var g = v.g, box = document.createElement("div"), el = document.createElement("div"), ll, ancora, d;
      box.className = "v3d-servizio";
      box.appendChild(el);
      // stessa cascata della 2D (ritardoBalzo nel template): 30 ms l'uno, al massimo 450
      var ritardo = animo ? "animation-delay:" + Math.min(idx * 30, 450) + "ms;" : "";
      if (g.length === 1) {
        var s = g[0];
        ll = v.pos || [s.latlng.lng, s.latlng.lat]; ancora = "bottom";
        el.className = "servizio-marker" + (animo ? " servizio-balzo" : "") + (s.props.prevista ? " servizio-prevista" : "");
        el.setAttribute("style", "width:" + dim + "px;height:" + dim + "px;" + ritardo);
        el.setAttribute("data-categoria", s.props.categoria);
        el.innerHTML = svgUnica(icone[s.props.categoria]);
        el.addEventListener("click", function (ev) { ev.stopPropagation(); apriServizio(s, el); });
      } else {
        var lat = 0, lng = 0;
        g.forEach(function (p) { lat += p.latlng.lat; lng += p.latlng.lng; });
        ll = v.pos || [lng / g.length, lat / g.length]; ancora = "center"; d = Math.max(dim, 30);
        el.className = "servizio-cluster" + (animo ? " servizio-balzo" : "");
        el.setAttribute("style", "width:" + d + "px;height:" + d + "px;" + ritardo);
        // la cartella della 2D (htmlGrappolo), col pallino del numero; senza, il numero solo
        if (S.opt.grappolo) el.innerHTML = S.opt.grappolo(g); else el.textContent = g.length;
        el.addEventListener("click", function (ev) { ev.stopPropagation(); apriVentaglio(g, ll, el, dim); });
      }
      var marker = new maplibregl.Marker({ element: box, anchor: ancora }).setLngLat(ll).addTo(S.map);
      S.marcatori.push({ marker: marker, el: el, ll: ll });
      // l'icona spostata dalla spinta: un puntino resta sul luogo vero
      if (v.vero) {
        var pun = document.createElement("div");
        pun.className = "v3d-vero";
        S.marcatori.push({ marker: new maplibregl.Marker({ element: pun, anchor: "center" }).setLngLat(v.vero).addTo(S.map), el: pun, ll: v.vero });
      }
    });
    S.zoomDisegno = Math.round(z * 4) / 4;
    quota();
    return punti.length;
  }
  function togliServizi() {
    S.puntiFocus = null;
    togliMarcatori();
  }
  function conServizi(filtro, fn) {
    var gen = S.gen, mio = S;
    // la promessa unica dei dati della 2D (anche se l'ha avviata la precarica in idle)
    Promise.resolve(S.opt.servizi ? S.opt.servizi() : null).then(function (dati) {
      if (S !== mio || S.gen !== gen) return;
      if (!dati) { segnaPronta("servizi"); return; }
      fn(dati.filter(filtro));
    }).catch(function () { if (S === mio) segnaPronta("servizi"); });
  }
  function mostraServizi(punti, modo) {
    S.modoServizi = modo;
    S.puntiFocus = punti;
    disegnaServizi(true);
    // pronta a balzo finito (0,3 s piu' lo sfalsamento massimo di 180 ms, come la 2D)
    dopo(modo === "municipio" ? 0 : 500, function () { segnaPronta("servizi"); disponiEtichette(); });
  }
  // Ridisegno quando cambia lo zoom (come la 2D): misura e gruppi seguono la scala.
  function zoomCambiato() {
    if (!S.marcatori || !S.marcatori.length || S.zoomArrivo != null) return;
    if (Math.round(S.map.getZoom() * 4) / 4 !== S.zoomDisegno) disegnaServizi(false);
  }

  // ---------- etichette delle aree (vista municipio) ----------
  // Stessa pillola delle etichette della 2D (.area-label), sulla tessera; se due si
  // toccano resta la piu' grande.
  function togliEtichette() {
    (S.etichette || []).forEach(function (e) { e.marker.remove(); });
    S.etichette = [];
  }
  function mostraEtichette(codici, quotaM) {
    togliEtichette();
    S.quotaEtichette = quotaM || 0;
    S.etichette = codici.map(function (k) {
      var e = cache.byCode[k], el = document.createElement("div");
      el.className = "area-label v3d-etichetta" + (S.livello === "municipio" ? " v3d-cliccabile" : "");
      el.setAttribute("data-tipo", e.p.tipo || "");
      el.setAttribute("data-codice", k);
      // il numero dei servizi accesi nell'area: lo stesso disco amaranto dei grappoli
      el.innerHTML = "<span>" + esc(e.p.denominazione) + '<b class="v3d-conta" hidden></b></span>';
      if (S.livello === "municipio") el.firstChild.addEventListener("click", function (ev) { ev.stopPropagation(); scegli({ tipo: "area", codice: k }); });
      var centro = e.centro || (e.centro = puntoInterno(e.g));
      var marker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(centro).addTo(S.map);
      return { k: k, el: el, marker: marker, ll: centro, sup: e.p.superficie_kmq || 0,
               h: S.livello === "municipio" ? (H_TIPO[e.p.tipo] || H_TIPO.QUARTIERE) : 0 };
    });
    quota();
    contaNelleEtichette();
  }
  function contaNelleEtichette() {
    if (!S.etichette || !S.etichette.length) return;
    var conte = {};
    if (S.modoServizi === "municipio") (S.puntiFocus || []).forEach(function (s) {
      if (S.opt.attive[s.props.categoria] && S.opt.icone && S.opt.icone[s.props.categoria]) conte[s.props.codice_area] = (conte[s.props.codice_area] || 0) + 1;
    });
    S.etichette.forEach(function (e) {
      var b = e.el.querySelector(".v3d-conta"), n = conte[e.k] || 0;
      b.hidden = !n; b.textContent = n ? numero(n) : "";
    });
    disponiEtichette();
  }
  // Un'etichetta non copre mai cartiglio, scheda, pulsanti, icone o grappoli dei servizi.
  function disponiEtichette() {
    if (!S || !S.etichette || !S.etichette.length) return;
    if (S.livello === "roma") { disponiTarghette(); return; }
    var prese = [], W = S.el.clientWidth, H = S.el.clientHeight, base0 = S.el.getBoundingClientRect();
    [S.ui.cart, S.ui.reset].forEach(function (el) {
      if (!el || el.hidden) return;
      var r = el.getBoundingClientRect();
      if (r.width) prese.push([r.left - base0.left, r.top - base0.top, r.right - base0.left, r.bottom - base0.top]);
    });
    // la scheda su telefono entra dal basso con una transizione: conta dove arriva
    var sch = schedaSopra();
    if (sch) prese.push([sch.offsetLeft, S.opt.mobile ? H - sch.offsetHeight : sch.offsetTop, sch.offsetLeft + sch.offsetWidth, H]);
    (S.marcatori || []).forEach(function (m) {
      var r = m.el.getBoundingClientRect();
      prese.push([r.left - base0.left, r.top - base0.top, r.right - base0.left, r.bottom - base0.top]);
    });
    S.etichette.slice().sort(function (a, b) { return b.sup - a.sup; }).forEach(function (e) {
      e.el.style.visibility = "";
      var r = e.el.firstChild.getBoundingClientRect(), base = S.el.getBoundingClientRect();
      var x0 = r.left - base.left, y0 = r.top - base.top, x1 = x0 + r.width, y1 = y0 + r.height;
      var fuori = x0 < 4 || y0 < 4 || x1 > W - 4 || y1 > H - 4;   // mai un'etichetta tagliata dal bordo
      var tocca = prese.some(function (q) { return x0 < q[2] + 4 && q[0] < x1 + 4 && y0 < q[3] + 2 && q[1] < y1 + 2; });
      if (fuori || tocca) e.el.style.visibility = "hidden"; else prese.push([x0, y0, x1, y1]);
    });
  }

  // ---------- targhette dei municipi (Roma) ----------
  // A Roma si sceglie un municipio: una targhetta per municipio (la stessa pillola, numero
  // romano; su desktop col nome), su un punto interno, alla quota dell'area che ci sta sotto.
  // Toccata, porta al municipio come un tocco sulle sue aree.
  // Posti possibili della targhetta di m: il punto interno, poi i punti di una griglia dentro
  // il municipio dal piu' vicino; ognuno con l'area che ci sta sotto (la sua quota a Roma).
  function postiMun(m) {
    if (!cache.munPosti) cache.munPosti = {};
    if (cache.munPosti[m]) return cache.munPosti[m];
    var g = cache.munGeo[m], c = puntoInterno(g), b = cache.munBox[m], punti = [], N = 24;
    if (!c) return (cache.munPosti[m] = []);
    for (var i = 1; i < N; i++) for (var j = 1; j < N; j++) {
      var x = b[0] + (b[2] - b[0]) * i / N, y = b[1] + (b[3] - b[1]) * j / N;
      if (poligoni(g).some(function (pol) { return dentro(pol, x, y); })) punti.push([x, y]);
    }
    var d = function (q) { return (q[0] - c[0]) * (q[0] - c[0]) + (q[1] - c[1]) * (q[1] - c[1]); };
    punti.sort(function (p, q) { return d(p) - d(q); });
    return (cache.munPosti[m] = [c].concat(punti).map(function (ll) {
      var sotto = null;
      (cache.perMun[m] || []).some(function (k) {
        var bb = cache.byCode[k].box;
        if (ll[0] < bb[0] || ll[0] > bb[2] || ll[1] < bb[1] || ll[1] > bb[3]) return false;
        return poligoni(cache.byCode[k].g).some(function (pol) { return dentro(pol, ll[0], ll[1]) && (sotto = k); });
      });
      return { ll: ll, k: sotto };
    }));
  }
  function mostraTarghette() {
    togliEtichette();
    S.quotaEtichette = 0;
    var nomi = S.opt.romani || {};
    S.etichette = Object.keys(cache.munGeo).map(Number).sort(function (a, b) { return a - b; }).map(function (m) {
      var posti = postiMun(m), c = posti[0], el = document.createElement("div"), kmq = 0;
      if (!c) return null;
      (cache.perMun[m] || []).forEach(function (k) { kmq += cache.byCode[k].p.superficie_kmq || 0; });
      el.className = "area-label v3d-etichetta v3d-cliccabile v3d-targa" + (S.hovM === m ? " v3d-su" : "");
      el.setAttribute("data-municipio", m);
      el.style.setProperty("--mun", colore(m));
      // su telefono il solo numero: quindici nomi interi in 390 px si coprirebbero
      el.innerHTML = "<span>" + (S.opt.mobile ? "" : '<i class="v3d-targa-nome">Municipio</i>') + esc(nomi[String(m)] || String(m)) + "</span>";
      el.firstChild.addEventListener("click", function (ev) { ev.stopPropagation(); scegli({ tipo: "municipio", arabo: m }); });
      if (!S.opt.mobile) {
        el.firstChild.addEventListener("mouseenter", function () { evidenzia(m); });
        el.firstChild.addEventListener("mouseleave", function () { evidenzia(null); });
      }
      var marker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(c.ll).addTo(S.map);
      return { k: "m" + m, el: el, marker: marker, ll: c.ll, sup: kmq, h: 0, kRoma: c.k, posti: posti };
    }).filter(Boolean);
    quota();
    disponiEtichette();
  }
  // Tutte e quindici, mai una sull'altra: dalla piu' piccola (i municipi del centro hanno
  // meno spazio) ognuna prende il primo posto libero, intero nello schermo e fuori da
  // cartiglio e pulsanti; senza posto resta nascosta. Si rifa' a camera ferma.
  function disponiTarghette() {
    var W = S.el.clientWidth, H = S.el.clientHeight, base = S.el.getBoundingClientRect(), prese = [];
    [S.ui.cart, S.ui.reset].forEach(function (el) {
      if (!el || el.hidden) return;
      var r = el.getBoundingClientRect();
      if (r.width) prese.push([r.left - base.left, r.top - base.top, r.right - base.left, r.bottom - base.top]);
    });
    S.etichette.slice().sort(function (a, b) { return a.sup - b.sup; }).forEach(function (e) {
      var r = e.el.firstChild.getBoundingClientRect(), w = r.width / 2 + 3, h = r.height / 2 + 2, scelto = null;
      var libero = function (x, y) {
        var q = [x - w, y - h, x + w, y + h];
        if (q[0] < 4 || q[1] < 4 || q[2] > W - 4 || q[3] > H - 4) return false;
        if (prese.some(function (t) { return q[0] < t[2] && t[0] < q[2] && q[1] < t[3] && t[1] < q[3]; })) return false;
        prese.push(q); return true;
      };
      e.posti.some(function (c) {
        var p = S.map.project(c.ll), o = scostamento(c.ll, (S.romaH[c.k] || 0) + 3);
        if (libero(p.x + o[0], p.y + o[1])) { scelto = c; return true; }
        return false;
      });
      // un municipio piccolo da lontano (il I a 320 px): la targhetta si scosta di poco dal
      // suo punto, anche oltre il confine, prima di sparire
      var c0 = e.posti[0];
      if (!scelto && c0) {
        var p0 = S.map.project(c0.ll), o0 = scostamento(c0.ll, (S.romaH[c0.k] || 0) + 3);
        [1.2, 2.2, 3.2].some(function (k) {
          return [0, 1, 2, 3, 4, 5, 6, 7].some(function (i) {
            var a = i * Math.PI / 4, dx = Math.cos(a) * w * k, dy = Math.sin(a) * h * k;
            if (!libero(p0.x + o0[0] + dx, p0.y + o0[1] + dy)) return false;
            var ll = S.map.unproject([p0.x + dx, p0.y + dy]);
            scelto = { ll: [ll.lng, ll.lat], k: c0.k };
            return true;
          });
        });
      }
      e.el.style.visibility = scelto ? "" : "hidden";
      if (scelto && scelto.ll !== e.ll) { e.ll = scelto.ll; e.kRoma = scelto.k; e.marker.setLngLat(scelto.ll); }
    });
    quota();
  }

  // Colori dell'evidenza: le tessere in rilievo (colHov) e, a Roma piatta, le aree a terra.
  // Uno stato `hov` per area, mai un'espressione cambiata a ogni passaggio del mouse.
  function preparaEvidenza() {
    var hov = ["boolean", ["feature-state", "hov"], false], chiari = ["match", ["get", "m"]];
    S.opt.palette.forEach(function (col, i) { chiari.push(i + 1, schiarisci(col, EVIDENZA)); });
    chiari.push(schiarisci("#9aa0a6", EVIDENZA));
    var col = ["case", hov, ["get", "colHov"], ["get", "col"]];
    // col mosaico: dal crema (c 0, il fantasma che cade) al colore di sempre (c 1 o assente:
    // l'interpolazione all'ultimo passo restituisce esattamente quello). Scritta qui, prima
    // delle tessere: nessun ricalcolo dopo.
    if (S.ingresso) col = ["interpolate", ["linear"], ["coalesce", ["feature-state", "c"], 1], 0, MOSAICO.crema, 1, col];
    S.map.setPaintProperty("roma-ext", "fill-extrusion-color", col);
    S.map.setPaintProperty("aree-fill", "fill-color", ["case", hov, chiari, S.colMun]);
  }
  // Il municipio m sotto il mouse (null: nessuno). Solo a Roma, solo desktop.
  function evidenzia(m) {
    if (!S || !S.map) return;
    if (m != null && (S.livello !== "roma" || S.opt.mobile)) m = null;
    if (S.hovM === m) return;
    var segna = function (mm, v) {
      (cache.perMun[mm] || []).forEach(function (k) {
        S.map.setFeatureState({ source: "roma", id: k }, { hov: v });
        S.map.setFeatureState({ source: "aree", id: k }, { hov: v });
      });
    };
    if (S.hovM != null) segna(S.hovM, false);
    S.hovM = m;
    if (m != null) segna(m, true);
    S.etichette.forEach(function (e) { if (e.kRoma !== undefined) e.el.classList.toggle("v3d-su", e.k === "m" + m); });
  }

  // Pronta quando sono finite tutte le parti del passaggio (tessere, focus, servizi).
  function segnaPronta(parte) {
    if (!S) return;
    if (parte) delete S.manca[parte];
    if (Object.keys(S.manca).length) return;
    S.pronta = true; S.el.setAttribute("data-stato", "pronta");
  }
  function segnaInVolo() { S.pronta = false; S.el.setAttribute("data-stato", "volo"); }

  // Aree vicine (coi tipi accesi): il loro riquadro tocca quello dell'area allargato del
  // 30% (15% per lato). Di qualunque municipio: ci si orienta come nella 2D.
  function vicineDi(codice) {
    var e = cache.byCode[codice];
    if (!e.vicine) {
      var b = e.box, dx = (b[2] - b[0]) * 0.15, dy = (b[3] - b[1]) * 0.15, x = [b[0] - dx, b[1] - dy, b[2] + dx, b[3] + dy];
      e.vicine = Object.keys(cache.byCode).filter(function (k) {
        var q = cache.byCode[k].box;
        return k !== codice && q[0] <= x[2] && q[2] >= x[0] && q[1] <= x[3] && q[3] >= x[1];
      });
    }
    return e.vicine.filter(tipoAttivo);
  }

  // ---------- applicazione di una selezione ----------
  function applica(sel) {
    // una selezione mentre l'ingresso dall'intro e' in piedi (prima del via o a mosaico in
    // corso): il mosaico lascia subito il posto alla 3D di sempre, poi si va dove si deve
    if (S.mosaico && S.mosaico.stato !== "via" && S.mosaico.stato !== "finito") chiudiMosaico(false);
    S.gen++;
    S.timer.forEach(clearTimeout); S.timer = [];
    S.sel = sel;
    S.romaFermo = null;
    if (S.focus) S.focus.su = false;
    segnaInVolo();
    chiudiPopup();
    togliServizi();
    togliEtichette();
    evidenzia(null);
    S.modoServizi = sel.tipo === "roma" ? null : sel.tipo;
    S.zoomArrivo = null;
    var c = cache, map = S.map, vis = {}, codes = Object.keys(c.byCode);
    S.ui.reset.hidden = sel.tipo === "roma";
    var m = sel.tipo === "roma" ? -1 : (sel.tipo === "municipio" ? sel.arabo : c.byCode[sel.codice].m);
    map.setPaintProperty("mun-focus", "line-opacity", ["case", ["==", ["get", "m"], m], 1, 0]);

    // fuori dall'area la tessera del focus scende: "pronta" la aspetta (con la visibilita'
    // gia' a posto, come dopo un tipo spento, le tessere sarebbero pronte subito)
    var giuFocus = sel.tipo !== "area" && S.focus;
    var focusGiu = function () {
      if (!giuFocus) return;
      S.manca.focus = 1;
      abbassaFocus(function () { svuotaFocus(); segnaPronta("focus"); });
    };
    // fuori dalla vista municipio il municipio alzato scende (la sorgente resta, a k 0)
    if (sel.tipo !== "municipio") abbassaMun();

    // come applicaFiltri della 2D: i tipi spenti spariscono a ogni livello, e nella vista
    // municipio anche le aree degli altri municipi
    codes.forEach(function (k) { vis[k] = tipoAttivo(k) && (sel.tipo !== "municipio" || c.byCode[k].m === m) ? 1 : 0; });

    if (sel.tipo === "roma") {
      S.livello = "roma";
      veloGiu();
      // L'ingresso di prima: dall'alto, piatta e col nord in alto, la camera si inclina e
      // ruota mentre le aree si alzano per tipo; tutta nello schermo sopra il cartiglio
      // (tetti compresi). Tornando da un municipio o da un'area si sale dopo la discesa
      // della loro tessera.
      if (S.mosaico && S.mosaico.stato === "via") {
        // dall'intro: il mosaico al posto di camera, visibilita' e crescita di sempre; il
        // cartiglio esce a citta' composta, targhette e pronta a discesa finita
        S.manca = { mosaico: 1 };
        avviaMosaico();
        fuoriArea();
        return;
      }
      var attesa = (giuFocus || S.munK > 0) ? 450 : 0;
      S.manca = {};
      cameraRoma(); S.manca.tessere = 1; S.manca.roma = 1;
      focusGiu();
      visibilita(vis, 900, function () { segnaPronta("tessere"); });
      // le targhette dei municipi escono a crescita finita
      dopo(attesa, function () { romaSu(ROMA_DURATA, function () { mostraTarghette(); segnaPronta("roma"); }); });
      fuoriArea();
      cartiglioRoma();
      return;
    }

    var rom = S.opt.romani[String(m)] || String(m);

    if (sel.tipo === "municipio") {
      S.livello = "municipio";
      fuoriArea();
      var kmq = 0, n = 0;
      codes.forEach(function (k) {
        var e = c.byCode[k];
        if (e.m === m) { kmq += e.p.superficie_kmq || 0; n++; }
      });
      // il fuori del municipio si scurisce col velo della 2D, le sue aree si alzano per tipo
      veloSu(c.munGeo[m], 1200);
      romaGiu();
      // tutto il municipio nello schermo, sopra il cartiglio (anche su desktop: con lo zoom
      // in piu' di prima i municipi lunghi uscivano dallo schermo)
      var zm = cameraMunicipio(m, pitchMunicipio(), 14);
      var mppM = 78271.5 * Math.cos((c.munBox[m][1] + c.munBox[m][3]) / 2 * Math.PI / 180) / Math.pow(2, zm);
      S.munKt = mppM * MUN_PARETE / H_TIPO.RIONE;          // MUN_PARETE px di altezza per il rione
      S.munW = Math.max(6, Math.round(mppM * 2.2));       // contorno di ~2 px sul tetto
      // come la 2D: i servizi escono nell'ultimo tratto (65%), non a passaggio finito
      S.manca = { tessere: 1, servizi: 1, mun: 1 };
      focusGiu();
      visibilita(vis, 2100, function () { segnaPronta("tessere"); });
      S.munFino = performance.now() + 1100;               // la camera e' quasi arrivata
      municipioSu(m, 1100);
      dopo(1365, function () {
        conServizi(function (p) { return p.props.municipio === rom; }, function (punti) { mostraServizi(punti, "municipio"); });
      });
      cartiglio("Municipio " + rom, "<b>" + n + "</b> aree · <b>" + esc(km2(kmq)) + "</b>", true);
      return;
    }

    // area
    S.livello = "area";
    var e = c.byCode[sel.codice], p = e.p, col = colore(m);
    // la scheda della 2D si riempie prima della camera: l'inquadratura ne conosce l'ingombro
    nascondiCartiglio();
    S.inArea = true;
    if (S.opt.onArea) S.opt.onArea(p);
    veloSu(e.g, 1200);
    // da Roma in rilievo: tutte scendono, tranne l'area scelta, che la tessera del focus
    // prende in consegna alla sua quota (come dal municipio alzato)
    if ((S.romaH[sel.codice] || 0) > 0) S.romaFermo = sel.codice;
    romaGiu();
    // la tessera intera (piede e tetto) nello spazio libero, sopra il cartiglio: anche le
    // aree lunghe e strette, che cameraForBounds sull'inclinata tagliava
    var z = inquadra(e.g, e.box, pitchFocus(), 16.2, 12, function (zz) { return altezzaArea(e, zz); });
    S.zoomArrivo = S.opt.riduciMovimento ? null : z;
    var mpp = mppA((e.box[1] + e.box[3]) / 2, z);
    var H = altezzaArea(e, z);
    var W = Math.max(2, mpp * 4.5);                     // bordo di ~4,5 px
    // la carta del tetto si carica subito, mentre la tessera di prima scende
    var carta = S.carta && S.focus && S.focus.codice === sel.codice ? S.carta : caricaCarta(e, col, z, W);
    S.manca = { focus: 1, servizi: 1 };
    visibilita(vis, 1500);
    var gen = S.gen;
    // i nomi delle aree vicine, di qualunque municipio come la 2D: escono a camera quasi
    // arrivata, anche quando la visibilita' non cambia (area -> area)
    dopo(1500, function () { if (S.sel === sel) mostraEtichette(vicineDi(sel.codice), 0); });
    var servizi = function () {
      conServizi(function (s) { return s.props.codice_area === sel.codice; }, function (punti) { mostraServizi(punti, "area"); });
    };
    // La tessera parte subito, mentre la camera vola (prima aspettava 900 ms fissi, piu' la
    // discesa di quella di prima: il tocco sembrava non arrivare). Da h0: 0, o la quota
    // della stessa area nel municipio alzato.
    var cresci = function (h0) {
      if (S.gen !== gen) return;
      tween("focus", 1400, function (k) { altezzaFocus(h0 + (H - h0) * k); }, function () { focusSu(function () { segnaPronta("focus"); }); }, easeBack);
      dopo(1200, servizi);
    };
    var t0 = performance.now();
    if (S.focus && S.focus.codice === sel.codice && S.focusH > 0) {
      // stessa area (es. tornando dall'elenco): la tessera resta su
      var da = S.focusH;
      S.focus.H = H;
      tween("focus", 600, function (k) { altezzaFocus(da + (H - da) * k); }, function () {
        focusSu(function () { segnaPronta("focus"); servizi(); });
      });
    } else {
      // la tessera di prima passa alla uscente e scende mentre questa sale; se la uscente
      // non e' pronta (cambi a raffica) scende prima lei, poi si cambia forma
      var cambia = function () {
        if (S.gen !== gen) return;
        S.focus = { codice: sel.codice, H: H }; S.carta = carta;
        // la via cambiata fra il carico della carta e questo momento (tile gia' in cache)
        if (carta.viaUsata !== S.via) carta.rifai();
        map.getSource("focus").setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: { codice: sel.codice, col: col }, geometry: e.g }] });
        altezzaFocus(0);
        // Si sale con la forma nuova nelle tessere della sorgente (setData e' asincrono): nei
        // voli lunghi (un'area lontana, su telefono) il worker la rifa' anche dopo 3 s, e
        // partendo a tempo fisso (900 ms) la carta restava sospesa senza pareti, poi la tessera
        // spuntava di colpo a meta' altezza. Un'area fuori schermo parte quando la camera la
        // raggiunge. Le tessere ancora da rifare tengono la forma di prima: si aspetta solo se
        // quell'area e' nell'inquadratura (salirebbe lei); fuori, MapLibre le rifa' per ultime.
        var inVista = function (k) {
          var e = cache.byCode[k], v = map.getBounds(), mx = (v.getEast() - v.getWest()) * 0.2, my = (v.getNorth() - v.getSouth()) * 0.2;
          return !e || !(e.box[2] < v.getWest() - mx || e.box[0] > v.getEast() + mx || e.box[3] < v.getSouth() - my || e.box[1] > v.getNorth() + my);
        };
        var nuova = function (id) {
          var fs = map.querySourceFeatures(id), c;
          return fs.some(function (f) { return f.properties.codice === sel.codice; }) &&
            fs.every(function (f) { c = f.properties.codice; return c === sel.codice || !inVista(c); });
        };
        var focus = S.focus;
        var forma = function () { return nuova("focus"); };
        var dalMun = S.munK > 0 && S.munCodici.indexOf(sel.codice) >= 0, lontana = null;
        var parti = function () {
          if (S.gen !== gen) return;
          var ora = performance.now() - t0;
          // un'area fuori dall'inquadratura (un volo lungo) aspetta anche la carta: il ritardo
          // non si vede; in vista parte subito (il tocco deve arrivare), al piu' col tetto a colore pieno.
          // Si decide al primo giro, con la camera ancora alla partenza: nel volo l'area entra
          // in vista prima che la carta arrivi.
          if (lontana == null) lontana = !inVista(sel.codice);
          if (!forma() && ora < ATTESA_FORMA) { requestAnimationFrame(parti); return; }
          if (lontana && !carta.finita && ora < ATTESA_CARTA) { requestAnimationFrame(parti); return; }
          // ripiego oltre ATTESA_FORMA: si sale, la carta aspetta le pareti (strCarta)
          focus.forma = forma();
          if (!focus.forma) (function guarda() {
            if (S.focus !== focus) return;
            if (forma()) { focus.forma = true; map.triggerRepaint(); } else requestAnimationFrame(guarda);
          })();
          var h0 = 0;
          if (S.romaFermo === sel.codice) {
            // nello stesso fotogramma la sua tessera di Roma sparisce e il focus prende il posto
            h0 = S.romaH[sel.codice] || 0;
            var zero = {}; zero[sel.codice] = 0; scriviRoma(zero);
          } else if (dalMun && S.munK > 0) {
            // nello stesso fotogramma la sua tessera del municipio sparisce e il focus prende il posto
            h0 = (H_TIPO[p.tipo] || H_TIPO.QUARTIERE) * S.munK;
            S.munFuori = sel.codice; altezzaMun(S.munK);
          }
          cresci(h0);
        };
        parti();
        preparaGiu();
      };
      if (giuPronta()) { passaAllaUscente(); cambia(); } else abbassaFocus(cambia, 250);
    }
  }
  function cartiglioRoma() {
    cartiglio("Roma", "<b>15</b> municipi · <b>" + numero(Object.keys(cache.byCode).length) + "</b> aree · <b>" + esc(numero(Math.round(cache.kmqRoma)) + " km²") + "</b>");   // interi, come testata e 2D
  }
  // Uscita dal livello area: la scheda della 2D se ne va.
  function fuoriArea() {
    if (!S.inArea) return;
    S.inArea = false;
    if (S.opt.onArea) S.opt.onArea(null);
  }

  // Filtri per tipo cambiati nella 2D (pulsanti Rioni, Quartieri, Zone funzionali). Cambia
  // solo cio' che dipende dai tipi, ferma o in volo: la visibilita' delle aree, le etichette
  // e, nella vista municipio, le tessere alzate (scendono, cambiano, risalgono). Camera,
  // focus e servizi non si toccano: in volo continuano il loro passaggio.
  function filtraTipi(attivi) {
    if (!S) return;
    var nuovi = copiaTipi(attivi);
    if (chiaveTipi(nuovi) === chiaveTipi(S.tipi)) return;
    S.tipi = nuovi;
    if (!S.map || !S.map.getLayer("aree-fill") || !S.sel) return;   // la prima selezione li legge
    // a mosaico in corso (l'interfaccia e' nascosta dall'intro: un caso limite) si arriva
    // prima alla Roma di sempre, poi i tipi cambiano come a riposo
    if (S.mosaico && S.mosaico.stato === "corso") chiudiMosaico(true);
    var sel = S.sel, c = cache, vis = {};
    var m = sel.tipo === "municipio" ? sel.arabo : (sel.tipo === "area" ? c.byCode[sel.codice].m : -1);
    Object.keys(c.byCode).forEach(function (k) { vis[k] = tipoAttivo(k) && (sel.tipo !== "municipio" || c.byCode[k].m === m) ? 1 : 0; });
    // a riposo si riapre un passaggio breve; in volo le parti ancora in corso restano in
    // S.manca e si aggiungono quelle rifatte qui (la fine della visibilita' di prima e
    // l'eventuale crescita del municipio sono sostituite da queste)
    if (S.pronta) { segnaInVolo(); S.manca = {}; }
    togliEtichette();
    S.manca.tessere = 1;
    if (sel.tipo === "municipio") { S.manca.mun = 1; municipioSu(m, Math.max(0, (S.munFino || 0) - performance.now())); }
    if (sel.tipo === "roma") { S.manca.roma = 1; romaSu(500, function () { if (S.sel === sel) mostraTarghette(); segnaPronta("roma"); }); }
    visibilita(vis, 500, function () {
      if (sel.tipo === "area" && S.sel === sel) mostraEtichette(vicineDi(sel.codice), 0);
      segnaPronta("tessere");
    });
  }

  // Caselle del pannello Servizi della 2D cambiate (opt.attive e' lo stesso oggetto): si
  // ridisegnano i servizi gia' caricati, senza balzo; in volo li rifa' l'arrivo.
  function attiveCambiate() {
    if (!S || !S.map || !S.puntiFocus) return;
    chiudiPopup();
    disegnaServizi(false);
  }

  // Scelta fatta dentro la 3D: si applica e si comunica alla 2D.
  function scegli(sel) {
    applica(sel);
    if (S.opt.onSeleziona) S.opt.onSeleziona(sel);
  }

  // Toccabile solo cio' che si vede: tipo acceso e area non spenta dal livello (nel
  // municipio le aree degli altri municipi sono a vis 0, inerti come nella 2D).
  function toccabile(k) { return !!k && tipoAttivo(k) && !!S.st[k] && S.st[k].vis === 1; }
  // Strati toccabili: a Roma anche le tessere in rilievo (il tocco cade sul tetto visto).
  function strati() {
    return (S.romaSu ? ["roma-ext"] : []).concat(["focus-wall", "mun-ext", "aree-fill", "aree-retino"]);
  }
  function suClick(ev) {
    var map = S.map;
    chiudiPopup();
    var f = map.queryRenderedFeatures(ev.point, { layers: strati() })
      .filter(function (x) { return x.properties && toccabile(x.properties.codice); })[0];
    if (!f) return;
    var e = cache.byCode[f.properties.codice];
    if (!e) return;
    // a Roma si sceglie il municipio (la sua vista, con le aree toccabili); dal municipio
    // in giu' il tocco entra nell'area. Elenco, ricerca e link portano sempre all'area.
    if (S.livello === "roma") scegli({ tipo: "municipio", arabo: e.m });
    else if (!(S.livello === "area" && S.sel.codice === f.properties.codice)) scegli({ tipo: "area", codice: f.properties.codice });
  }

  function valida(sel) {
    if (sel && sel.tipo === "area" && cache.byCode[sel.codice]) return { tipo: "area", codice: sel.codice };
    if (sel && sel.tipo === "municipio" && cache.munBox[sel.arabo]) return { tipo: "municipio", arabo: sel.arabo };
    return { tipo: "roma" };
  }

  // definitivo=false: l'errore e' di questo tentativo, il tasto 3D resta (si puo' riprovare)
  function errore(msg, definitivo) {
    var cb = S && S.opt.onErrore;
    chiudi();
    if (cb) cb(msg, definitivo !== false);
  }

  // ---------- API ----------
  function supportato() {
    try {
      var c = document.createElement("canvas");
      var gl = window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl"));
      if (!gl) return false;
      var lose = gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
      return true;
    } catch (e) { return false; }
  }

  function apri(opt) {
    if (S) chiudi();
    var c = prepara(opt);
    S = { opt: opt, el: opt.contenitore, reg: registro(opt), gen: 0, timer: [], tween: {}, st: {}, t: 1, sel: null, livello: "",
          pronta: false, map: null, ui: null, puntiFocus: null, focus: null, focusH: 0, etichette: [], marcatori: [], zoomArrivo: null,
          giu: { codice: null, carta: null, h: 0 }, via: viaValida(opt.via),
          tipi: copiaTipi(opt.tipiAttivi), munK: 0, munM: null, munCodici: [], munChiave: "", munKt: 0, munW: 10, munGen: 0, munFino: 0,
          romaH: {}, romaSu: false, romaFermo: null, hovM: null, veloOp: {}, veloG: {}, veloSalti: 0 };
    // Con l'intro c'e' sempre il mosaico, anche se la 3D arriva a intro finita (attesa scaduta,
    // intro saltata): senza disegno la camera parte dall'inquadratura piatta di Roma della
    // creazione (posaIngresso non trova il disegno), e parti(true) o salta() decidono il resto.
    S.ingresso = opt.ingresso && opt.ingresso.disegno && opt.ingresso.pronta ? opt.ingresso : null;
    S.el.classList.add("v3d");
    S.el.setAttribute("data-stato", "carico");
    // Un div nuovo per ogni apertura: MapLibre lega listener al suo contenitore e non tutti
    // si tolgono con map.remove(); cosi' contenitore e mappa vecchia si liberano insieme.
    var elMappa = document.createElement("div");
    elMappa.className = "v3d-mappa";
    S.el.appendChild(elMappa);
    try {
      S.map = creaMappa(elMappa, c);
    } catch (e) {
      errore("La vista 3D non è disponibile su questo dispositivo.");
      return false;
    }
    creaDom(S.el);
    var mio = S;
    // Tile della base che non arrivano (rete, blocco): la 3D vive lo stesso, la base e'
    // solo contesto; si contano e si segnano sul contenitore. Ogni altro errore resta in console.
    S.erroriBase = 0;
    S.map.on("error", function (ev) {
      if (S !== mio) return;
      if (ev && (ev.sourceId === "osm" || ev.tile)) { S.erroriBase++; S.el.setAttribute("data-base", "assente"); return; }
      if (window.console) console.error(ev && ev.error ? ev.error : ev);
    });
    S.map.on("webglcontextlost", function () { if (S === mio) errore("La vista 3D si è interrotta: torno alla mappa."); });
    S.map.on("click", function (ev) { if (S === mio) suClick(ev); });
    // Durante i movimenti le etichette si dissolvono (si ricalcolano a fermo)
    S.map.on("movestart", function () { if (S === mio) { chiudiPopup(); S.el.classList.add("v3d-in-moto"); } });
    S.map.on("move", function () { if (S === mio) quota(); });
    S.map.on("zoom", function () { if (S === mio) seguiZoom(); });
    S.map.on("zoomend", function () { if (S === mio) zoomCambiato(); });
    S.map.on("moveend", function () {
      if (S !== mio) return;
      // a volo finito i gruppi si rifanno allo zoom vero, se diverso da quello previsto
      if (S.zoomArrivo != null) { S.zoomArrivo = null; zoomCambiato(); adeguaFocus(); }
      disponiEtichette(); S.el.classList.remove("v3d-in-moto");
    });
    S.onResize = function () { if (S === mio) adattaNome(); };
    S.map.on("resize", function () {
      if (S !== mio || S.dimInquadra === S.map.transform.width + "x" + S.map.transform.height) return;
      // Telefono: la barra dell'indirizzo che entra o esce durante il mosaico (e nei 2 s dopo)
      // non rifa' la camera (stessa larghezza, meno di 80 px d'altezza): la discesa ricalcola da
      // se' la camera finale se la finestra e' cambiata (camereMosaico).
      var M = S.mosaico, d = String(S.dimInquadra || "").split("x");
      if (M && (M.stato !== "finito" || performance.now() - (M.finito || 0) < 2000) &&
          +d[0] === S.map.transform.width && Math.abs(+d[1] - S.map.transform.height) < 80) return;
      S.timer.forEach(clearTimeout); S.timer = [setTimeout(riquadra, 250)];
    });
    window.addEventListener("resize", S.onResize);
    if (!opt.mobile) {
      S.map.on("mousemove", function (ev) {
        if (S !== mio || !S.map.getLayer("aree-fill")) return;
        // sopra una targhetta decide lei (mouseenter / mouseleave)
        if (ev.originalEvent && ev.originalEvent.target && ev.originalEvent.target.closest && ev.originalEvent.target.closest(".v3d-targa")) return;
        var hit = S.map.queryRenderedFeatures(ev.point, { layers: strati() })
          .filter(function (x) { return x.properties && toccabile(x.properties.codice); })[0];
        S.map.getCanvas().style.cursor = hit ? "pointer" : "";
        evidenzia(hit && S.livello === "roma" ? cache.byCode[hit.properties.codice].m : null);
      });
      S.map.getCanvas().addEventListener("mouseleave", function () { if (S === mio) evidenzia(null); });
    }
    // Layer e selezione appena lo stile e' pronto, senza aspettare le tile ("load"
    // aspetta anche la base raster: con OSM irraggiungibile la 3D restava vuota).
    function avvia() {
      if (S !== mio || S.avviata) return;
      S.avviata = true;
      aggiungiLayer(c);
      preparaEvidenza();
      S.map.once("render", function () { if (S === mio) S.disegnata = true; });
      // Si parte dall'alto, piatti: la crescita e l'inclinazione sono l'ingresso.
      if (S.ingresso) attendiIngresso(); else applica(valida(opt.selezione));
    }
    if (S.map.isStyleLoaded()) avvia(); else S.map.once("style.load", avvia);
    // Rete di sicurezza: se in 8 s non c'e' nemmeno un fotogramma con le tessere, si torna alla 2D.
    // Il conto parte solo a documento visibile: in una scheda di sfondo il browser sospende
    // i fotogrammi e la 3D non puo' disegnare.
    function armaGuardia() {
      clearTimeout(mio.guardia);
      if (document.hidden) return;
      mio.guardia = setTimeout(function () {
        if (S !== mio || (S.avviata && S.disegnata)) return;
        if (document.hidden) return;
        errore("La vista 3D non è partita: torno alla mappa.", false);
      }, 8000);
    }
    S.suVisibilita = function () { if (S === mio && !(S.avviata && S.disegnata)) armaGuardia(); };
    document.addEventListener("visibilitychange", S.suVisibilita);
    armaGuardia();
    return true;
  }

  // ---------- ingresso dall'intro: il mosaico (opt.ingresso, costanti in MOSAICO) ----------
  // Camera piatta, nord in alto, col contorno di Roma esattamente sul disegno dei municipi
  // (stessa proiezione, Web Mercator): il mondo e' largo 512 * 2^z px, e il disegno da
  // ovest a est e' largo d.width. false se il disegno non c'e' piu'.
  function posaIngresso() {
    var d = S && S.ingresso && S.ingresso.disegno();
    if (!d || !(d.width > 0)) return false;
    var r = S.map.getContainer().getBoundingClientRect();
    var no = maplibregl.MercatorCoordinate.fromLngLat([d.ovest, d.nord]), se = maplibregl.MercatorCoordinate.fromLngLat([d.est, d.sud]);
    var mondo = d.width / (se.x - no.x);
    var cx = no.x + (r.width / 2 - (d.left - r.left)) / mondo, cy = no.y + (r.height / 2 - (d.top - r.top)) / mondo;
    S.map.jumpTo({ center: new maplibregl.MercatorCoordinate(cx, cy).toLngLat(), zoom: Math.log(mondo / 512) / Math.LN2, pitch: 0, bearing: 0 });
    return true;
  }
  // Gli anelli del contorno di Roma dall'intro (opt.ingresso.contorno), controllati; null se
  // mancano (un'intro senza contorno: niente linea, il resto uguale).
  function contornoIngresso() {
    var a = null;
    try { a = S.ingresso.contorno ? S.ingresso.contorno() : null; } catch (e) { a = null; }
    if (!a || !a.length) return null;
    a = a.filter(function (r) { return r && r.length > 1 && r.every(function (q) { return q && isFinite(q[0]) && isFinite(q[1]); }); });
    return a.length ? a : null;
  }
  // L'aspetto della mappa fra quello del disegno (k 0: fondo crema, il solo contorno di Roma; il
  // resto velato) e
  // quello di sempre (k 1: base, maschera, confini dei municipi, contorno spento). Solo valori
  // costanti: nessuna tessera da rifare a ogni fotogramma.
  function mescola(a, b, k) {
    var x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
    var m = function (s) { var p = (x >> s) & 255, q = (y >> s) & 255; return Math.round(p + (q - p) * k); };
    return "rgb(" + m(16) + "," + m(8) + "," + m(0) + ")";
  }
  function aspetto(k) {
    var map = S.map, fine = k >= 1;
    map.setPaintProperty("fondo", "background-color", fine ? FONDO : mescola(MOSAICO.fondo, FONDO, k));
    map.setPaintProperty("osm", "raster-opacity", fine ? 1 : Math.max(VELATO, k));
    map.setPaintProperty("maschera", "fill-opacity", fine ? MASCHERA.opacita : Math.max(VELATO, MASCHERA.opacita * k));
    map.setPaintProperty("mun-line", "line-opacity", fine ? MUN_LINEA : Math.max(VELATO, MUN_LINEA * k));
    if (map.getLayer("contorno")) {
      map.setPaintProperty("contorno", "line-opacity", fine ? 0 : 1 - k);
      if (fine) map.setLayoutProperty("contorno", "visibility", "none");
    }
  }
  function copia(o) { var r = {}; Object.keys(o).forEach(function (k) { r[k] = o[k]; }); return r; }
  // Le due camere del mosaico (inclinata coi tetti alti; quella di cameraRoma per la discesa),
  // calcolate prima del via, sotto l'intro: a 4x di CPU ciascun calcolo prendeva 20-40 ms nel
  // fotogramma del via e in quello della discesa. Si rifanno solo se cambiano finestra o margini
  // (cartiglio della 2D, card della guida): allinea, via e discesa controllano.
  function camereMosaico(M) {
    var p = padding(), k = S.map.transform.width + "x" + S.map.transform.height + ":" + [p.top, p.bottom, p.left, p.right].join(",");
    if (M.chiave === k) return;
    M.chiave = k;
    M.cam = neiLimiti(arrivoCamera(cache.romaGeo, cache.romaBox, MOSAICO.pitch, 12, 0, function () { return H_TIPO.RIONE * MOSAICO.tetti; }, ROMA_BEARING));
    M.arrivo = neiLimiti(arrivoRoma());
  }
  // La camera dove la 3D di sempre si ferma volando su `cam`: zoom minimo e limiti del
  // trascinamento di sempre (ZOOM_MIN, limiti), applicati come li applica MapLibre (prima lo
  // zoom, poi il centro). Nelle finestre strette coi margini del desktop (768x1024: 432 px di
  // mappa) Roma non entra nei limiti e arrivoCamera chiede uno zoom piu' basso di quello
  // permesso; vola lo passa a MapLibre, che si ferma al limite, mentre il mosaico vola senza
  // limiti e ci arrivava davvero (Roma un puntino, la discesa sull'Italia, poi lo scatto a
  // limiti ripristinati). Dove la camera e' gia' nei limiti non cambia nulla.
  function neiLimiti(cam) {
    var tr = S.map.transform.clone();
    tr.minZoom = ZOOM_MIN;
    tr.setMaxBounds(maplibregl.LngLatBounds.convert(limiti(cache)));
    tr.bearing = cam.bearing; tr.pitch = cam.pitch;
    tr.zoom = cam.zoom;
    tr.center = maplibregl.LngLat.convert(cam.center);
    return { center: [tr.center.lng, tr.center.lat], zoom: tr.zoom, bearing: cam.bearing, pitch: cam.pitch };
  }

  // Sotto l'intro: la posa del disegno con il suo aspetto (gli strati nascono cosi', vedi
  // creaMappa e aggiungiLayer), aree a terra spente, tessere di Roma parcheggiate sopra la
  // camera e color crema. Pronta appena aree, tessere e contorno sono nelle tessere della mappa
  // e disegnati: niente idle, niente tile OSM (la base arriva intanto, per la discesa).
  // S.mosaico.stato: "attesa" -> "pronta" -> "via" (parti, dentro applica) -> "corso" -> "finito".
  function attendiIngresso() {
    var mio = S, sel = valida(S.opt.selezione), P = MOSAICO.parcheggio;
    var M = S.mosaico = { stato: "attesa", tessere: {} };
    posaIngresso();
    // il confine acceso che applica scrive a Roma (nessuno), scritto ora con le sorgenti ancora
    // vuote: al via e' lo stesso valore e le tessere dei municipi non si rifanno
    S.map.setPaintProperty("mun-focus", "line-opacity", ["case", ["==", ["get", "m"], -1], 1, 0]);
    Object.keys(cache.byCode).forEach(function (k) {
      M.tessere[k] = { k: k, b: P, h: P, c: 0, v: 0 };
      S.map.setFeatureState({ source: "roma", id: k }, { b: P, h: P, c: 0 });
    });
    // Lo strato delle tessere si accende ora, sotto l'intro ancora coperta, con tutte le
    // tessere parcheggiate sopra la camera (nessuna a schermo): programma della scheda video e
    // buffer si preparano qui. Acceso solo al via, il primo disegno fermava la pagina fino a
    // mezzo secondo (misurato a 390 px, a cache fredda) proprio mentre la camera partiva.
    S.romaOp = 0.9;
    S.map.setPaintProperty("roma-ext", "fill-extrusion-opacity", S.romaOp);
    var parti = function (breve) {
      if (S !== mio || S.mosaico !== M || M.stato !== "pronta") return;
      M.stato = "via";
      M.cfg = breve === true ? MOSAICO.solo : (S.ingresso && S.ingresso.breve ? MOSAICO.breve : MOSAICO.normale);
      applica(sel);
    };
    var salta = function () {
      if (S !== mio || S.mosaico !== M) return;
      if (M.stato === "pronta") parti();
      if (M.stato === "corso") chiudiMosaico(true);
    };
    var allinea = function () { if (S === mio && !S.sel) { posaIngresso(); camereMosaico(M); } };
    var servono = ["aree", "roma"].concat(S.map.getSource("contorno") ? ["contorno"] : []);
    // isSourceLoaded e' vero anche prima che la mappa chieda le tessere: servono anche le feature
    var caricate = function () { return servono.every(function (id) { return S.map.isSourceLoaded(id) && S.map.querySourceFeatures(id).length > 0; }); };
    // intanto che il worker prepara le tessere, uno per fotogramma, i calcoli che il via e la
    // fine farebbero di colpo: le camere, poi i posti delle targhette dei municipi (postiMun,
    // gli stessi di sempre, in cache)
    var prima = Object.keys(cache.munGeo);
    (function guarda() {
      if (S !== mio || S.mosaico !== M || M.stato !== "attesa") return;
      if (!caricate()) {
        if (!M.chiave) camereMosaico(M); else if (prima.length) postiMun(+prima.shift());
        requestAnimationFrame(guarda);
        return;
      }
      // il primo fotogramma con le tessere caricate
      S.map.once("render", function () {
        if (S !== mio || S.mosaico !== M || M.stato !== "attesa") return;
        camereMosaico(M);
        M.stato = "pronta";
        S.ingresso.pronta(allinea, parti, salta);
      });
      S.map.triggerRepaint();
    })();
  }

  // Al via (da applica, a Roma): per ogni tessera il momento di partenza (finestra del suo
  // tipo, dal Campidoglio verso l'esterno) e la caduta in metri; poi un fotogramma alla volta
  // passoMosaico muove camera, tessere, impronte, conteggi e discesa, tutto dallo stesso orologio.
  function avviaMosaico() {
    var M = S.mosaico, cfg = M.cfg, ing = S.ingresso;
    M.stato = "corso";
    if (S.opt.riduciMovimento) {
      // l'intro non c'e' mai con la riduzione del movimento: per prudenza si arriva e basta
      chiudiMosaico(true);
      if (ing && ing.composta) ing.composta();
      return;
    }
    var z0 = S.map.getZoom(), p0 = S.map.getPitch();
    camereMosaico(M);
    // distanza dal Campidoglio (km, sul piano: conta l'ordine), normalizzata per tipo
    var cx = MOSAICO.centro[0], cy = MOSAICO.centro[1], kx = 111.32 * Math.cos(cy * Math.PI / 180), dist = {}, max = {};
    var attive = Object.keys(cache.byCode).filter(tipoAttivo);
    attive.forEach(function (k) {
      var e = cache.byCode[k], b = e.box, x = ((b[0] + b[2]) / 2 - cx) * kx, y = ((b[1] + b[3]) / 2 - cy) * 110.54;
      dist[k] = Math.sqrt(x * x + y * y);
      max[e.p.tipo] = Math.max(max[e.p.tipo] || 0, dist[k]);
    });
    M.lista = []; M.atterrate = {}; M.totali = {}; M.giu = 0; M.ultimo = 0;
    Object.keys(H_TIPO).forEach(function (t) { M.atterrate[t] = 0; M.totali[t] = 0; });
    var seno30 = Math.sin(Math.PI / 6), W = S.map.transform.width;
    var px = cfg.pxTel + (cfg.px - cfg.pxTel) * Math.max(0, Math.min(1, (W - 390) / 210));
    attive.forEach(function (k) {
      var e = cache.byCode[k], tipo = e.p.tipo, fin = cfg.tipi[tipo] || cfg.tipi.QUARTIERE, hsh = 0;
      for (var i = 0; i < k.length; i++) hsh = (hsh * 31 + k.charCodeAt(i)) % 1009;
      var t0 = fin[0] + (fin[1] - fin[0]) * Math.pow(dist[k] / (max[tipo] || 1), 0.9) + (hsh / 1008 * 2 - 1) * cfg.scarto;
      t0 = Math.max(fin[0], Math.min(fin[1], t0));
      var t = M.tessere[k];
      t.tipo = tipo; t.H = H_TIPO[tipo] || H_TIPO.QUARTIERE; t.t0 = t0; t.giu = false;
      t.tetti = tipo === "RIONE" ? MOSAICO.tettiRioni : MOSAICO.tetti;
      M.lista.push(t);
      M.totali[tipo] = (M.totali[tipo] || 0) + 1;
      M.ultimo = Math.max(M.ultimo, t0 + cfg.caduta);
    });
    // La camera si posa quando cade l'ultima tessera, mai prima di `camera` ms: posata prima,
    // restava ferma quasi un secondo mentre cadevano le zone funzionali.
    M.durCamera = Math.max(cfg.camera, M.ultimo - cfg.attesa);
    M.lista.forEach(function (t) {
      // La caduta in metri che fa `px` px a schermo con la camera prevista a meta' caduta (la
      // stessa curva della camera): un tratto verticale a schermo e' circa metri / mpp *
      // sin(inclinazione); sotto i 30 gradi vale quello dei 30 (cadute brevi, mai enormi).
      var e = cache.byCode[t.k], q = curvaSu((t.t0 + cfg.caduta / 2 - cfg.attesa) / M.durCamera);
      var z = z0 + (M.cam.zoom - z0) * q, p = p0 + (M.cam.pitch - p0) * q;
      t.D = px * mppA((e.box[1] + e.box[3]) / 2, z) / Math.max(seno30, Math.sin(p * Math.PI / 180));
    });
    // la discesa parte un attimo prima dell'ultimo atterraggio; si chiude a discesa finita e
    // a tessere assestate
    M.discesa = Math.max(cfg.attesa, M.ultimo - cfg.anticipo);
    M.fine = Math.max(M.discesa + cfg.discesa, M.ultimo + cfg.assesta);
    // lo strato e' acceso da attendiIngresso; da qui le sue tessere si toccano
    S.romaSu = true;
    M.t0 = performance.now();
    passoMosaico();
  }
  // Un fotogramma del mosaico. Per tessera in moto una sola scrittura sulle tessere di Roma
  // ({ b, h, c }) e, mentre l'impronta si accende, una sulle aree ({ v }); le tessere ferme non
  // si riscrivono (nella discesa si muovono tutte: i tetti scendono a 1x).
  function passoMosaico() {
    if (!S || !S.mosaico || S.mosaico.stato !== "corso") return;
    S.tween.mosaico = null;
    var M = S.mosaico, cfg = M.cfg, map = S.map, ing = S.ingresso, e = performance.now() - M.t0;
    if (!M.camera && e >= cfg.attesa) {
      M.camera = true;
      map.easeTo(Object.assign({ duration: M.durCamera, easing: curvaSu, essential: true }, M.cam));
    }
    var kd = 0;
    if (e >= M.discesa) {
      if (!M.scende) {
        // la camera di cameraRoma (gia' pronta, se finestra e margini non sono cambiati)
        M.scende = true;
        camereMosaico(M);
        S.camArrivo = M.arrivo;
        map.easeTo(Object.assign({ duration: cfg.discesa, easing: curvaSeno, essential: true }, M.arrivo));
      }
      kd = curvaSeno((e - M.discesa) / cfg.discesa);
      if (kd < 1) aspetto(kd);
    }
    var nuove = false, giu = M.giu, sq = MOSAICO.schiaccia, ti = MOSAICO.tinta;
    M.lista.forEach(function (t) {
      var u = e - t.t0, molt = t.tetti + (1 - t.tetti) * kd, b, h, c, v;
      if (u < 0) return;                                   // ancora parcheggiata
      if (u < cfg.caduta) {
        var q = u / cfg.caduta, qc = Math.min(1, q / 0.35), qv = Math.max(0, (q - 0.4) / 0.6);
        b = t.D * (1 - q * q * (2 - q));                   // parte piano, arriva a velocita' media
        h = b + t.H * molt;
        c = ti + (1 - ti) * (1 - (1 - qc) * (1 - qc));     // gia' tinta, piena nel primo 35%
        v = qv * qv * (3 - 2 * qv);                        // l'impronta nell'ultimo tratto
      } else {
        if (!t.giu) { t.giu = true; M.atterrate[t.tipo]++; giu++; nuove = true; }
        // assestamento: giu' di `schiaccia` in fretta, poi piano su fino all'altezza d'arrivo, mai oltre
        var w = (u - cfg.caduta) / cfg.assesta;
        var s = w >= 1 ? 0 : (w < 0.3 ? Math.sin(w / 0.3 * Math.PI / 2) : Math.pow(Math.cos((w - 0.3) / 0.7 * Math.PI / 2), 2));
        b = 0; h = t.H * molt * (1 - sq * s); c = 1; v = 1;
      }
      // nella discesa le tessere ferme si riscrivono solo se il tetto si sposta di almeno 1 m
      // (agli estremi della curva quasi mai): i valori esatti li scrive fineMosaico
      var ferma = b === 0 && t.b === 0 && c === t.c && Math.abs(h - t.h) < 1;
      if (!ferma && (b !== t.b || h !== t.h || c !== t.c)) {
        t.b = b; t.h = h; t.c = c;
        map.setFeatureState({ source: "roma", id: t.k }, { b: b, h: h, c: c });
      }
      if (v !== t.v) { t.v = v; map.setFeatureState({ source: "aree", id: t.k }, { v: v }); }
      S.romaH[t.k] = h;
    });
    M.giu = giu;
    if (nuove && ing && ing.conta) ing.conta(copia(M.atterrate), copia(M.totali));
    if (!M.composta && giu >= M.lista.length) {
      M.composta = true;
      cartiglioRoma();
      if (ing && ing.composta) ing.composta();
    }
    // si chiude a camera ferma (la discesa di MapLibre parte un fotogramma dopo questo orologio)
    if (e >= M.fine && (!map.isEasing() || e >= M.fine + 1000)) { fineMosaico(); return; }
    S.tween.mosaico = requestAnimationFrame(passoMosaico);
  }
  // Tutte le tessere ferme: al loro posto e a colore pieno, impronte accese per i tipi attivi
  // (partito), o a terra senza altezza se il mosaico non era partito. Lo stato e' quello che
  // lasciano romaSu e visibilita a Roma (S.romaH, S.st, S.t, opacita' dello strato).
  function tessereAPosto(M, partito) {
    Object.keys(cache.byCode).forEach(function (k) {
      var t = M.tessere[k] || (M.tessere[k] = { k: k }), h = partito ? hRoma(k) : 0;
      if (t.b !== 0 || t.h !== h || t.c !== 1) {
        t.b = 0; t.h = h; t.c = 1;
        S.map.setFeatureState({ source: "roma", id: k }, { b: 0, h: h, c: 1 });
      }
      S.romaH[k] = h;
      if (!partito) return;
      var vis = tipoAttivo(k) ? 1 : 0;
      if (t.v !== vis) { t.v = vis; S.map.setFeatureState({ source: "aree", id: k }, { v: vis }); }
      if (vis) S.st[k] = { vis0: 1, vis: 1 }; else delete S.st[k];
    });
    if (partito) S.t = 1;
    scriviRoma({});
  }
  // Roma composta e discesa finita: la 3D di sempre, coi suoi limiti, le targhette e pronta.
  function fineMosaico() {
    var M = S.mosaico;
    M.stato = "finito"; M.finito = performance.now();
    tessereAPosto(M, true);
    aspetto(1);
    sciogliIngresso();
    mostraTarghette();
    // le targhette entrano in 200 ms (animazione della pagina, nessuno stile lasciato sull'elemento)
    S.etichette.forEach(function (e) {
      if (e.el.animate) e.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
    });
    segnaPronta("mosaico");
  }
  // Il mosaico lascia subito il posto alla 3D di sempre (nessuna animazione). salto (salta(), o
  // un filtro a mosaico in corso): anche camera, cartiglio, targhette e pronta, come a discesa
  // finita; senza, ci pensa applica, che l'ha chiamata. Interrotto dopo il via (una selezione
  // da fuori), l'intro riceve comunque composta: non resta mai appesa.
  function chiudiMosaico(salto) {
    var M = S.mosaico, ing = S.ingresso;
    if (!M || M.stato === "finito") return;
    var partito = M.stato === "corso";
    M.stato = "finito"; M.finito = performance.now();
    if (S.tween.mosaico) { cancelAnimationFrame(S.tween.mosaico); S.tween.mosaico = null; }
    if (salto) {
      camereMosaico(M);
      S.camArrivo = M.arrivo;
      S.map.jumpTo(M.arrivo);
    }
    tessereAPosto(M, partito);
    aspetto(1);
    sciogliIngresso();
    if (salto) {
      M.composta = true;
      cartiglioRoma();
      mostraTarghette();
      S.manca = {};
      segnaPronta();
    } else if (partito && !M.composta) {
      M.composta = true;
      if (ing && ing.composta) ing.composta();
    }
  }
  // A Roma composta (o lasciando l'ingresso) la 3D torna ai suoi limiti.
  function sciogliIngresso() {
    if (!S.ingresso) return;
    S.ingresso = null;
    S.map.setMinZoom(ZOOM_MIN);
    S.map.setMaxBounds(limiti(cache));
  }

  // La via aperta nella 2D: { nome, linee: [[[lon, lat], ...], ...] } o null. Si dipinge sul
  // tetto delle tessere che attraversa (anche l'uscente, che scende con la sua).
  function viaValida(v) { return v && v.nome && v.linee && v.linee.length ? v : null; }
  function via(v) {
    if (!S) return;
    S.via = viaValida(v);
    [S.carta, S.giu.carta].forEach(function (c) { if (c && c.rifai) c.rifai(); });
  }

  function chiudi() {
    if (!S) return;
    var s = S;
    S = null;
    Object.keys(s.tween).forEach(function (k) { if (s.tween[k]) cancelAnimationFrame(s.tween[k]); });
    s.timer.forEach(clearTimeout);
    clearTimeout(s.guardia);
    if (s.suVisibilita) document.removeEventListener("visibilitychange", s.suVisibilita);
    if (s.onResize) window.removeEventListener("resize", s.onResize);
    (s.etichette || []).forEach(function (e) { try { e.marker.remove(); } catch (x) {} });
    try { if (s.map) s.map.remove(); } catch (e) {}
    s.el.innerHTML = "";
    s.el.classList.remove("v3d");
    s.el.removeAttribute("data-stato");
  }

  window.Vista3D = {
    supportato: supportato,
    apri: apri,
    chiudi: chiudi,
    seleziona: function (sel) { if (S && S.map && S.map.getLayer("aree-fill")) applica(valida(sel)); else if (S) S.opt.selezione = sel; },
    filtraTipi: filtraTipi,
    attiveCambiate: attiveCambiate,
    via: via,
    chiudiPopup: chiudiPopup,
    selezione: function () { return S ? S.sel : null; },
    mappa: function () { return S ? S.map : null; },   // per i test e le misure
    // per i test: opacita' dei due veli, buchi cambiati sotto un velo visibile e, dato un
    // punto [lon, lat], quale velo lo copre (fuori dal suo buco)
    velo: function (ll) {
      if (!S || !S.veloOp) return null;
      var copre = function (id) {
        var g = S.veloG[id];
        return !(ll && g && poligoni(g).some(function (pol) { return dentroAnello(ll[0], ll[1], pol[0]); }));
      };
      return { velo: opacita("velo"), vecchio: opacita("velo-vecchio"), salti: S.veloSalti,
               copre: ll ? { velo: copre("velo"), vecchio: copre("velo-vecchio") } : null };
    },
    // per i test: quante righe prende un nome nel cartiglio (lo rimette com'era)
    misuraNome: function (nome, medio) {
      if (!S || !S.ui) return null;
      var el = S.ui.nome, prima = el.textContent, primaMedio = el.classList.contains("v3d-nome-medio");
      el.textContent = medio ? nome : titolo(nome); el.classList.toggle("v3d-nome-medio", !!medio);
      adattaNome();
      var lh = parseFloat(getComputedStyle(el).lineHeight), r = { righe: Math.round(el.scrollHeight / lh), px: parseFloat(getComputedStyle(el).fontSize) };
      el.textContent = prima; el.classList.toggle("v3d-nome-medio", primaMedio); adattaNome();
      return r;
    },
    stato: function () { return { aperta: !!S, pronta: !!(S && S.pronta), livello: S ? S.livello : "", munK: S ? S.munK : 0 }; },
    // il tetto della tessera d'area: "carta" (le tile OSM), "colore" (il pieno del municipio) o ""
    tetto: function () { return S && S.carta && S.focusVis === "visible" ? (S.carta.pronta ? "carta" : "colore") : ""; },
    // per i test: il nome della via dipinta sul tetto della tessera d'area, o ""
    viaSulTetto: function () { return S && S.carta && S.focusVis === "visible" ? (S.carta.via || "") : ""; }
  };
})();
