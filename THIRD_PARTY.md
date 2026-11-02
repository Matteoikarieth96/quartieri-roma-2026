# Materiali di terzi

La licenza MIT di questo repository (`LICENSE`) copre solo il codice. Dati, librerie, font e marchi qui sotto seguono le condizioni dei rispettivi titolari.

## Dati

| Dato | Dove | Fonte | Condizioni |
|---|---|---|---|
| Aree della deliberazione n. 150/2026 (quartieri, rioni, zone funzionali), stradario, Piano dei Servizi, servizi educativi, numeri civici | `data/` | Roma Capitale, geoportale GeoRoma (`geoportale.comune.roma.it`) | Dati aperti ai sensi dell'art. 52, comma 2, del Codice dell'amministrazione digitale (d.lgs. 82/2005), con fonte Roma Capitale. La licenza CC BY 4.0 vale solo per gli strati che la dichiarano espressamente. Per gli altri non c'è una licenza dichiarata sul geoportale |
| Confini dei municipi, rete pedonale dei 15 minuti e posizione di alcuni pronto soccorso | `data/municipi-roma.geojson` (admin_level=9), `data/rete/` (non nel repository), `data/servizi-15-minuti.json`, `data/servizi/servizi.json` | OpenStreetMap | Open Database License (ODbL) 1.0, © OpenStreetMap contributors. Dati derivati: vanno mantenuti con la stessa licenza e la stessa attribuzione. Il metodo per rifare la rete pedonale è `prepara_rete_pedonale.py` |
| Anagrafe delle scuole statali e paritarie (a.s. 2026/27) | `data/scuole.json`, `data/scuole-dettagli.json`, `data/servizi/servizi.json` | Ministero dell'Istruzione e del Merito, dati aperti | Italian Open Data License 2.0 (IODL 2.0), con indicazione della fonte |
| Farmacie attive (anagrafe al 30/10/2026) | `data/servizi/servizi.json` | Ministero della Salute, dati aperti (`dati.salute.gov.it`), con posizioni dai numeri civici di Roma Capitale | Italian Open Data License 2.0 (IODL 2.0), con indicazione della fonte. Si mostrano solo tipo e indirizzo, non la ragione sociale |
| Case della Comunità | `data/servizi-15-minuti.json`, `data/servizi/servizi.json` | AGENAS | Dati pubblicati dall'ente. Nessuna licenza dichiarata: si indica la fonte |
| Pronto soccorso | `data/servizi-15-minuti.json`, `data/servizi/servizi.json` | Regione Lazio, con posizioni da OpenStreetMap (ODbL) | Dati pubblicati dall'ente. Nessuna licenza dichiarata per la parte regionale: si indica la fonte |
| Abitanti per esagono nella copertura dei 15 minuti | `data/copertura/copertura.json` | GHS-POP R2023A, epoca 2025, Commissione europea, Joint Research Centre (GHSL) | Creative Commons Attribution 4.0 (CC BY 4.0), con indicazione della fonte. I tempi a piedi dello stesso file sono calcolati sulla rete pedonale OpenStreetMap: per quella parte vale l'ODbL come sopra |
| Mappa di base | caricata dal browser | OpenStreetMap, `tile.openstreetmap.org` | © OpenStreetMap contributors (ODbL), con la policy d'uso delle tile di OpenStreetMap Foundation |

## Librerie e font

| Componente | Dove | Licenza |
|---|---|---|
| Leaflet | `vendor/leaflet.js`, `vendor/leaflet.css`, licenza in `vendor/leaflet/LICENSE` | BSD 2-Clause |
| MapLibre GL JS 4.7.1 | `vendor/maplibre-gl/`, licenza in `vendor/maplibre-gl/LICENSE.txt` | BSD 3-Clause |
| Montserrat | `vendor/fonts/montserrat-latin.woff2`, licenza in `vendor/fonts/OFL.txt` | SIL Open Font License 1.1 |

## Marchi

Il nome e il logo di Urbe Hub (`brand/urbe-hub-donor.png`, e dentro l'immagine per i social `brand/og.png`) sono esclusi dalla licenza MIT. Si possono usare per citare il progetto, non per altri scopi senza permesso.

Il progetto non usa il marchio, lo stemma o il logo di Roma Capitale e non è un servizio di Roma Capitale.
