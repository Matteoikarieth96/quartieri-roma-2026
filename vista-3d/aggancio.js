  // ======================================================================
  // Vista 3D (inlinato dal build dentro lo script della 2D, da vista-3d/aggancio.js).
  // Qui solo il tasto 2D/3D, il caricatore e il contratto con window.Vista3D: MapLibre
  // e il modulo (dist/3d/) si scaricano al primo "3D", mai al primo caricamento.
  // La 3D riceve i dati gia' decodificati e la selezione corrente; cio' che si sceglie
  // in 3D resta "pendente" e si applica alla 2D quando si torna in 2D.
  // Hash: #3d, #3d/<codice area>, #3d/municipio-<n>, #3d/via=<nome> (convive con #<codice>,
  // #via=, #15=).
  // Cronologia: entrare in 3D col tasto aggiunge UNA voce (pushState); le scelte dentro
  // la 3D la riscrivono (replaceState). "Indietro" e il tasto 2D tornano alla voce di
  // prima, quindi la 3D non crea voci doppie e "Indietro" non esce dal sito.
  (function () {
    var gruppoEl = document.getElementById("vista-dd");
    if (!gruppoEl) return;
    var btn2d = gruppoEl.querySelector('[data-vista="2d"]'), btn3d = gruppoEl.querySelector('[data-vista="3d"]');
    var contenitore = null, aperta = false, pendente = null, caricamento = null;
    var stiliAggiunti = false, giroApertura = 0;
    var compattoDa3D = false, ritornoApplica = false, q15Salvato = null, muni2D = "", areaServizi = null;
    // il livello da cui si e' entrati nell'area della 3D (municipio o Roma): la x della
    // scheda e un tipo spento ci tornano, come deseleziona della 2D col suo menu
    var origine = { tipo: "roma" };
    var HASH_3D = /^3d(?:\/(.+))?$/;

    function webglDisponibile() {
      try {
        var c = document.createElement("canvas");
        var gl = window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl"));
        if (!gl) return false;
        var lose = gl.getExtension("WEBGL_lose_context");
        if (lose) lose.loseContext();
        return true;
      } catch (e) { return false; }
    }
    // L'hash decodificato; un'escape malformata (link troncato) vale come hash vuoto.
    function leggiHash() {
      try { return decodeURIComponent((location.hash || "").replace(/^#/, "")); } catch (e) { return ""; }
    }
    function selDaHash() {
      var m = HASH_3D.exec(leggiHash());
      if (!m) return null;
      if (!m[1]) return { tipo: "roma" };
      var mm = /^municipio-(\d+)$/.exec(m[1]);
      if (mm) return { tipo: "municipio", arabo: parseInt(mm[1], 10) };
      var mv = /^via=(.+)$/.exec(m[1]);
      if (mv) return { tipo: "via", nome: mv[1] };
      return { tipo: "area", codice: m[1] };
    }
    // con una via aperta, un'area che la via attraversa scrive la via (come la 2D)
    function scriviHash(s, nuovaVoce) {
      var h = "#3d" + (s.tipo === "area" ? "/" + (inVia(s) ? "via=" + encodeURIComponent(viaAttiva.via.nome) : encodeURIComponent(s.codice)) :
        (s.tipo === "municipio" ? "/municipio-" + s.arabo : ""));
      if (nuovaVoce && history.pushState) history.pushState({ v3d: true }, "", h);
      else if (history.replaceState) history.replaceState(history.state, "", h);
    }
    function pulisciHash() { if (history.replaceState) history.replaceState(null, "", location.pathname + location.search); }
    function hash2D() {
      if (!history.replaceState) return;
      if (selectedEntry && inVia({ tipo: "area", codice: selectedEntry.feature.properties.codice })) history.replaceState(null, "", "#via=" + encodeURIComponent(viaAttiva.via.nome));
      else if (selectedEntry) history.replaceState(null, "", "#" + encodeURIComponent(selectedEntry.feature.properties.codice || ""));
      else pulisciHash();
    }
    function voceNostra() { return !!(history.state && history.state.v3d); }
    function selezione2D() {
      if (selectedEntry) return { tipo: "area", codice: selectedEntry.feature.properties.codice };
      if (activeMunicipio) return { tipo: "municipio", arabo: parseInt(activeMunicipio, 10) };
      return { tipo: "roma" };
    }
    function segna(in3d) {
      btn2d.setAttribute("aria-pressed", String(!in3d));
      btn3d.setAttribute("aria-pressed", String(in3d));
    }

    // Prova pigra: al caricamento basta che il browser conosca WebGL (nessun contesto
    // creato); il contesto vero si prova al primo "3D".
    if (!window.WebGLRenderingContext) {
      gruppoEl.hidden = true;
      if (selDaHash()) { pulisciHash(); setTimeout(function () { avviso("La vista 3D non è disponibile su questo dispositivo: ecco la mappa."); }, 800); }
      return;
    }
    gruppoEl.hidden = false;
    var webglProvato = false;

    // Su telefono il tasto sta nella barra in alto sulla mappa, a destra della ricerca
    // (cornice del telefono); su desktop nella barra delle statistiche,
    // prima di "Cos'e'" (che collocaCornice, registrata prima, ha gia' riportato li').
    var aboutBtn = document.getElementById("about-btn"), mqTelefono = window.matchMedia(window.MAPPA_MQ_TELEFONO || "(max-width: 720px)");
    function collocaTasto() {
      if (mqTelefono.matches) { if (gruppoEl.parentNode.id !== "barra-mappa") document.getElementById("barra-mappa").appendChild(gruppoEl); }
      else if (gruppoEl.nextElementSibling !== aboutBtn) aboutBtn.parentNode.insertBefore(gruppoEl, aboutBtn);
    }
    collocaTasto();
    if (mqTelefono.addEventListener) mqTelefono.addEventListener("change", collocaTasto);
    else if (mqTelefono.addListener) mqTelefono.addListener(collocaTasto);

    // MapLibre e il modulo in parallelo, eseguiti in ordine (async=false).
    function carica() {
      if (caricamento) return caricamento;
      // i fogli di stile si aggiungono una volta sola, anche dopo un tentativo fallito
      if (!stiliAggiunti) {
        stiliAggiunti = true;
        ["3d/maplibre-gl.css", "3d/vista-3d.css"].forEach(function (href) {
          var l = document.createElement("link"); l.rel = "stylesheet"; l.href = conVersione(href, "3d"); document.head.appendChild(l);
        });
      }
      var ultimoMaplibre = null;
      caricamento = new Promise(function (ok, ko) {
        ["3d/maplibre-gl.js", "3d/vista-3d.js"].forEach(function (src, i) {
          if (i === 0 && window.maplibregl) return;
          if (i === 1 && window.Vista3D) {
            // modulo gia' presente: si aspetta solo MapLibre (se e' stato riaggiunto ora)
            if (window.maplibregl) ok();
            else if (ultimoMaplibre) ultimoMaplibre.onload = function () { if (window.maplibregl) ok(); else ko(); };
            return;
          }
          var s = document.createElement("script");
          s.src = conVersione(src, "3d"); s.async = false;
          s.onerror = function () { s.remove(); ko(); };
          if (i === 0) ultimoMaplibre = s;
          if (i === 1) s.onload = function () { if (window.Vista3D && window.maplibregl) ok(); else ko(); };
          document.head.appendChild(s);
        });
      });
      caricamento.catch(function () { caricamento = null; });
      return caricamento;
    }

    function fallisci(msg, definitivo) {
      if (tourAttivo() && tour3D) chiudiTour();
      chiudi3d(false, true);
      // la 3D si e' interrotta dopo il via: l'intro non resta appesa ad aspettare la citta'
      if (ponte && ponte.stato === "partita") compostaIntro();
      ponteNo();
      hash2D();
      if (definitivo) gruppoEl.hidden = true;
      avviso(msg);
    }

    // daTasto: aperta dal tasto 3D (nuova voce di cronologia); altrimenti da un link o
    // da avanti/indietro, e la voce c'e' gia'.
    // silenzioso: l'avvio di default in 3D; senza WebGL vero si resta in 2D senza avviso.
    // ingresso: l'avvio sotto l'intro (vedi in fondo e opt.ingresso di Vista3D.apri).
    function apri3d(sel, daTasto, silenzioso, ingresso) {
      if (aperta) { if (sel && sel.tipo === "via") apriViaDaLink(sel.nome); else if (sel && window.Vista3D) vola3d(sel); return; }
      if (presentazioneOn) return;
      // #3d/via=<nome>: si apre quando c'e' lo stradario, dritta sull'area della via
      if (sel && sel.tipo === "via") {
        var nome = sel.nome;
        caricaVie().then(function () {
          var v = viaDiNome(nome), rif = v && areaDiRiferimento(v);
          if (rif) { caricaViaAttiva(v); apri3d({ tipo: "area", codice: rif.feature.properties.codice }, daTasto); return; }
          avviso("La via del link non si è trovata.");
          apri3d({ tipo: "roma" }, daTasto);
        });
        return;
      }
      if (!webglProvato) {
        webglProvato = true;
        if (!webglDisponibile()) {
          gruppoEl.hidden = true;
          if (selDaHash()) hash2D();
          if (!silenzioso) avviso("La vista 3D non è disponibile su questo dispositivo.");
          return;
        }
      }
      if (tourAttivo() && !tour3D) chiudiTour();   // la guida della 3D apre la 3D lei stessa
      chiudiSchedaServizio();
      // 15 minuti accesi: si chiudono e tornano, sullo stesso punto, al ritorno in 2D.
      q15Salvato = null;
      if (q15 && q15.attivo) {
        var m15 = /^15=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(,bici)?$/.exec(leggiHash());
        if (m15 && !(isFinite(parseFloat(m15[1])) && isFinite(parseFloat(m15[2])))) m15 = null;
        q15Salvato = m15 ? L.latLng(parseFloat(m15[1]), parseFloat(m15[2])) : (q15.marker ? q15.marker.getLatLng() : true);
        q15Disattiva();
        if (m15 && history.replaceState) history.replaceState(history.state, "", "#15=" + m15[1] + "," + m15[2] + (m15[3] || ""));
      }
      aperta = true; segna(true);
      // il municipio che la 2D mostra davvero: il menu segue la 3D, la 2D no (applicaA2D)
      muni2D = activeMunicipio || "";
      var in2d = selezione2D();
      sel = sel || in2d;
      // un hash #3d/<...> che non porta a nulla si legge come Roma, e l'URL si corregge
      if ((sel.tipo === "area" && !entryDi(sel.codice)) || (sel.tipo === "municipio" && !(sel.arabo >= 1 && sel.arabo <= 15))) sel = { tipo: "roma" };
      // l'area d'arrivo si lascia verso il municipio del menu della 2D se e' il suo, se no Roma
      var eSel = sel.tipo === "area" ? entryDi(sel.codice) : null;
      origine = sel.tipo !== "area" ? sel : (eSel && muni2D && muni2D === String(eSel.feature.properties.municipio_num_arabo) ?
        { tipo: "municipio", arabo: parseInt(muni2D, 10) } : { tipo: "roma" });
      // Aperta da un link #3d/<...> la 2D e' altrove: al ritorno deve raggiungere la 3D.
      pendente = JSON.stringify(sel) === JSON.stringify(in2d) ? null : sel;
      scriviHash(sel, !!daTasto);
      if (!contenitore) {
        contenitore = document.createElement("div");
        contenitore.id = "vista-3d";
        document.getElementById("map-wrap").appendChild(contenitore);
      }
      contenitore.hidden = false;
      // l'avviso resta anche dopo, finche' la mappa non ha il primo disegno (aggancio.css)
      if (silenzioso) contenitore.removeAttribute("data-attesa"); else contenitore.setAttribute("data-attesa", "");
      contenitore.innerHTML = '<div class="v3d-attesa">Preparo la vista 3D…</div>';
      document.body.classList.add("vista-3d-on");
      // la scheda della 2D sta sopra la 3D solo nell'area: subito quella dell'area di arrivo
      var eArrivo = sel.tipo === "area" ? entryDi(sel.codice) : null;
      schedaArea(eArrivo ? eArrivo.feature.properties : null);
      // cartiglio e indietro della barra: il livello di arrivo (o Roma, se si arriva in un'area)
      cartiglioSel = { tipo: "roma" }; cornice3d(sel.tipo === "area" ? { tipo: "roma" } : sel);
      if (mqTelefono.matches) resetBtn.classList.toggle("visible", sel.tipo !== "roma");
      var giro = ++giroApertura;
      carica().then(function () {
        if (!aperta || giro !== giroApertura) return;
        contenitore.innerHTML = "";
        var ok = window.Vista3D.apri({
          contenitore: contenitore,
          aree: QUARTIERI, municipi: MUNICIPI,
          palette: PALETTE, amaranto: AMARANTO,
          romani: municipioRomano, tipi: TIPO_SINGOLARE,
          categorie: SERVIZI_CATEGORIE, gruppi: SERVIZI_GRUPPI, attive: serviziAttive, icone: ICONE_SVG, grappolo: htmlGrappolo,
          servizi: function () { return caricaServizi().then(function (r) { return r ? serviziDati : null; }); },
          // scheda del servizio (componente della 2D, sopra la 3D); i 15 minuti sono della 2D:
          // si torna in 2D e partono dal servizio, come "15 min" della scheda d'area
          schedaServizio: function (props, ll, el) {
            apriSchedaServizio(props, ll, el, { quindici: function (p) {
              dopoChiusura = function () { setTimeout(function () { avvia15DaPunto(p); }, 0); };
              torna2D();
            } });
          },
          chiudiScheda: chiudiSchedaServizio,
          tipiAttivi: activeTipi,
          selezione: sel,
          via: viaPer3D(),
          ingresso: ingresso,
          riduciMovimento: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
          mobile: suMobile(),
          // telefono: la card della guida in alto (la camera inquadra sotto)
          alto: spazioGuida3D,
          // ogni scelta fatta in 3D e' un gesto (tocco, etichetta, vista d'insieme): le
          // statistiche contano municipio e area da qui, come i gestori della 2D
          onSeleziona: function (s) {
            if (s.tipo === "municipio") tracciaMunicipio(s.arabo);
            else if (s.tipo === "area") tracciaArea(entryDi(s.codice));
            viaSegue(s); pendente = s; scriviHash(s); segnaOrigine(s); elencoSegue(s); cornice3d(s);
          },
          // nell'area la scheda della 2D (mostraInfo) sopra la 3D; fuori dall'area via
          onArea: schedaArea,
          scheda: function () { return infoPanel.classList.contains("visible") ? infoPanel : null; },
          // telefono: il cartiglio della 2D in basso, sopra la 3D (spazio che occupa dal fondo)
          cartiglio: function () {
            var c = document.getElementById("cartiglio");
            return c && c.offsetHeight ? Math.round(document.getElementById("map-wrap").getBoundingClientRect().bottom - c.getBoundingClientRect().top + 12) : 0;
          },
          // nell'area su desktop il pannello Servizi in alto a destra: la camera lo evita,
          // anche se i dati arrivano dopo il volo (il pannello esce comunque, pieno o col
          // messaggio "non disponibili")
          pannello: function () { return areaServizi && !mqTelefono.matches ? destraServizi() : 0; },
          pannelloFondo: function () {
            if (!areaServizi || mqTelefono.matches || !serviziPanelEl || serviziPanelEl.hidden) return 0;
            var w = document.getElementById("map-wrap").getBoundingClientRect(), r = serviziPanelEl.getBoundingClientRect();
            return r.height ? Math.max(0, Math.round(r.bottom - w.top)) : 0;
          },
          // la camera dell'area chiede spazio: il pannello Servizi si riduce alla testata (e si
          // riapre da solo alla camera successiva o al ritorno in 2D, se lo aveva chiuso lei)
          compattaPannello: function (si) {
            if (!serviziPanelEl) return false;
            if (si) {
              if (serviziPanelEl.hidden || serviziPanelEl.classList.contains("collapsed")) return false;
              serviziPanelEl.classList.add("collapsed"); compattoDa3D = true;
              serviziPanelHead.setAttribute("aria-expanded", "false");
              posizionaServiziPanel();
              return true;
            }
            if (!compattoDa3D) return false;
            compattoDa3D = false;
            serviziPanelEl.classList.remove("collapsed");
            serviziPanelHead.setAttribute("aria-expanded", "true");
            posizionaServiziPanel();
            return false;
          },
          onErrore: function (msg, definitivo) { aperta = true; fallisci(msg, definitivo !== false); }
        });
        if (ok === false && aperta) fallisci("La vista 3D non è disponibile su questo dispositivo.", true);
        // statistiche: il tasto 3D conta solo qui, a 3D aperta davvero (non senza WebGL, non
        // nella presentazione, non se il caricamento fallisce); la guida e' esclusa da traccia
        else if (daTasto && aperta) traccia("vista", { modo: "3D" });
      }).catch(function () { if (aperta && giro === giroApertura) fallisci("La vista 3D non si è caricata: riprova più tardi.", false); });
    }

    function entryDi(codice) {
      return entries.filter(function (x) { return String(x.feature.properties.codice) === String(codice); })[0] || null;
    }
    function applicaA2D(s) {
      if (s.tipo === "area") {
        var e = entryDi(s.codice);
        if (!e) { pulisciHash(); return; }
        if (activeMunicipio && activeMunicipio !== String(e.feature.properties.municipio_num_arabo)) {
          activeMunicipio = ""; municipioSelect.value = ""; applicaFiltri(); aggiornaRollup();
        }
        // con la via aperta in 3D si torna sulla via intera, come la ricerca della 2D
        if (inVia(s) && viaAttiva.traccia) { selezionaEntry(e, false, true); inquadraVia(viaAttiva.traccia); }
        else selezionaEntry(e, false);
        return;
      }
      if (selectedLayer) deseleziona();
      // senza area nella 2D resta accesa la voce che la 3D ha evidenziato: via anche quella
      var att = document.querySelector("#area-list li.active");
      if (att) att.classList.remove("active");
      var valore = s.tipo === "municipio" ? String(s.arabo) : "";
      // il menu ha gia' seguito la 3D: conta il municipio che la 2D mostrava all'apertura
      if (municipioSelect.value !== valore || muni2D !== valore) {
        municipioSelect.value = valore; municipioSelect.dispatchEvent(new Event("change"));
      } else if (!valore) { rimuoviIngresso(); vistaInsieme(); }
      pulisciHash();
    }

    // applica=false: la 2D ha gia' qualcosa da fare (via cercata, presentazione, hash).
    // ripristina15: riaccende i 15 minuti chiusi all'apertura (ritorno "vero" in 2D).
    function chiudi3d(applica, ripristina15) {
      if (!aperta) return;
      aperta = false; segna(false);
      chiudiSchedaServizio();
      try { if (window.Vista3D) window.Vista3D.chiudi(); } catch (e) {}
      if (contenitore) { contenitore.hidden = true; contenitore.innerHTML = ""; contenitore.style.background = ""; }
      document.body.classList.remove("vista-3d-on");
      map.invalidateSize();
      servizi2D();
      aggiornaServizi2D();
      var s = pendente, punto = q15Salvato; pendente = null; q15Salvato = null;
      // senza una scelta da applicare (Indietro, ricerca, guida) l'elenco torna quello
      // della 2D; con una scelta resta quello della 3D e applicaA2D ci porta la 2D
      if (!(applica && s)) elenco2D();
      if (applica) {
        if (s) applicaA2D(s);
        else hash2D();
      }
      // una via aperta in 3D resta solo se la 2D e' su un'area che la via attraversa
      if (viaAttiva && !(selectedEntry && inVia({ tipo: "area", codice: selectedEntry.feature.properties.codice }))) pulisciVia();
      // la scheda torna quella della 2D: posizione e stile della 2D, aperta solo se la 2D
      // ha un'area scelta
      infoPanel.style.transform = ""; infoPanel.style.transition = "";
      cartiglioSel = null; aggiornaCartiglio(); aggiornaReset();
      if (selectedEntry) mostraInfo(selectedEntry.feature.properties);
      else if (infoPanel.classList.contains("visible")) {
        infoPanel.classList.remove("visible");
        if (serviziPanelEl) posizionaServiziPanel();
      }
      if (ripristina15 && punto) {
        q15Attiva(true, true);   // un ripristino: le statistiche non lo contano
        if (punto !== true) q15Piazza(punto, !s);
      }
      if (dopoChiusura) { var f = dopoChiusura; dopoChiusura = null; f(); }
    }
    var dopoChiusura = null;

    // Ritorno in 2D dal tasto, da Esc o dalla guida: se la voce di cronologia e' quella
    // aggiunta entrando, si torna indietro di una (la chiusura arriva con hashchange).
    function torna2D() {
      if (!aperta) return;
      if (voceNostra()) {
        ritornoApplica = true;
        history.back();
        setTimeout(function () { if (aperta && ritornoApplica) { ritornoApplica = false; chiudi3d(true, true); } }, 600);
      } else chiudi3d(true, true);
    }

    // Con la 3D aperta basta il pannello (coperto, ma pronto e coerente); i marker della
    // Leaflet nascosta si ridisegnano alla chiusura, quando aperta e' gia' false.
    function aggiornaServizi2D() {
      if (serviziStato !== "ok" || !ambitoServiziCorrente) return;
      disegnaServiziPanel();
      if (!aperta) disegnaServizi(false);
    }

    // ---------- Pannello Servizi della 2D sopra la 3D ----------
    // Nell'area il pannello vero della 2D (#servizi-panel), alzato sopra la 3D da
    // body.vista-3d-on, mostra le categorie dell'area della 3D; a Roma e nel municipio e'
    // nascosto. Le caselle cambiano serviziAttive come in 2D e la 3D si ridisegna; i marker
    // della Leaflet coperta no: li rifa' il ritorno in 2D (servizi2D + aggiornaServizi2D).
    // I punti del focus della 2D (serviziFocusCorrenti) restano quelli della 2D: il pannello
    // si disegna coi punti dell'area della 3D scambiandoli per un attimo, cosi' un
    // ridisegno della Leaflet (moveend, zoomend) non ci mette mai i servizi della 3D.
    function serviziArea(props) {
      areaServizi = props ? props.codice : null;
      if (!serviziPanelEl) return;
      if (!props) { serviziPanelEl.hidden = true; return; }
      var codice = areaServizi;
      var riempi = function (ok) {
        if (!aperta || areaServizi !== codice) return;
        if (!ok || serviziStato !== "ok") { mostraServiziNonDisponibili(); return; }
        var punti2D = serviziFocusCorrenti;
        serviziFocusCorrenti = serviziDati.filter(function (p) { return p.props.codice_area === codice; });
        try { disegnaServiziPanel(); } finally { serviziFocusCorrenti = punti2D; }
        serviziPanelEl.hidden = false;
        posizionaServiziPanel();
      };
      // dati gia' pronti: subito, cosi' la camera dell'area (opt.pannello) ne conosce
      // l'ingombro; se no quando arrivano, dopo il ridisegno della 2D a fine caricamento
      if (serviziStato === "ok") riempi(true);
      else Promise.resolve(caricaServizi()).then(riempi);
    }
    // Desktop, area della 3D: il pannello sale in cima alla mappa (sotto la legenda della
    // 2D, coperta, galleggiava a mezza altezza sopra la tessera), a sinistra dei pulsanti
    // dello zoom della 3D, e l'elenco scende fino all'attribuzione. posizionaServiziPanel
    // della 2D lo mette sotto la legenda: si chiama lei (stile, 15 minuti) e poi si corregge.
    // Riassegnata qui: mostraInfo, la scheda e la 3D passano tutte da questo nome (resize e
    // ResizeObserver della legenda tengono l'originale: c'e' il resize qui sotto).
    // margine destro del pannello (a sinistra dello zoom della 3D) e, con larghezza=true,
    // tutto lo spazio che occupa da destra (anche da nascosto: max-width del CSS)
    function destraServizi(larghezza) {
      if (!serviziPanelEl) return 0;
      var wrap = document.getElementById("map-wrap").getBoundingClientRect(), destra = 12;
      var zoom = contenitore && contenitore.querySelector(".maplibregl-ctrl-top-right .maplibregl-ctrl");
      if (zoom && zoom.offsetWidth) destra = Math.round(wrap.right - zoom.getBoundingClientRect().left + 10);
      if (larghezza === false) return destra;
      return destra + (serviziPanelEl.offsetWidth || parseFloat(getComputedStyle(serviziPanelEl).maxWidth) || 210);
    }
    var posizionaServiziPanel2D = posizionaServiziPanel;
    posizionaServiziPanel = function () {
      var spazio = posizionaServiziPanel2D();
      if (!aperta || !areaServizi || !serviziPanelEl || mqTelefono.matches || !contenitore) return spazio;
      var wrap = document.getElementById("map-wrap").getBoundingClientRect();
      serviziPanelEl.style.top = "12px";
      serviziPanelEl.style.right = destraServizi(false) + "px";
      var fondo = wrap.bottom - 12, attr = contenitore.querySelector(".maplibregl-ctrl-bottom-right .maplibregl-ctrl");
      if (attr && attr.offsetHeight) fondo = Math.min(fondo, attr.getBoundingClientRect().top - 8);
      // finestra stretta: la scheda dell'area puo' stare sotto il pannello (le colonne si toccano)
      var sch = infoPanel.classList.contains("visible") ? infoPanel.getBoundingClientRect() : null;
      if (sch && sch.width) {
        var pr = serviziPanelEl.getBoundingClientRect();
        if (sch.right > pr.left && sch.left < pr.right && sch.top > pr.top) fondo = Math.min(fondo, sch.top - 10);
      }
      var testa = serviziPanelHead.getBoundingClientRect().height || 36;
      spazio = Math.round(fondo - (wrap.top + 12) - testa - 13);
      serviziPanelBody.style.maxHeight = Math.max(SERVIZI_CORPO_MIN, spazio) + "px";
      return spazio;
    };
    window.addEventListener("resize", function () { if (aperta && areaServizi) posizionaServiziPanel(); });
    // la scheda cambia altezza quando arrivano i servizi: il pannello ricalcola il suo fondo
    if (window.ResizeObserver) new ResizeObserver(function () { if (aperta && areaServizi) posizionaServiziPanel(); }).observe(document.getElementById("info-panel"));
    // Al ritorno: il pannello torna all'ambito della 2D (marker ridisegnati dal chiamante).
    function servizi2D() {
      areaServizi = null;
      if (compattoDa3D && serviziPanelEl) {
        compattoDa3D = false; serviziPanelEl.classList.remove("collapsed");
        if (serviziPanelHead) serviziPanelHead.setAttribute("aria-expanded", "true");
      }
      if (!serviziPanelEl || (q15 && q15.attivo)) return;
      serviziPanelEl.hidden = !ambitoServiziCorrente || serviziStato !== "ok";
      posizionaServiziPanel();
    }
    // Caselle cambiate a 3D aperta: lo stesso stato del gestore della 2D (serviziAttive,
    // casella del gruppo), poi la 3D. In cattura e fermato qui: il gestore della 2D
    // ridisegnerebbe anche i marker della Leaflet coperta.
    // ATTENZIONE: copia i gestori change di disegnaServiziPanel nel template (casella del
    // gruppo e casella della categoria): se cambiano li', questa va riallineata.
    if (serviziPanelHead) serviziPanelHead.addEventListener("click", function () { compattoDa3D = false; });
    var serviziPanelBodyEl = document.getElementById("servizi-panel-body");
    if (serviziPanelBodyEl) serviziPanelBodyEl.addEventListener("change", function (ev) {
      if (!aperta) return;
      var t = ev.target, det = t && t.closest ? t.closest(".sp-gruppo") : null;
      if (!det || t.type !== "checkbox") return;
      ev.stopPropagation();
      var gruppo = det.querySelector(".sp-chk-gruppo");
      var caselle = [].slice.call(det.querySelectorAll('input[id^="sp-chk-"]'));
      var categorie = caselle.map(function (c) { return { chiave: c.id.slice(7) }; });
      if (t === gruppo) caselle.forEach(function (c) { c.checked = t.checked; });
      caselle.forEach(function (c) { serviziAttive[c.id.slice(7)] = c.checked; });
      statoCasellaGruppo(gruppo, categorie);
      if (window.Vista3D && window.Vista3D.attiveCambiate) window.Vista3D.attiveCambiate();
    }, true);

    // ---------- Elenco che segue la 3D ----------
    // Le scelte fatte dentro la 3D arrivano all'elenco come dalla 2D: menu municipio,
    // filtro, riepilogo, voce evidenziata. La mappa Leaflet non si muove, e la sua area
    // scelta non viene deselezionata dal filtro (toglierebbe la scheda e il pannello
    // sopra la 3D): al ritorno ci pensa applicaA2D.
    // Il filtro senza la deselezione della 2D (applicaFiltri chiude l'area scelta se il
    // filtro la nasconde): l'elenco e le sagome della Leaflet possono restare
    // incoerenti con l'area della 2D solo finche' la 3D e' aperta: alla chiusura le
    // riallinea elenco2D() (senza applicare) o applicaA2D (con una scelta da applicare).
    function filtraSenzaDeselezionare() {
      var sel = selectedEntry;
      selectedEntry = null;
      try { applicaFiltri(); } finally { selectedEntry = sel; }
    }
    function filtraElenco(valore) {
      municipioSelect.value = valore;
      if (activeMunicipio === valore) return;
      activeMunicipio = valore;
      filtraSenzaDeselezionare();
      aggiornaRollup();
    }
    // Chiusura senza applicare: l'elenco torna allo stato della 2D (menu, filtro vero,
    // riepilogo, voce dell'area scelta), coerente con la scheda e le sagome della Leaflet.
    function elenco2D() {
      municipioSelect.value = muni2D;
      activeMunicipio = muni2D;
      applicaFiltri();
      aggiornaRollup();
      var att = document.querySelector("#area-list li.active");
      if (att) att.classList.remove("active");
      if (selectedEntry) evidenziaLista(selectedEntry);
    }
    // La ricerca scritta a 3D aperta filtra l'elenco come in 2D, ma senza deselezionare
    // l'area della 2D (toglierebbe la scheda sopra la 3D): copia il gestore input di searchEl
    // nel template (testoRicerca, applicaFiltri, aggiornaVie, e su telefono l'elenco sotto la
    // barra, cercaApri), da riallineare se cambia.
    searchEl.addEventListener("input", function (ev) {
      if (!aperta) return;
      ev.stopImmediatePropagation();
      testoRicerca = foldAccenti(searchEl.value.trim());
      if (vieStato === "errore" && testoRicerca.length >= 3) caricaVie();
      filtraSenzaDeselezionare();
      aggiornaVie();
      cercaApri(true);
    }, true);
    function elencoSegue(s) {
      if (s.tipo === "area") {
        var e = entryDi(s.codice);
        if (!e) return;
        filtraElenco(String(e.feature.properties.municipio_num_arabo));
        evidenziaLista(e);
        return;
      }
      filtraElenco(s.tipo === "municipio" ? String(s.arabo) : "");
      var att = document.querySelector("#area-list li.active");
      if (att) att.classList.remove("active");
    }

    function segnaOrigine(s) { if (s.tipo !== "area") origine = s; }
    function vola3d(s) {
      viaSegue(s);
      pendente = s; scriviHash(s); segnaOrigine(s); cornice3d(s);
      if (window.Vista3D) window.Vista3D.seleziona(s);
    }

    // ---------- Via cercata con la 3D aperta ----------
    // La via e' quella della 2D (viaAttiva): la scheda sopra la 3D ne mostra il blocco "via"
    // (aggiornaBloccoVia) e la Leaflet coperta ne ha il tracciato, pronto per il ritorno in 2D.
    // La 3D vola sull'area di riferimento e dipinge il tracciato sul tetto della tessera
    // (Vista3D.via). Un'area che la via attraversa la tiene (chip della scheda, tocco sulla
    // 3D); ogni altra scelta, la x, Esc e "Vista d'insieme" la tolgono, come nella 2D.
    function inVia(s) { return !!(viaAttiva && s && s.tipo === "area" && viaAttiva.via.aree.indexOf(s.codice) !== -1); }
    function viaSegue(s) { if (viaAttiva && !inVia(s)) pulisciVia(); }
    function viaDiNome(nome) { return VIE ? VIE.filter(function (v) { return v.nome === nome; })[0] || null : null; }
    function viaPer3D() { return viaAttiva && viaAttiva.linee ? { nome: viaAttiva.via.nome, linee: viaAttiva.linee } : null; }
    // la via diventa quella attiva (tolta dal tetto quella di prima) e il tracciato si carica
    function caricaViaAttiva(v) {
      var gen = {};
      viaAttiva = { via: v, gen: gen };
      viaLayer.clearLayers();
      if (aperta && window.Vista3D && window.Vista3D.via) window.Vista3D.via(null);
      lineeVia(v).then(function (linee) {
        if (viaAttiva && viaAttiva.gen === gen && linee.length) tracciaVia(linee);
      }).catch(function () {});
    }
    function mostraVia3d(v) {
      var rif = areaDiRiferimento(v);
      if (!rif) return;
      caricaViaAttiva(v);
      var s = { tipo: "area", codice: rif.feature.properties.codice };
      vola3d(s); elencoSegue(s);
      if (suMobile()) chiudiDrawer();
    }
    function apriViaDaLink(nome) {
      caricaVie().then(function () {
        var v = viaDiNome(nome);
        if (v && aperta) mostraVia3d(v);
        else if (!v) avviso("La via del link non si è trovata.");
      });
    }
    // Riassegnate: la ricerca (risultati della barra laterale e della barra del telefono,
    // Invio nel campo) e i chip del blocco "via" le chiamano per nome.
    var mostraVia2D = mostraVia;
    mostraVia = function (v) { if (aperta && !presentazioneOn) mostraVia3d(v); else mostraVia2D(v); };
    var selezionaEntry2D = selezionaEntry;
    selezionaEntry = function (entry, daLista) {
      if (!aperta || presentazioneOn) return selezionaEntry2D.apply(this, arguments);
      var s = { tipo: "area", codice: entry.feature.properties.codice };
      vola3d(s); elencoSegue(s);
      if (daLista && suMobile()) chiudiDrawer();
    };
    // il tracciato arrivato (anche da una ricerca della 2D poco prima del tasto 3D) va sul tetto
    var tracciaVia2D = tracciaVia;
    tracciaVia = function (linee) {
      var t = tracciaVia2D(linee);
      viaAttiva.linee = linee;
      if (aperta && window.Vista3D && window.Vista3D.via) window.Vista3D.via(viaPer3D());
      return t;
    };
    var pulisciVia2D = pulisciVia;
    pulisciVia = function () {
      pulisciVia2D();
      if (aperta && window.Vista3D && window.Vista3D.via) window.Vista3D.via(null);
    };

    // ---------- Deseleziona della 2D con la 3D aperta ----------
    // Esc della 2D (anche dalla ricerca vuota o dopo "Cos'e'"), i filtri per tipo e ogni
    // altro percorso della 2D che deseleziona toglierebbero la scheda (e il pannello Servizi)
    // mentre la 3D resta nell'area. Con la 3D aperta la 2D non deseleziona: la sua area resta
    // scelta e al ritorno la riallineano applicaA2D o elenco2D (che rifa' applicaFiltri a 3D
    // chiusa). La presentazione chiude la 3D e deve poter ripulire la 2D: li' passa.
    // Riassegnata: chi chiama deseleziona per nome (applicaFiltri, Esc, ...) passa di qui.
    var deseleziona2D = deseleziona;
    deseleziona = function () {
      if (aperta && !presentazioneOn) return;
      deseleziona2D.apply(this, arguments);
    };

    // ---------- Scheda della 2D sopra la 3D ----------
    // Nell'area la scheda e' quella vera della 2D (#info-panel, riempita da mostraInfo), alzata
    // sopra la 3D da body.vista-3d-on. Su telefono e' la scheda bassa della 2D (maniglia,
    // tocco e trascinamento sono della 2D); la x e il trascinamento che lascia l'area non
    // arrivano a deseleziona della 2D: qui diventano una selezione della 3D.
    var infoPanel = document.getElementById("info-panel");
    function schedaArea(props) {
      serviziArea(props);
      if (!props) {
        infoPanel.classList.remove("visible");
        infoPanel.style.transform = ""; infoPanel.style.transition = "";
        if (serviziPanelEl) posizionaServiziPanel();
        return;
      }
      // ogni ingresso in un'area parte con la scheda bassa (la camera inquadra sopra di lei)
      infoPanel.scrollTop = 0;
      mostraInfo(props);
      schedaAlta(false);
    }
    // deseleziona della 2D tradotto in 3D: la x (e ogni altro percorso che lascia l'area)
    // porta sempre al municipio dell'area, da qualsiasi ingresso; li' "Vista d'insieme" resta
    // e porta a Roma. L'elenco si riallinea al municipio.
    // indietro (tasto indietro della barra): si sale al livello da cui si e' entrati
    // nell'area, Roma intera se si veniva da Roma.
    function deseleziona3d(indietro) {
      var s = window.Vista3D && window.Vista3D.selezione();
      var e = s && s.tipo === "area" ? entryDi(s.codice) : null;
      var dest = e && !(indietro && origine.tipo === "roma") ?
        { tipo: "municipio", arabo: parseInt(e.feature.properties.municipio_num_arabo, 10) } : { tipo: "roma" };
      pulisciVia();
      schedaArea(null);
      vola3d(dest);
      elencoSegue(dest);
    }
    var lasciaArea2D = lasciaArea;
    lasciaArea = function () { if (aperta && !presentazioneOn) deseleziona3d(); else lasciaArea2D(); };
    function dentroScheda(ev) { return aperta && ev.target && ev.target.closest && ev.target.closest("#info-panel"); }
    document.addEventListener("click", function (ev) {
      if (!dentroScheda(ev)) return;
      if (ev.target.closest("#info-close")) { ev.stopPropagation(); ev.preventDefault(); deseleziona3d(); }
    }, true);

    // ---------- Cornice del telefono sopra la 3D ----------
    // Il cartiglio della 2D dice il livello della 3D (Roma o il municipio); il tasto indietro
    // della barra sale di un livello nella 3D: dall'area al livello da cui si era entrati,
    // dal municipio a Roma intera.
    function cornice3d(s) {
      cartiglioSel = s && s.tipo !== "area" ? s : cartiglioSel;
      aggiornaCartiglio();
      if (mqTelefono.matches) resetBtn.classList.toggle("visible", !!s && s.tipo !== "roma");
    }
    resetBtn.addEventListener("click", function (ev) {
      if (!aperta) return;
      ev.stopImmediatePropagation(); ev.preventDefault();
      var s = window.Vista3D && window.Vista3D.selezione();
      if (s && s.tipo === "area") deseleziona3d(true);
      else { var dest = { tipo: "roma" }; vola3d(dest); elencoSegue(dest); }
    }, true);
    // "15 min" della scheda: i 15 minuti sono della 2D. Si torna in 2D (come col tasto 2D,
    // la cronologia resta pulita) e, a 2D pronta sull'area, partono da li'.
    document.getElementById("info-q15-btn").addEventListener("click", function (ev) {
      if (!aperta) return;
      ev.stopImmediatePropagation(); ev.preventDefault();
      dopoChiusura = function () { setTimeout(avvia15DaScheda, 0); };
      torna2D();
    }, true);
    // Livelli > "A piedi in 15 minuti da un punto" (telefono): stessa strada. Senza, i 15
    // minuti si accendevano sotto la 3D, col pannello coperto e il cartiglio sparito.
    document.getElementById("livelli-q15").addEventListener("click", function (ev) {
      if (!aperta) return;
      ev.stopImmediatePropagation(); ev.preventDefault();
      chiudiLivelli();
      dopoChiusura = function () { setTimeout(function () { if (!q15.attivo) q15Attiva(false); }, 0); };
      torna2D();
    }, true);
    // Il tasto posizione sopra la 3D: l'area trovata si apre in 3D.
    var posizioneTrovata2D = posizioneTrovata;
    posizioneTrovata = function (e, ll) {
      if (!aperta) { posizioneTrovata2D(e, ll); return; }
      var s = { tipo: "area", codice: e.feature.properties.codice };
      vola3d(s); elencoSegue(s);
    };

    // statistiche: il tasto usato davvero (non Esc, non la guida, non i link); il 3D si conta
    // in apri3d, quando la 3D si e' aperta
    btn3d.addEventListener("click", function () { apri3d(null, true); });
    btn2d.addEventListener("click", function () { if (aperta) traccia("vista", { modo: "2D" }); torna2D(); });

    // In 3D l'elenco, il filtro municipio e la ricerca (aree e vie, vedi mostraVia e
    // selezionaEntry sopra) fanno volare la 3D; la guida e la presentazione riportano in 2D
    // (lassu' non ci sono).
    var sidebar = document.getElementById("sidebar");
    function areaDaLi(target) {
      var li = target && target.closest ? target.closest("#area-list li") : null;
      return li ? entries.filter(function (x) { return x.li === li; })[0] : null;
    }
    function scegliDaElenco(ev) {
      var e = areaDaLi(ev.target);
      if (!e) return false;
      ev.stopPropagation(); ev.preventDefault();
      tracciaArea(e);
      vola3d({ tipo: "area", codice: e.feature.properties.codice });
      evidenziaLista(e);
      if (suMobile()) chiudiDrawer();
      return true;
    }
    sidebar.addEventListener("click", function (ev) {
      if (!aperta) return;
      scegliDaElenco(ev);
    }, true);
    // Invio nel campo e sui risultati per via li gestisce la 2D (che apre con mostraVia e
    // selezionaEntry, o col clic sulla voce dell'elenco)
    sidebar.addEventListener("keydown", function (ev) {
      if (!aperta || (ev.key !== "Enter" && ev.key !== " ")) return;
      if (ev.target === searchEl || (ev.target.closest && ev.target.closest("#street-results"))) return;
      scegliDaElenco(ev);
    }, true);
    sidebar.addEventListener("change", function (ev) {
      if (!aperta || ev.target !== municipioSelect) return;
      ev.stopPropagation();
      var v = municipioSelect.value, dest = v ? { tipo: "municipio", arabo: parseInt(v, 10) } : { tipo: "roma" };
      if (v && ev.isTrusted) tracciaMunicipio(v);   // la legenda conta da se'
      activeMunicipio = null;   // filtraElenco riapplica sempre il filtro
      elencoSegue(dest);        // menu, filtro e nessuna voce evidenziata, come la 2D
      vola3d(dest);
    }, true);
    // Filtri per tipo (Rioni, Quartieri, Zone funzionali): il pulsante della 2D cambia
    // activeTipi e applica i suoi filtri (sul proprio click, prima di questo che arriva in
    // risalita; la sua deselezione e' fermata sopra); la 3D aperta li segue. Se il tipo
    // spento e' quello dell'area della 3D, come la 2D: l'area si lascia (stessa strada della x).
    var tipoButtons = document.getElementById("tipo-buttons");
    if (tipoButtons) tipoButtons.addEventListener("click", function (ev) {
      if (!aperta || !window.Vista3D || !window.Vista3D.filtraTipi) return;
      if (!(ev.target.closest && ev.target.closest(".tipo-btn"))) return;
      window.Vista3D.filtraTipi(activeTipi);
      var s = window.Vista3D.selezione(), e = s && s.tipo === "area" ? entryDi(s.codice) : null;
      if (e && !activeTipi[e.feature.properties.tipo]) deseleziona3d();
    });
    // La guida alla mappa (template, costruisciStep3D) racconta la 3D e finisce nei 15 minuti
    // della 2D: muove la 3D da qui, con le stesse strade del tasto, dell'elenco e della x.
    guida3D = {
      // si prova WebGL ora: la guida sceglie fra la sua storia in 3D e il tour della 2D
      disponibile: function () {
        if (gruppoEl.hidden || presentazioneOn) return false;
        if (!webglProvato) {
          webglProvato = true;
          if (!webglDisponibile()) { gruppoEl.hidden = true; return false; }
        }
        return true;
      },
      aperta: function () { return aperta; },
      // dalla 2D apre la 3D gia' li' (una voce di cronologia, come il tasto); in 3D ci vola,
      // se non c'e' gia'
      vola: function (s) {
        if (!aperta) { apri3d(s, true); return; }
        var cor = window.Vista3D && window.Vista3D.selezione ? window.Vista3D.selezione() : pendente;
        if (cor && JSON.stringify(cor) === JSON.stringify(s)) return;
        vola3d(s); elencoSegue(s);
      },
      // come "15 min" della scheda: si torna in 2D e poi, a 2D pronta, parte poi()
      torna2D: function (poi) {
        if (!aperta) { poi(); return; }
        dopoChiusura = function () { setTimeout(poi, 0); };
        torna2D();
      }
    };

    // Esc torna in 2D, se non c'e' un drawer, un pannello o un popup aperto da chiudere prima.
    document.addEventListener("keydown", function (ev) {
      if (!aperta || ev.key !== "Escape") return;
      var t = ev.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (sidebar.classList.contains("open") || document.getElementById("about-scrim").classList.contains("open")) return;
      ev.stopPropagation(); ev.preventDefault();
      var pop = contenitore && contenitore.querySelector(".v3d-popup:not([hidden])");
      if (pop) { if (window.Vista3D && window.Vista3D.chiudiPopup) window.Vista3D.chiudiPopup(); else pop.hidden = true; return; }
      // con una via aperta Esc fa come nella 2D: lascia l'area e la via (come la x)
      if (viaAttiva) { deseleziona3d(); return; }
      torna2D();
    }, true);

    // Avanti/indietro (e i link incollati): una voce #3d apre la 3D, una voce senza la chiude.
    window.addEventListener("hashchange", function () {
      var s = selDaHash();
      if (s && !aperta) apri3d(s, false);
      else if (s && aperta && s.tipo === "via") apriViaDaLink(s.nome);
      else if (s && aperta && ((s.tipo === "area" && !entryDi(s.codice)) || (s.tipo === "municipio" && !(s.arabo >= 1 && s.arabo <= 15)))) {
        // hash non valido a 3D aperta: l'URL torna a quello della selezione corrente
        var cor = window.Vista3D && window.Vista3D.selezione && window.Vista3D.selezione();
        scriviHash(cor && cor.tipo ? cor : (pendente && pendente.tipo ? pendente : { tipo: "roma" }));
      }
      else if (!s && aperta) { var ap = ritornoApplica; ritornoApplica = false; chiudi3d(ap, !presentazioneAttivaDaHash()); }
    });
    var ponte = null;   // il passaggio dall'intro (avviaSottoIntro, sotto)
    var iniziale = selDaHash();
    if (iniziale) apri3d(iniziale, false);
    // Senza hash si entra in 3D: la 2D e' la mappa dei 15 minuti, ci
    // si arriva col tasto 2D. Un link della 2D (#<codice>, #via=, #15=, #copertura) apre la
    // 2D come prima; ?vista=2d pure.
    else if (!leggiHash() && !/[?&]vista=2d\b/.test(location.search)) {
      carica().catch(function () {});
      if (window.MAPPA_INTRO.attiva && window.MAPPA_INTRO.disegno) avviaSottoIntro();
      else window.MAPPA_INTRO.poi(function () {
        if (!aperta && !leggiHash() && !presentazioneOn) apri3d({ tipo: "roma" }, false, true);
      });
    }

    // Con l'intro la 3D nasce sotto il disegno, piatta, nella stessa inquadratura e con lo
    // stesso aspetto (fondo crema, il solo contorno di Roma); al via dell'intro Roma si compone
    // tessera per tessera ("il mosaico", vista-3d.js) e scende alla vista di sempre. Mai la 2D
    // in mezzo. Lo stato del passaggio e' MAPPA_INTRO.ponte ({ stato, allinea, parti, salta }):
    // "attesa" (la 3D si prepara), "pronta" (parti() avvia il mosaico), "partita" (l'intro
    // l'ha avviato), "no" (niente 3D: l'intro si posa sulla 2D come prima). Durante il mosaico
    // la 3D racconta all'intro le tessere a terra (MAPPA_INTRO.conta) e la citta' composta
    // (MAPPA_INTRO.composta); a intro finita quelle chiamate non fanno nulla.
    // Solo dichiarazioni di funzione (e una var senza valore): avviaSottoIntro gira piu' in alto,
    // e l'intro puo' richiamarla subito (disegnato).
    var compostaInviata;
    // inoltro a una funzione dell'intro, solo se l'intro e' ancora in corso e la conosce
    // (con un template piu' vecchio non c'e': niente, senza errori)
    function allIntro(nome, argomenti) {
      var I = window.MAPPA_INTRO;
      if (!I || !I.attiva || typeof I[nome] !== "function") return;
      try { I[nome].apply(I, argomenti); } catch (e) { if (window.console) console.error(e); }
    }
    function contaIntro(atterrate, totali) { allIntro("conta", [atterrate, totali]); }
    // composta una volta sola: dal mosaico, o da fallisci se la 3D si interrompe dopo il via
    function compostaIntro() {
      if (compostaInviata) return;
      compostaInviata = true;
      allIntro("composta", []);
    }
    // la 3D non arriva (o si e' interrotta prima del via): l'intro si posa sulla 2D
    function ponteNo() {
      if (!ponte || (ponte.stato !== "attesa" && ponte.stato !== "pronta")) return;
      ponte.stato = "no";
      if (window.MAPPA_INTRO.ponteCambiato) window.MAPPA_INTRO.ponteCambiato();
    }
    function avviaSottoIntro() {
      var I = window.MAPPA_INTRO;
      ponte = I.ponte = { stato: "attesa", allinea: null, parti: null, salta: null };
      I.disegnato(function () {
        if (aperta || leggiHash() || presentazioneOn) { ponteNo(); return; }
        apri3d({ tipo: "roma" }, false, true, {
          disegno: function () { return I.attiva && I.disegno ? I.disegno() : null; },
          // gli anelli del tratto dell'intro; senza (template vecchio) la 3D non disegna la linea
          contorno: function () { return typeof I.contorno === "function" ? I.contorno() : null; },
          breve: !!I.breve,
          pronta: function (allinea, parti, salta) {
            if (ponte.stato !== "attesa") return;
            // intro saltata (MAPPA_INTRO.saltata, anche se sta ancora svanendo): Roma subito e senza
            // animazione; intro uscita da se' perche' la 3D tardava: il mosaico nella versione breve
            if (I.saltata) { ponte.stato = "partita"; parti(true); salta(); return; }
            if (!I.attiva) { ponte.stato = "partita"; parti(true); return; }
            ponte.allinea = allinea; ponte.parti = parti; ponte.salta = salta; ponte.stato = "pronta";
            if (I.ponteCambiato) I.ponteCambiato();
          },
          conta: contaIntro,
          composta: compostaIntro
        });
        // senza WebGL vero apri3d non apre: si resta in 2D, l'intro si posa li'
        if (!aperta) { ponteNo(); return; }
        // Il fondo della 3D resta il crema dell'intro finche' la mappa non disegna (il beige di
        // #vista-3d tornava sotto l'interfaccia). Se l'intro esce prima che la 3D sia pronta,
        // "Preparo la vista 3D…" come all'apertura dal tasto (data-attesa, aggancio.css), finche'
        // la 3D resta a "carico"; poi il mosaico breve.
        if (contenitore) contenitore.style.background = "var(--bg)";
        I.poi(function () {
          if (aperta && contenitore && ponte && ponte.stato === "attesa") contenitore.setAttribute("data-attesa", "");
        });
      });
    }
  })();
