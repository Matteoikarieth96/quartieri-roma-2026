# Quartieri di Roma 2026

La nuova geografia amministrativa di Roma su una mappa che si apre nel browser: 334 quartieri urbani, 22 rioni, 101 zone funzionali e 15 municipi, come da deliberazione n. 150/2026 dell'Assemblea Capitolina. Si può cercare una via nello stradario, aprire un'area per vedere i servizi al suo interno e calcolare cosa si raggiunge a piedi in circa 15 minuti da un punto. La mappa si apre in 3D inclinata (MapLibre GL) e col tasto 3D | 2D passa alla 2D (Leaflet).

È un progetto di Urbe Hub con i dati aperti di Roma Capitale. Progetto indipendente: non è un servizio di Roma Capitale. Per i confini ufficiali vale la deliberazione n. 150/2026.

La mappa è online su [romaquartieri.it](https://romaquartieri.it/).

## Novità

Con la versione del 2 novembre 2026:

- la mappa si apre in 3D: le 457 aree cadono come tessere dal centro verso fuori e una guida in cinque passi mostra municipio, quartiere, servizi, via e 15 minuti
- in 3D, da Roma, il primo clic sceglie un municipio e il secondo l'area; anche la ricerca delle vie funziona in 3D
- la 2D, col tasto 3D | 2D, è la mappa dei 15 minuti
- i servizi partono tutti accesi, anche su telefono; in 3D le icone vicine formano grappoli che si aprono sul posto
- in 3D abbiamo corretto il cambio d'area e lo sfarfallio delle pareti
- 81 servizi doppi in meno, controllati da `test_accorpamento.py`
- la copertura dei 15 minuti a esagoni è pronta ma spenta (vedi "La città dei 15 minuti")

Con la versione del 31 ottobre 2026 sono arrivate le farmacie dall'anagrafe del Ministero della Salute, la ricerca delle vie anche col civico, le avvertenze nelle schede di farmacie e pronto soccorso e le correzioni allo stradario. Sono partite dalla [PR #1](https://github.com/urbe-hub/quartieri-roma-2026/pull/1) di Matteo ([@Matteoikarieth96](https://github.com/Matteoikarieth96)): grazie Matteo!

## Segnalare errori

Un confine, una via o un servizio sbagliati, chiusi o spostati: apri una [issue](https://github.com/urbe-hub/quartieri-roma-2026/issues) (o scrivi a hello@urbe.build) indicando l'area o l'indirizzo e, se puoi, la fonte corretta. Le correzioni ai dati passano dagli script descritti in "Dati e rigenerazione".

Il risultato del build è una cartella statica: nessun server applicativo, nessun database, nessun cookie e nessun servizio di statistiche.

## Come si costruisce

Serve Python 3.9 o successivo. Il build usa solo la libreria standard.

```bash
python3 build.py
```

Scrive la cartella `dist/`:

- `index.html`: il bundle autoportante (mappa, dati dei confini, Leaflet, font e logo), circa 1 MB, 0,34 MB compressi
- `strade/`: lo stradario, caricato solo quando si cerca una via (circa 4 MB)
- `servizi/servizi.json`: i servizi del focus e dei 15 minuti, un file solo (circa 0,6 MB)
- `rete/`: la rete pedonale in riquadri, caricata solo attorno al punto scelto (circa 20 MB)
- `3d/`: MapLibre GL (con la sua licenza) e il modulo della vista 3D, scaricati solo al primo tocco su "3D"
- `OFL.txt` e `leaflet-LICENSE.txt`: le licenze del font Montserrat e di Leaflet
- `og.png`: l'immagine di anteprima per i social
- `vercel.json`: header di cache e di sicurezza, per chi pubblica su Vercel

Opzioni:

- `python3 build.py --produzione`: costruisce la versione indicizzabile (senza meta noindex e senza l'header X-Robots-Tag). Fallisce se manca la rete pedonale.
- `MAPPA_DIST=/percorso/uscita python3 build.py`: scrive in una cartella diversa da `dist/`, senza toccare quella esistente.

Senza opzioni il build produce una versione di anteprima con noindex, adatta a essere provata prima di pubblicare.

Prima di pubblicare in produzione: `dist/` resta quello dell'ultimo build, che di solito è l'anteprima (con noindex). Si rifà sempre con `python3 build.py --produzione` subito prima del deploy e si controlla:

- `grep -ci noindex dist/index.html dist/vercel.json` deve dare 0 per entrambi;
- dopo il deploy, `curl -sI <indirizzo del sito> | grep -i robots` non deve stampare nulla.

### Anteprima in locale

Va servita via HTTP, non aprendo il file:

```bash
cd dist && python3 -m http.server 8731 --bind 127.0.0.1
```

poi si apre `http://localhost:8731/index.html`.

### La città dei 15 minuti

Il pulsante "A piedi in 15 minuti" calcola, da un punto sulla mappa (un tocco, una via cercata, "Dove sono" o un link `#15=lat,lon`), le strade raggiungibili a piedi in circa 15 minuti e i servizi lungo il percorso. Il calcolo gira nel browser, a 4,8 km/h sulla rete pedonale.

La rete pedonale è ricavata da OpenStreetMap e pesa circa 20 MB, per questo non sta nel repository. Per averla:

```bash
pip install osmium
python3 prepara_rete_pedonale.py centro-latest.osm.pbf
```

L'estratto dell'Italia centrale si scarica da `https://download.geofabrik.de/europe/italy/centro-latest.osm.pbf`. Lo script scrive `data/rete/` (circa 1.175 riquadri). Senza quella cartella il build di anteprima non si ferma: avvisa e la mappa esce senza il pulsante dei 15 minuti, mentre un link `#15=` apre la mappa normale con un avviso.

Lo strato della copertura qui sotto è spento nel rilascio del 2026-11-02: `COPERTURA_NEL_RILASCIO = False` in `build.py`, e la 2D esce come senza il file (niente esagoni, legenda né fonte GHS-POP). Il codice resta; con `True` torna tutto.

La 2D si apre su Roma con le zone dove i servizi essenziali non si raggiungono a piedi in 15 minuti: esagoni di 250 m dove abitano almeno 50 persone, colorati se manca anche uno fra nido, scuola dell'infanzia, primaria, media, farmacia e parco. Case della Comunità e pronto soccorso non colorano la mappa (sono lontani per circa tre residenti su quattro) e compaiono nella scheda della zona, che si apre toccando un esagono colorato e da cui partono i 15 minuti dal punto. Lo strato si spegne con un'area aperta, coi 15 minuti accesi e in 3D; il link `#copertura` lo riapre. Il dato (`data/copertura/copertura.json`, circa 170 KB) si rifà con:

```bash
pip install numpy scipy tifffile imagecodecs
python3 prepara_copertura_15_minuti.py GHS_POP_E2025_GLOBE_R2023A_4326_3ss_V1_0_R5_C20.tif
```

Lo script usa la rete pedonale di `data/rete/`, i servizi di `data/servizi/servizi.json` e la griglia di popolazione GHS-POP 2025 della Commissione europea (tessera R5_C20, dal sito del GHSL, licenza CC BY 4.0).

## Test

```bash
pip install -r requirements-dev.txt
python3 -m pytest -q
```

I test unitari verificano il build: il meta noindex e l'header X-Robots-Tag in anteprima e in produzione, gli header di sicurezza, il fallimento del build di produzione senza `data/rete/`, la presenza dei file di licenza e l'accorpamento dei servizi doppi (`test_accorpamento.py`, sui casi trovati e sul `data/servizi/servizi.json` scritto). Il controllo sul bundle `check_zero_footprint.py` (termini vietati, eccezioni per gli omonimi, file di termini locale facoltativo) lo esegue il build sul file finale.

## Pubblicare

`dist/` è una cartella statica: va caricata per intero su un hosting statico (Vercel, Netlify, Cloudflare Pages, S3 con CDN e simili). Il bundle carica strade, servizi e rete con un parametro `?v=<hash>`: quei file si possono servire con cache lunga e immutabile, mentre `index.html` va servito con revalidazione. Chi non usa Vercel deve riprodurre a mano gli header di `dist/vercel.json`.

La pagina si può incorporare in un iframe: non è imposto alcun blocco al framing.

## Dati e rigenerazione

I dati sono già pronti in `data/`: confini di quartieri e municipi, stradario, servizi, scuole e presidi. Il build usa solo quei file.

Gli script `importa_dati.py`, `importa_servizi.py`, `prepara_scuole.py`, `prepara_servizi_15_minuti.py` e `prepara_rete_pedonale.py` descrivono come sono stati ottenuti, partendo dai servizi WFS del geoportale di Roma Capitale, dall'anagrafe del Ministero dell'Istruzione e del Merito e dall'estratto OpenStreetMap. Due script prendono la cartella delle fonti da riga di comando: `prepara_servizi_15_minuti.py <cartella fonti> [civici_*.csv ...]` (o con la variabile `MAPPA_FONTI`) e `icone/prepara_icone_app.py [<cartella illustrazioni>]` (o `MAPPA_ILLUSTRAZIONI`). Le farmacie vengono dall'anagrafe del Ministero della Salute (solo quelle attive alla data del file): `prepara_farmacie.py <FRM_FARMA_5_AAAAMMGG.csv> <civici_*.csv ...>` aggancia l'indirizzo ufficiale ai numeri civici di Roma Capitale e riscrive solo la categoria farmacie di `data/servizi/servizi.json`. Va lanciato dopo `importa_servizi.py`, che scrive ancora le farmacie del Piano dei Servizi. I dati attuali sono quelli del file del 30/10/2026, scaricato dalla [pagina del dataset](https://www.dati.salute.gov.it/it/dataset/farmacie/) (licenza IODL 2.0).

Rigenerare i dati dipende da fonti esterne che non sono incluse in questo repository (estratti, elenchi dei civici, file degli enti), quindi non fa parte del normale ciclo di build.

Una nota sullo stradario: `data/strade/` (14.908 vie) viene dallo strato DIPPC:stradario_municipio del geoportale. Rispetto allo strato di oggi mancano circa 46 nomi, per lo più tratti brevi (fra questi Via Paolo VI, Via del Casale di San Paolo, Via Maremmana II, Viale Pariole, Piazza Ravenna, Largo Collodi): chi li cerca non li trova finché lo stradario non viene rigenerato. Via Cassia Antica non c'è né qui né nello strato del geoportale (esistono solo Via Cassia e Via Cassia Nuova). I nomi che finiscono con un numero ("Via Ragazzi del '99", "Largo Tre Giugno 1849") e quelli con un numerale romano ("Piazza Umberto I") sono corretti all'importazione da `importa_dati.py`.

Nella fonte GeoRoma sette nomi di quartiere usano l'apostrofo al posto dell'accento (per esempio "LAMARO - CINECITTA'"). Lo script `importa_dati.py` li corregge all'importazione, e il build li corregge anche nel bundle, quindi la mappa mostra i nomi con l'accento.

## Fonti e licenze

Il codice è sotto licenza MIT (vedi `LICENSE`). I dati, le librerie e i font hanno ciascuno la propria licenza, elencata in `THIRD_PARTY.md`: GeoRoma di Roma Capitale, OpenStreetMap (ODbL), Ministero dell'Istruzione e del Merito (IODL 2.0), Ministero della Salute (IODL 2.0), AGENAS, Regione Lazio, GHS-POP della Commissione europea (CC BY 4.0), Leaflet, MapLibre GL e il font Montserrat. Il nome e il logo di Urbe Hub, anche nell'immagine per i social, non sono coperti dalla licenza MIT.

## Mappa di base

La mappa di base usa le tile di OpenStreetMap (`tile.openstreetmap.org`), con la dicitura © OpenStreetMap contributors. L'indirizzo delle tile compare in due punti: nel template `mappa-quartieri.template.html` per la vista 2D e in `vista-3d/vista-3d.js` per la 3D (che accetta anche un valore in `window.MAPPA_TILE_URL`). Il server pubblico di OpenStreetMap è pensato per un uso leggero: una visita genera decine di richieste (circa 28 in 2D, circa 87 in 3D), quindi se il traffico cresce conviene passare a un fornitore di tile con un piano adatto. Per farlo si cambia l'indirizzo in entrambi i punti e si aggiorna l'elenco degli host consentiti nell'header Content-Security-Policy-Report-Only, che in `build.py` (funzione `config_vercel`) cita `https://tile.openstreetmap.org`.

## Uso su telefono

Sotto i 720 px di larghezza la mappa cambia cornice, e il desktop resta com'è:

- la testata sta in una riga, con i tasti (i) e (?)
- sulla mappa restano la barra con indietro, ricerca (aree e vie) e 2D | 3D, e il tasto posizione
- in basso il cartiglio con Elenco e Livelli
- la scheda d'area è un foglio basso (Servizi, 15 minuti, Condividi) che si tira su per i dettagli
- Servizi e Livelli sono fogli a parte: il foglio Servizi prende il posto della scheda, con tutte le categorie accese di partenza (si spengono quelle che non servono), mentre il foglio Livelli porta legenda e filtri per tipo
- ogni foglio ha una maniglia: un tocco lo alza o lo abbassa, trascinarlo in giù lo abbassa di un gradino

La stessa cornice vale in 3D.

## La scheda del servizio

Un clic o un tocco su un'icona dei servizi, o su una voce dell'elenco di un grappolo, apre la scheda del servizio: su desktop un riquadro ancorato all'icona, su telefono un foglio dal basso. Mostra categoria, nome, indirizzo, area e municipio. Per le scuole aggiunge, quando ci sono, l'istituto di riferimento, i posti e le sezioni dei nidi e delle infanzie comunali, un eventuale avviso di chiusura per lavori, il sito e il collegamento a Scuola in Chiaro. Dalla scheda parte il calcolo dei 15 minuti dal servizio stesso.

## Struttura

```
build.py                         builder: inlina dati, Leaflet, font e logo, esegue il controllo finale
mappa-quartieri.template.html    template unico (veste e logica della mappa)
vista-3d/                        modulo della vista 3D e aggancio alla 2D
vendor/                          Leaflet, MapLibre GL, font Montserrat, con le rispettive licenze
brand/                           logo Urbe Hub e immagine per i social (esclusi dalla licenza MIT)
icone/                           icone dei servizi (SVG) e lo script che le prepara
data/                            dati pronti per il build
check_zero_footprint.py          controllo sul bundle, eseguito dal build
test_build.py                    test del build
test_zero_footprint.py           test del controllo
test_accorpamento.py             test dei servizi doppi
importa_dati.py                  confini e stradario, da WFS di Roma Capitale
importa_servizi.py               Piano dei Servizi, unito a scuole e presidi
prepara_scuole.py                scuole e nidi (con --dettagli per le schede)
prepara_farmacie.py              farmacie dall'anagrafe del Ministero della Salute
prepara_servizi_15_minuti.py     case della comunità e pronto soccorso
prepara_rete_pedonale.py         rete pedonale da OpenStreetMap
prepara_copertura_15_minuti.py   copertura dei 15 minuti a esagoni (spenta in questo rilascio)
```

## Contatti

hello@urbe.build
