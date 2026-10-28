/* Cartographie foncière : lotissements de Bingerville
   Plateforme de présentation — MapLibre GL JS, données statiques (GeoJSON).
   Statistiques : couche « conformite » (un statut par lotissement).
   Carte : couche « Assemblage BINGERVILLE » (lots ; conformité lot par lot). */
(() => {
"use strict";

const COL = {
  asm: "#2F6FD6",
  conf: { "Conforme": "#2E9E5B", "Non conforme": "#D64545" },
  statut: { "Normale": "#2F6FD6", "Régularisation": "#8E4FC9" },
  lotc: ["#2E9E5B", "#D64545", "#A9B3B8"],           // classe lot : 0 conforme, 1 non conforme (non_conforme + modifié), 2 non renseigné
  chev: "#E0245E", promo: "#0B9A9A", muted: "#B9C2C6", involved: "#5B6B73"
};
const CONF_ORDER = ["Conforme", "Non conforme"];
const STAT_ORDER = ["Normale", "Régularisation"];
const STAT_LABEL = { "Normale": "Approbation par voie normale", "Régularisation": "Approbation par voie de régularisation" };

/* Projet 4 — combinaisons : conformité (couche conformite) × chevauchement × approbation (arrêté reçu) */
const COMBOS = [
  { n: 1, conf: "C", chev: false, app: true, enjeu: "Situation régulière", color: "#1B7F4B" },
  { n: 2, conf: "C", chev: false, app: false, enjeu: "Régularisation administrative", color: "#86C77F" },
  { n: 3, conf: "C", chev: true, app: true, enjeu: "Conflit de limites entre plans", color: "#E9C93F" },
  { n: 4, conf: "C", chev: true, app: false, enjeu: "Conflit de limites, arrêté non reçu", color: "#F2A541" },
  { n: 5, conf: "NC", chev: false, app: true, enjeu: "Écart terrain / plan approuvé", color: "#E8743B" },
  { n: 6, conf: "NC", chev: false, app: false, enjeu: "Écart terrain, arrêté non reçu", color: "#D1492B" },
  { n: 7, conf: "NC", chev: true, app: true, enjeu: "Écart terrain et conflit de limites", color: "#B0202E" },
  { n: 8, conf: "NC", chev: true, app: false, enjeu: "Enjeu critique", color: "#6B0D22" }
];
const comboLabel = c => `${c.conf === "C" ? "Conforme" : "Non conforme"} · ${c.chev ? "chevauchement" : "sans chevauchement"} · ${c.app ? "approuvé" : "non approuvé"}`;
const comboOf = l => COMBOS.find(c => c.conf === (l.conformite === "Conforme" ? "C" : "NC") && c.chev === (l.chevauchements.length > 0) && c.app === l.approuve).n;

const BASEMAPS = {
  light: { tiles: ["https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png", "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png"], attribution: "© OpenStreetMap © CARTO", maxzoom: 20 },
  sat: { tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], attribution: "Imagerie © Esri, Maxar, Earthstar Geographics", maxzoom: 19 },
  osm: { tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], attribution: "© contributeurs OpenStreetMap", maxzoom: 19 },
  mq: { tiles: mqTiles("sat"), attribution: "Imagerie © MapQuest", maxzoom: 18 },
  mqhyb: { tiles: mqTiles("sat"), overlay: mqTiles("hyb"), attribution: "Imagerie © MapQuest", maxzoom: 18 }
};
/* MapQuest : si une clé est exigée, la renseigner ici (compte gratuit sur developer.mapquest.com). */
function mqTiles(style) {
  const MQ_KEY = "";
  return ["a", "b", "c", "d"].map(s => `https://${s}.tiles.mapquest.com/render/latest/${style}/{z}/{x}/{y}/256/png${MQ_KEY ? "?key=" + MQ_KEY : ""}`);
}

const S = { mode: "overview", visible: new Set(), confFilter: null, statFilter: null, showPromo: true, showChev: true, showNoms: true,
  selected: null, selChev: null, basemap: "light", bmErrors: 0 };
const TX = window.TEXTES || {};
let META, BY_ID, BY_K, ASM, CHEV, PROG, S3I, map, popup;

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const fmt = (n, d = 0) => Number(n).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const count = pred => META.lotissements.filter(pred).length;
const ALL = () => new Set(META.lotissements.map(l => l.id));

/* ================================================================ chargement */
async function load() {
  const j = u => fetch(u).then(r => { if (!r.ok) throw new Error(u); return r.json(); });
  [META, ASM, CHEV, PROG, S3I] = await Promise.all([j("data/lotissements.json"), j("data/assemblage.geojson"),
    j("data/chevauchements.geojson"), j("data/programmes.geojson"), j("data/promotions_s3i.geojson")]);
  META.lotissements.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  META.lotissements.forEach((l, i) => { l.num = i + 1; l.combo = comboOf(l); });
  BY_ID = Object.fromEntries(META.lotissements.map(l => [l.id, l]));
  BY_K = Object.fromEntries(META.lotissements.map(l => [l.k, l]));
  // attributs du lotissement recopiés sur chaque lot (pour les styles par mode)
  ASM.features.forEach(f => { const l = BY_K[f.properties.k]; f.properties.st = l.statut; f.properties.lc = l.conformite; f.properties.dc = f.properties.c === 0 ? "Conforme" : f.properties.c === 1 ? "Non conforme" : l.conformite; /* classe du lot dans l'assemblage QGIS */ f.properties.cb = l.combo; f.properties.nc = l.chevauchements.length; });
  CHEV.features.forEach(f => { let ids = f.properties.ids; if (typeof ids === "string") try { ids = JSON.parse(ids); } catch { ids = []; } f.properties.idsArr = ids || []; });
  S.visible = ALL();
}

/* ================================================================ carte */
function hatchImage() {
  const c = document.createElement("canvas"); c.width = c.height = 12;
  const x = c.getContext("2d"); x.strokeStyle = COL.chev; x.lineWidth = 2;
  x.beginPath(); for (let i = -12; i <= 24; i += 6) { x.moveTo(i, 12); x.lineTo(i + 12, 0); } x.stroke();
  return x.getImageData(0, 0, 12, 12);
}

function initMap() {
  const b = META.bbox;
  map = new maplibregl.Map({
    container: "map",
    style: { version: 8, glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources: { base: { type: "raster", tileSize: 256, ...BASEMAPS.light } },
      layers: [{ id: "bg", type: "background", paint: { "background-color": "#EEEBE4" } }, { id: "base", type: "raster", source: "base" }] },
    bounds: [[b[0], b[1]], [b[2], b[3]]], fitBoundsOptions: { padding: 40 },
    attributionControl: { compact: true, customAttribution: "Données : travaux SIG lotissements de Bingerville" },
    maxZoom: 20, minZoom: 9
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
  map.addControl(new maplibregl.FullscreenControl(), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
  popup = new maplibregl.Popup({ closeButton: true, maxWidth: "300px" });

  map.on("load", () => {
    map.addImage("hatch", hatchImage(), { pixelRatio: 2 });
    map.addSource("asm", { type: "geojson", data: ASM, tolerance: 0.25 });
    map.addSource("chev", { type: "geojson", data: CHEV });
    map.addSource("s3i", { type: "geojson", data: S3I });
    map.addSource("prog", { type: "geojson", data: PROG });
    map.addSource("labels", { type: "geojson", data: { type: "FeatureCollection", features: META.lotissements.map(l => ({ type: "Feature", properties: { id: l.id, nom: l.nom }, geometry: { type: "Point", coordinates: l.centre } })) } });

    map.addLayer({ id: "lots-fill", type: "fill", source: "asm", paint: { "fill-color": COL.asm, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0.8, 17, 0.6] } });
    map.addLayer({ id: "lots-line", type: "line", source: "asm", minzoom: 14.5,
      paint: { "line-color": "#fff", "line-width": ["interpolate", ["linear"], ["zoom"], 14.5, 0.3, 18, 1.2], "line-opacity": 0.85 } });
    map.addLayer({ id: "s3i-fill", type: "fill", source: "s3i", minzoom: 13, paint: { "fill-color": COL.promo, "fill-opacity": 0.15 } });
    map.addLayer({ id: "s3i-line", type: "line", source: "s3i", minzoom: 13, paint: { "line-color": COL.promo, "line-width": 1.6, "line-dasharray": [2, 1] } });
    map.addLayer({ id: "chev-fill", type: "fill", source: "chev", paint: { "fill-pattern": "hatch", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0.95, 16, 0.45] } });
    map.addLayer({ id: "chev-line", type: "line", source: "chev", paint: { "line-color": COL.chev, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.2, 16, 2.6] } });
    map.addLayer({ id: "chev-sel", type: "line", source: "chev", filter: ["==", ["get", "id"], ""], paint: { "line-color": "#14232A", "line-width": 3.5 } });
    map.addLayer({ id: "sel-line", type: "line", source: "asm", filter: ["==", ["get", "k"], -1], paint: { "line-color": "#14232A", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 17, 2.2] } });
    map.addLayer({ id: "prog-pts", type: "circle", source: "prog",
      paint: { "circle-color": COL.promo, "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 5, 15, 8.5],
        "circle-stroke-color": "#fff", "circle-stroke-width": 2.2 } });
    map.addLayer({ id: "labels", type: "symbol", source: "labels", minzoom: 12.2,
      layout: { "text-field": ["get", "nom"], "text-font": ["Open Sans Semibold"], "text-size": ["interpolate", ["linear"], ["zoom"], 12, 10, 16, 13], "text-max-width": 9, "text-padding": 4 },
      paint: { "text-color": "#14232A", "text-halo-color": "rgba(255,255,255,.92)", "text-halo-width": 1.6 } });
    map.addLayer({ id: "prog-lbl", type: "symbol", source: "prog", minzoom: 14,
      layout: { "text-field": ["get", "programme"], "text-font": ["Open Sans Semibold"], "text-size": 11, "text-offset": [0, 1.3], "text-anchor": "top" },
      paint: { "text-color": "#066", "text-halo-color": "#fff", "text-halo-width": 1.5 } });

    bindMapEvents();
    setMode(S.mode);
    const done = () => $("#loading").classList.add("off");
    map.on("sourcedata", e => { if (e.sourceId === "asm" && map.isSourceLoaded("asm")) done(); });
    setTimeout(done, 10000);
  });
  map.on("error", e => {
    if (!["base", "base-ov"].includes(e.sourceId) || !S.basemap.startsWith("mq")) return;
    if (++S.bmErrors === 6) toast("Les tuiles MapQuest ne répondent pas (clé API probablement requise). Revenez au fond « Satellite ».");
  });
}

function bindMapEvents() {
  const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
  map.on("mousemove", "lots-fill", e => {
    const l = BY_K[e.features[0]?.properties.k]; if (!l) return;
    map.getCanvas().style.cursor = "pointer";
    if (map.getZoom() < 15) tip.setLngLat(e.lngLat).setHTML(`<b style="font-size:12px">${esc(l.nom)}</b>`).addTo(map); else tip.remove();
  });
  map.on("mouseleave", "lots-fill", () => { map.getCanvas().style.cursor = ""; tip.remove(); });
  map.on("click", e => {
    const layers = ["prog-pts", "chev-fill", "lots-fill"].filter(id => map.getLayoutProperty(id, "visibility") !== "none");
    const f = map.queryRenderedFeatures(e.point, { layers })[0];
    if (!f) return;
    if (f.layer.id === "prog-pts") return showProgPopup(f.properties, e.lngLat);
    if (f.layer.id === "chev-fill") { if (S.mode === "p3") { popup.remove(); return selectChev(f.properties.id, true); } selectChev(f.properties.id, false); return showChevPopup(f.properties, e.lngLat); }
    const l = BY_K[f.properties.k]; select(l.id, false);
    if (map.getZoom() >= 15) showLotPopup(f.properties, l, e.lngLat);
  });
  ["prog-pts", "chev-fill"].forEach(id => {
    map.on("mouseenter", id, () => map.getCanvas().style.cursor = "pointer");
    map.on("mouseleave", id, () => map.getCanvas().style.cursor = "");
  });
}

const kv = rows => `<div class="kv">${rows.filter(r => r[1] !== "" && r[1] != null).map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join("")}</div>`;
const LOTC = ["Conforme", "Non conforme", "Non renseigné"];
function showLotPopup(p, l, ll) {
  popup.setLngLat(ll).setHTML(`<div class="pp"><h5>${esc(l.nom)}</h5>${kv([
    ["Îlot", esc(p.i) || "—"], ["Lot", esc(p.l) || "—"], ["Usage", esc(p.u) || "—"],
    ["Conformité du lot", `<span class="dot" style="background:${COL.lotc[p.c]}"></span> ${LOTC[p.c]}`]])}</div>`).addTo(map);
}
function showProgPopup(p, ll) {
  popup.setLngLat(ll).setHTML(`<div class="pp"><h5><span class="dot" style="background:${COL.promo}"></span> ${esc(p.programme)}</h5>${kv([
    ["Promoteur", esc(p.entreprise)], ["Logements", p.nb_logts ? fmt(p.nb_logts) : "—"], ["Agrément", esc(p.annee) || "—"],
    ["Superficie", p.superficie_ha ? fmt(p.superficie_ha, 2) + " ha" : "—"], ["Localisation", esc(p.precision)]])}</div>`).addTo(map);
}
function showChevPopup(p, ll) {
  popup.setLngLat(ll).setHTML(`<div class="pp"><h5 style="color:${COL.chev}">Chevauchement ${esc(p.id)}</h5>${kv([
    ["Superficie", fmt(p.superficie_ha, 2) + " ha"], ["Plans concernés", p.nb_lotis], ["Synthèse", esc(p.synthese)]])}
    <div style="font-size:12px;margin-top:4px">${p.lotissements.split(" / ").map(esc).join("<br>")}</div></div>`).addTo(map);
}

/* ---------------------------------------------- styles par mode */
function lotColorExpr() {
  if (S.mode === "overview") {
    if (S.confFilter) return COL.conf[S.confFilter];
    if (S.statFilter) return COL.statut[S.statFilter];
    return COL.asm;
  }
  if (S.mode === "p1") return ["match", ["get", "dc"], "Conforme", COL.conf["Conforme"], COL.conf["Non conforme"]];
  if (S.mode === "p2") return ["match", ["get", "st"], "Normale", COL.statut["Normale"], COL.statut["Régularisation"]];
  if (S.mode === "p3") return ["case", [">", ["get", "nc"], 0], COL.involved, COL.muted];
  return ["match", ["get", "cb"], ...COMBOS.flatMap(c => [c.n, c.color]), COL.muted];
}
function planColor(l) {
  if (S.mode === "p2") return COL.statut[l.statut];
  if (S.mode === "p3") return l.chevauchements.length ? COL.involved : COL.muted;
  if (S.mode === "p4") return COMBOS[l.combo - 1].color;
  return COL.conf[l.conformite];
}
function applyFilters() {
  const ks = META.lotissements.filter(l => S.visible.has(l.id)).map(l => l.k);
  const fk = ["in", ["get", "k"], ["literal", ks]];
  let f = fk;
  if (S.mode === "overview" && S.confFilter) f = ["all", fk, ["==", ["get", "dc"], S.confFilter]];
  map.setFilter("lots-fill", f); map.setFilter("lots-line", f);
  map.setFilter("labels", ["in", ["get", "id"], ["literal", [...S.visible]]]);
  map.setPaintProperty("lots-fill", "fill-color", lotColorExpr());
  const vis = b => b ? "visible" : "none";
  ["prog-pts", "prog-lbl", "s3i-fill", "s3i-line"].forEach(L => map.setLayoutProperty(L, "visibility", vis(S.showPromo)));
  ["chev-fill", "chev-line", "chev-sel"].forEach(L => map.setLayoutProperty(L, "visibility", vis(S.showChev)));
  map.setLayoutProperty("labels", "visibility", vis(S.showNoms));
}

/* ================================================================ modes */
function setMode(mode) {
  S.mode = mode;
  $$(".tabs button").forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
  S.visible = ALL(); S.confFilter = null; S.statFilter = null;
  S.showChev = mode === "p3" || mode === "p4";
  S.showPromo = mode === "overview" || mode === "p1";
  S.selChev = null; map.setFilter("chev-sel", ["==", ["get", "id"], ""]);
  ({ overview: renderOverview, p1: renderP1, p2: renderP2, p3: renderP3, p4: renderP4 })[mode]();
  applyFilters(); renderLegend();
  if (S.selected) renderFiche(S.selected);
  $("#panel").scrollTop = 0;
}

function barRows(order, colors, key, labels = {}) {
  const max = Math.max(...order.map(k => count(l => l[key] === k)));
  return `<div class="bars">${order.map(k => { const n = count(l => l[key] === k);
    return `<div class="barrow" data-filter="${key}" data-value="${esc(k)}" title="Afficher : ${esc(k)}">
      <span><span class="dot" style="background:${colors[k]}"></span> ${esc(labels[k] || k)}</span>
      <div class="track"><span style="width:${max ? n / max * 100 : 0}%;background:${colors[k]}"></span></div>
      <span class="n">${n}</span></div>`; }).join("")}</div>`;
}
function matrixTable() {
  const cell = (s, c) => count(l => l.statut === s && l.conformite === c);
  return `<table class="matrix"><thead><tr><th></th>${CONF_ORDER.map(c => `<th><span class="dot" style="background:${COL.conf[c]}"></span> ${c}</th>`).join("")}<th>Total</th></tr></thead>
  <tbody>${STAT_ORDER.map(s => `<tr><td><span class="dot" style="background:${COL.statut[s]}"></span> ${s}</td>${CONF_ORDER.map(c => `<td class="clk" data-s="${s}" data-c="${c}">${cell(s, c)}</td>`).join("")}<td><b>${count(l => l.statut === s)}</b></td></tr>`).join("")}</tbody>
  <tfoot><tr><td>Total</td>${CONF_ORDER.map(c => `<td>${count(l => l.conformite === c)}</td>`).join("")}<td>${META.lotissements.length}</td></tr></tfoot></table>`;
}

function renderOverview() {
  const T = META.totaux;
  $("#panel").innerHTML = `
    <p class="lead">${TX.accueil_intro}</p>
    <div class="kpis">
      <div class="kpi hero"><div class="v">${T.lotissements}</div><div><div class="l">lotissements à Bingerville</div></div></div>
      <div class="kpi"><div class="v" style="color:${COL.chev}">${T.chevauchements}</div><div class="l">zones de chevauchement</div></div>
      <div class="kpi"><div class="v" style="color:${COL.promo}">${T.programmes}</div><div class="l">programmes immobiliers agréés</div></div>
    </div>
    <div class="section-title">Conformité</div>
    <div class="card">${barRows(CONF_ORDER, COL.conf, "conformite")}</div>
    <div class="section-title">Arrêtés d'approbation</div>
    <div class="card">${barRows(STAT_ORDER, COL.statut, "statut")}</div>
    <div class="section-title">Arrêté × conformité</div>
    <div class="card" style="padding:6px 8px">${matrixTable()}</div>
    <button class="btn" id="btn-reset" style="margin-top:10px;width:100%">Revenir à l'assemblage (tout en bleu)</button>
    <div class="section-title">Parcours de présentation</div>
    <div class="bars">
      <button class="btn" data-goto="p1" style="text-align:left"><b>1.</b> Présentation générale des lotissements →</button>
      <button class="btn" data-goto="p2" style="text-align:left"><b>2.</b> Catégorisation par arrêté d'approbation →</button>
      <button class="btn" data-goto="p3" style="text-align:left"><b>3.</b> Lotissements ayant des chevauchements →</button>
      <button class="btn" data-goto="p4" style="text-align:left"><b>4.</b> Combinaisons et enjeux fonciers →</button>
    </div>`;
  $$(".barrow").forEach(r => r.onclick = () => {
    const key = r.dataset.filter, v = r.dataset.value;
    if (key === "conformite") {
      S.statFilter = null; S.visible = ALL();
      S.confFilter = S.confFilter === v ? null : v;
      applyFilters(); renderLegend(); markActive();
      if (S.confFilter) fitToLots(S.confFilter); else fitAll();
    } else {
      S.confFilter = null;
      S.statFilter = S.statFilter === v ? null : v;
      S.visible = S.statFilter ? new Set(META.lotissements.filter(l => l.statut === v).map(l => l.id)) : ALL();
      applyFilters(); renderLegend(); markActive();
      S.statFilter ? fitTo([...S.visible]) : fitAll();
    }
  });
  $$(".matrix td.clk").forEach(td => td.onclick = () => {
    S.confFilter = null; S.statFilter = td.dataset.s;
    S.visible = new Set(META.lotissements.filter(l => l.statut === td.dataset.s && l.conformite === td.dataset.c).map(l => l.id));
    applyFilters(); renderLegend(); markActive(); fitTo([...S.visible]);
  });
  $("#btn-reset").onclick = () => { S.confFilter = null; S.statFilter = null; S.visible = ALL(); applyFilters(); renderLegend(); markActive(); fitAll(); };
  $$("[data-goto]").forEach(b => b.onclick = () => setMode(b.dataset.goto));
}
function markActive() {
  $$(".barrow").forEach(r => r.classList.toggle("on", (r.dataset.filter === "conformite" && S.confFilter === r.dataset.value) || (r.dataset.filter === "statut" && S.statFilter === r.dataset.value)));
}

/* --------------------------- arbre des couches */
function itemHTML(l) {
  return `<div class="item${S.selected === l.id ? " sel" : ""}" data-id="${l.id}">
    <input type="checkbox" ${S.visible.has(l.id) ? "checked" : ""} aria-label="Afficher ${esc(l.nom)}">
    <span class="dot" style="background:${planColor(l)}"></span>
    <span class="iname" title="${esc(l.nom)}">${esc(l.nom)}</span>
    <button class="zoom" title="Zoomer sur le plan" aria-label="Zoomer">⌖</button></div>`;
}
function groupHTML(title, color, list, opts = {}) {
  const body = opts.body ?? (list.length ? list.map(itemHTML).join("") : `<div class="empty">Aucun lotissement</div>`);
  return `<div class="group${opts.open ? " open" : ""}" data-ids="${list.map(l => l.id).join(",")}">
    <div class="ghead"><span class="caret">▶</span><input type="checkbox" class="gcheck" checked aria-label="Afficher le groupe ${esc(title)}">
      ${color ? `<span class="dot" style="background:${color}"></span>` : ""}<span class="gname">${esc(title)}</span><span class="gcount">${list.length}</span></div>
    <div class="gbody">${opts.note ? `<div class="empty" style="padding:2px 10px 6px">${esc(opts.note)}</div>` : ""}${body}</div></div>`;
}
function layerToggles(promo = true, chev = true) {
  return `<div class="group open"><div class="gbody" style="display:block;border:0">
    ${promo ? `<label class="item"><input type="checkbox" id="tg-promo" ${S.showPromo ? "checked" : ""}><span class="dot" style="background:${COL.promo};border-radius:50%"></span><span class="iname">Programmes immobiliers agréés (${META.totaux.programmes})</span></label>` : ""}
    ${chev ? `<label class="item"><input type="checkbox" id="tg-chev" ${S.showChev ? "checked" : ""}><span class="dot" style="background:repeating-linear-gradient(45deg,${COL.chev} 0 2px,#fbd 2px 4px)"></span><span class="iname">Zones de chevauchement (${META.totaux.chevauchements})</span></label>` : ""}
  </div></div>`;
}
const treeTools = () => `<div class="tree-tools"><input class="tree-filter" type="search" placeholder="Filtrer la liste…">
  <button class="btn small" data-all="1">Tout afficher</button><button class="btn small" data-all="0">Tout masquer</button></div>`;

function renderP1() {
  const by = c => META.lotissements.filter(l => l.conformite === c);
  $("#panel").innerHTML = `
    <div class="section-title">Projet 1</div>
    <h2 class="ptitle">${TX.p1_titre}</h2>
    <p class="lead">${(TX.p1_intro || "").replace("{n}", META.lotissements.length)}</p>
    <div class="kpis">
      <div class="kpi hero"><div class="v">${META.lotissements.length}</div><div><div class="l">lotissements existants dans la localité</div></div></div>
      <div class="kpi"><div class="v" style="color:${COL.conf["Conforme"]}">${by("Conforme").length}</div><div class="l">conformes</div></div>
      <div class="kpi"><div class="v" style="color:${COL.conf["Non conforme"]}">${by("Non conforme").length}</div><div class="l">non conformes</div></div>
    </div>
    <div class="section-title">Couches</div>
    ${layerToggles(true, true)}${treeTools()}
    <div id="tree">${CONF_ORDER.map(c => groupHTML(c, COL.conf[c], by(c), { open: true })).join("")}</div>`;
  bindPanel(); bindTree();
}

function renderP2() {
  $("#panel").innerHTML = `
    <div class="section-title">Projet 2</div>
    <h2 class="ptitle">${TX.p2_titre}</h2>
    <p class="lead">${TX.p2_intro}</p>
    <div class="kpis">${STAT_ORDER.map(s => `<div class="kpi"><div class="v" style="color:${COL.statut[s]}">${count(l => l.statut === s)}</div><div class="l">${s === "Normale" ? "voie normale" : "voie de régularisation"}</div></div>`).join("")}</div>
    <div class="section-title">Arrêté × conformité</div>
    <div class="card" style="padding:6px 8px">${matrixTable()}</div>
    <div class="section-title">Couches</div>
    ${treeTools()}
    <div id="tree">${STAT_ORDER.map(s => { const list = META.lotissements.filter(l => l.statut === s);
      return groupHTML(STAT_LABEL[s], COL.statut[s], list, { open: true, body: CONF_ORDER.map(c => groupHTML(c, COL.conf[c], list.filter(l => l.conformite === c))).join("") }); }).join("")}</div>`;
  $$(".matrix td.clk").forEach(td => td.onclick = () => {
    S.visible = new Set(META.lotissements.filter(l => l.statut === td.dataset.s && l.conformite === td.dataset.c).map(l => l.id));
    applyFilters(); syncTree(); fitTo([...S.visible]);
  });
  bindPanel(); bindTree();
}

function renderP3() {
  const inv = META.lotissements.filter(l => l.chevauchements.length).sort((a, b) => b.chevauchements.length - a.chevauchements.length || a.nom.localeCompare(b.nom));
  const feats = [...CHEV.features].sort((a, b) => b.properties.superficie_ha - a.properties.superficie_ha);
  $("#panel").innerHTML = `
    <div class="section-title">Projet 3</div>
    <h2 class="ptitle">${TX.p3_titre}</h2>
    <p class="lead">${TX.p3_intro}</p>
    <div class="kpis">
      <div class="kpi"><div class="v" style="color:${COL.chev}">${CHEV.features.length}</div><div class="l">zones de chevauchement</div></div>
      <div class="kpi"><div class="v">${inv.length}</div><div class="l">lotissements concernés</div><div class="s">sur ${META.lotissements.length}</div></div>
    </div>
    <div class="section-title">Zones (par superficie décroissante)</div>
    <div id="chev-list">${feats.map(f => { const p = f.properties; return `<button class="chev" data-chev="${p.id}">
      <div class="top"><span class="cid">${p.id} · ${p.nb_lotis} plans</span><span class="area">${fmt(p.superficie_ha, 2)} ha</span></div>
      <div class="names">${p.lotissements.split(" / ").map(n => `<span>${esc(n)}</span>`).join("")}</div>
      ${p.synthese ? `<div class="synth">${esc(p.synthese)}</div>` : ""}</button>`; }).join("")}</div>
    <div class="section-title">Lotissements concernés</div>
    ${treeTools()}
    <div id="tree">${groupHTML("Avec chevauchement", COL.involved, inv, { open: true })}${groupHTML("Sans chevauchement", COL.muted, META.lotissements.filter(l => !l.chevauchements.length))}</div>`;
  $$("#chev-list .chev").forEach(b => b.onclick = () => selectChev(b.dataset.chev, true));
  bindPanel(); bindTree();
}

function renderChevDetail(cid) {
  const f = CHEV.features.find(x => x.properties.id === cid); if (!f) return;
  const p = f.properties, ids = p.idsArr.filter(Boolean), ls = ids.map(id => BY_ID[id]);
  const badge = (c, t) => `<span class="badge" style="background:${c}">${esc(t)}</span>`;
  $("#panel").innerHTML = `
    <button class="btn small" id="chev-back">← Toutes les zones de chevauchement</button>
    <div class="section-title" style="margin-top:14px">Projet 3 · Chevauchement</div>
    <h2 class="ptitle" style="color:${COL.chev}">${esc(p.id)}</h2>
    <div class="kpis">
      <div class="kpi"><div class="v">${fmt(p.superficie_ha, 2)}</div><div class="l">hectares en chevauchement</div></div>
      <div class="kpi"><div class="v">${p.nb_lotis}</div><div class="l">lotissements concernés</div></div>
    </div>
    <div class="section-title">Synthèse</div>
    <div class="card" style="font-size:13px">
      <div>${ls.filter(l => l.approuve).length}/${ls.length} arrêtés reçus · ${ls.filter(l => l.conformite === "Non conforme").length}/${ls.length} non conformes</div>
      ${p.type ? `<div style="color:var(--ink-3);font-size:12px;margin-top:3px">${esc(p.type)}</div>` : ""}
    </div>
    <div class="section-title">Lotissements qui se superposent</div>
    ${ls.map(l => `<div class="card chev-lot" style="margin-bottom:8px">
      <div style="font-weight:600;margin-bottom:6px">${esc(l.nom)}</div>
      <div class="badges">${badge(COL.conf[l.conformite], l.conformite)}${badge(COL.statut[l.statut], "Voie " + (l.statut === "Normale" ? "normale" : "de régularisation"))}${l.approuve ? `<span class="badge soft">Arrêté reçu</span>` : badge("#8A5A00", "Arrêté non reçu")}</div>
      <div style="font-size:12px;color:var(--ink-2);margin-top:6px"><b>Arrêté :</b> ${esc(l.arrete) || "<i>non renseigné</i>"}</div>
      <button class="btn small" data-fiche="${l.id}" style="margin-top:8px">Voir la fiche du lotissement</button></div>`).join("")}
    ${p.lotissements.split(" / ").length > ls.length ? `<p class="note">Certains noms de cette zone ne figurent pas dans la couche « conformité » : ${esc(p.lotissements)}</p>` : ""}`;
  $("#chev-back").onclick = () => { S.selChev = null; map.setFilter("chev-sel", ["==", ["get", "id"], ""]); S.visible = ALL(); renderP3(); applyFilters(); fitAll(); };
  $$("[data-fiche]").forEach(b => b.onclick = () => select(b.dataset.fiche, false));
  $("#panel").scrollTop = 0;
}

function renderP4() {
  const of = n => META.lotissements.filter(l => l.combo === n);
  $("#panel").innerHTML = `
    <div class="section-title">Projet 4</div>
    <h2 class="ptitle">${TX.p4_titre}</h2>
    <p class="lead">${TX.p4_intro}</p>
    <div class="card" style="padding:4px 6px">
      <table class="matrix combo-table"><thead><tr><th>N°</th><th>Conf.</th><th>Chev.</th><th>Appr.</th><th style="text-align:left">Enjeu</th><th>Plans</th></tr></thead><tbody>
      ${COMBOS.map(c => `<tr class="combo-row" data-combo="${c.n}" title="${comboLabel(c)}">
        <td><span class="cnum" style="background:${c.color}">${c.n}</span></td>
        <td class="${c.conf === "C" ? "ok" : "ko"}">${c.conf}</td><td class="${c.chev ? "ko" : "ok"}">${c.chev ? "Oui" : "Non"}</td>
        <td class="${c.app ? "ok" : "ko"}">${c.app ? "✔" : "✖"}</td><td style="text-align:left">${c.enjeu}</td><td><b>${of(c.n).length}</b></td></tr>`).join("")}
      </tbody><tfoot><tr><td colspan="5">Total</td><td>${META.lotissements.length}</td></tr></tfoot></table></div>
    <div class="combo-bar">${COMBOS.map(c => { const n = of(c.n).length; return n ? `<span style="flex:${n};background:${c.color}" title="${c.n} : ${n}">${n}</span>` : ""; }).join("")}</div>
    <details class="note" style="margin-top:10px"><summary><b>Règles de classement</b></summary><ul>
      <li><b>Conformité</b> : statut du lotissement dans la couche « conformité » (C = conforme, NC = non conforme).</li>
      <li><b>Chevauchement</b> : le plan figure dans au moins une des ${CHEV.features.length} zones de la couche Chevauchement.</li>
      <li><b>Approuvé</b> : arrêté d'approbation reçu ; <b>non approuvé</b> : arrêté non reçu.</li></ul></details>
    <div class="section-title">Couches par situation</div>
    ${treeTools()}
    <div id="tree">${COMBOS.map(c => groupHTML(`${c.n}. ${comboLabel(c)}`, c.color, of(c.n), { note: c.enjeu })).join("")}</div>`;
  $$(".combo-row").forEach(r => r.onclick = () => {
    const only = of(+r.dataset.combo).map(l => l.id);
    const same = r.classList.contains("sel") || !only.length;
    S.visible = same ? ALL() : new Set(only);
    $$(".combo-row").forEach(x => x.classList.toggle("sel", !same && x === r));
    applyFilters(); syncTree(); same ? fitAll() : fitTo(only);
  });
  bindPanel(); bindTree();
}

/* --------------------------- interactions panneau */
function bindPanel() {
  const p = $("#tg-promo"); if (p) p.onchange = () => { S.showPromo = p.checked; applyFilters(); renderLegend(); };
  const c = $("#tg-chev"); if (c) c.onchange = () => { S.showChev = c.checked; applyFilters(); renderLegend(); };
}
function bindTree() {
  const tree = $("#tree"); if (!tree) return;
  tree.addEventListener("click", e => {
    const item = e.target.closest(".item[data-id]");
    if (item) {
      const id = item.dataset.id;
      if (e.target.matches("input")) { e.target.checked ? S.visible.add(id) : S.visible.delete(id); applyFilters(); syncTree(); return; }
      if (e.target.closest(".zoom")) { S.visible.add(id); applyFilters(); syncTree(); fitTo([id]); return; }
      select(id, true); return;
    }
    const head = e.target.closest(".ghead");
    if (head) {
      const g = head.parentElement;
      if (e.target.matches(".gcheck")) {
        (g.dataset.ids || "").split(",").filter(Boolean).forEach(id => e.target.checked ? S.visible.add(id) : S.visible.delete(id));
        applyFilters(); syncTree(); return;
      }
      g.classList.toggle("open");
    }
  });
  $$(".tree-tools [data-all]").forEach(b => b.onclick = () => { S.visible = b.dataset.all === "1" ? ALL() : new Set(); applyFilters(); syncTree(); });
  const f = $(".tree-filter");
  if (f) f.oninput = () => {
    const q = norm(f.value);
    $$("#tree .item[data-id]").forEach(it => it.style.display = !q || norm(BY_ID[it.dataset.id].nom).includes(q) ? "" : "none");
    if (q) $$("#tree .group").forEach(g => g.classList.add("open"));
  };
  syncTree();
}
function syncTree() {
  $$("#tree .item[data-id]").forEach(it => { it.querySelector("input").checked = S.visible.has(it.dataset.id); it.classList.toggle("sel", S.selected === it.dataset.id); });
  $$("#tree .group").forEach(g => {
    const cb = g.querySelector(":scope > .ghead > .gcheck"); if (!cb) return;
    const ids = (g.dataset.ids || "").split(",").filter(Boolean), n = ids.filter(id => S.visible.has(id)).length;
    cb.checked = ids.length > 0 && n === ids.length; cb.indeterminate = n > 0 && n < ids.length;
  });
}

/* ================================================================ sélection, zoom, fiche */
function fitPadding() { return { top: 60, bottom: 40, left: 40, right: !$("#fiche").hidden && window.innerWidth > 760 ? 400 : 60 }; }
function fitBox(b, maxZoom = 16) { map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: fitPadding(), maxZoom, duration: 900 }); }
function fitTo(ids) {
  if (!ids.length) return;
  const b = [180, 90, -180, -90];
  ids.forEach(id => { const x = BY_ID[id].bbox; b[0] = Math.min(b[0], x[0]); b[1] = Math.min(b[1], x[1]); b[2] = Math.max(b[2], x[2]); b[3] = Math.max(b[3], x[3]); });
  fitBox(b);
}
const fitAll = () => fitBox(META.bbox);
function fitToLots(c) {
  const b = [180, 90, -180, -90];
  ASM.features.forEach(f => { if (f.properties.dc === c) walkGeom(f.geometry, b); });
  fitBox(b);
}
function walkGeom(g, b) { if (!g) return; if (g.type === "GeometryCollection") g.geometries.forEach(x => walkGeom(x, b)); else walk(g.coordinates, b); }
function walk(c, b) { if (typeof c[0] === "number") { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); } else c.forEach(x => walk(x, b)); }

function select(id, zoom) {
  S.selected = id;
  map.setFilter("sel-line", ["==", ["get", "k"], BY_ID[id].k]);
  renderFiche(id); syncTree();
  if (zoom) { S.visible.add(id); applyFilters(); syncTree(); fitTo([id]); }
}
function clearSelection() {
  S.selected = null; $("#fiche").hidden = true;
  map.setFilter("sel-line", ["==", ["get", "k"], -1]); syncTree();
}
function selectChev(cid, zoom) {
  S.selChev = cid;
  map.setFilter("chev-sel", ["==", ["get", "id"], cid]);
  $$("#chev-list .chev").forEach(b => b.classList.toggle("sel", b.dataset.chev === cid));
  const el = $(`#chev-list .chev[data-chev="${cid}"]`); if (el && !zoom) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  const f = CHEV.features.find(f => f.properties.id === cid);
  if (S.mode === "p3" && zoom) { clearSelection(); renderChevDetail(cid); S.visible = new Set(f.properties.idsArr.filter(Boolean)); applyFilters(); }
  if (zoom && f) { if (S.mode !== "p3") { f.properties.idsArr.forEach(id => S.visible.add(id)); applyFilters(); syncTree(); } const b = [180, 90, -180, -90]; walkGeom(f.geometry, b); fitBox(b, 16.5); }
}

function stackBar(obj, colors) {
  const tot = Object.values(obj).reduce((a, b) => a + b, 0) || 1;
  return `<div class="stack">${Object.entries(obj).map(([k, v]) => `<span title="${esc(k)} : ${v}" style="width:${v / tot * 100}%;background:${colors[k] || "#C9CFD2"}"></span>`).join("")}</div>
  <div class="legend-inline">${Object.entries(obj).map(([k, v]) => `<span><span class="dot" style="background:${colors[k] || "#C9CFD2"}"></span> ${esc(k)} : <b>${fmt(v / tot * 100, 1)} %</b></span>`).join("")}</div>`;
}
function renderFiche(id) {
  const l = BY_ID[id], el = $("#fiche"), c = COMBOS[l.combo - 1];
  const usages = Object.entries(l.usages).slice(0, 8), umax = usages[0]?.[1] || 1;
  el.innerHTML = `
    <div class="fiche-head">
      <div class="kicker">Lotissement n° ${l.num} / ${META.lotissements.length}</div>
      <h2>${esc(l.nom)}</h2>
      <div class="badges">
        <span class="badge" style="background:${COL.conf[l.conformite]}">${l.conformite}</span>
        <span class="badge" style="background:${COL.statut[l.statut]}">Voie ${l.statut === "Normale" ? "normale" : "de régularisation"}</span>
        <span class="badge ${l.approuve ? "soft" : ""}" style="${l.approuve ? "" : "background:#8A5A00"}">${esc(l.plan_approuve)}</span>
        <span class="badge" style="background:${c.color}" title="${comboLabel(c)}">Situation ${c.n} · ${c.enjeu}</span>
        ${l.chevauchements.length ? `<span class="badge" style="background:${COL.chev}">${l.chevauchements.length} chevauchement${l.chevauchements.length > 1 ? "s" : ""}</span>` : ""}
      </div>
      <button class="fiche-close" aria-label="Fermer">×</button>
    </div>
    <div class="fiche-body">
      ${l.a_verifier ? `<div class="note warn" style="margin:0 0 10px">${esc(l.a_verifier)}</div>` : ""}
      <div class="facts">
        <div class="fact"><div class="v">${fmt(l.nb_lots)}</div><div class="l">lots</div></div>
        <div class="fact"><div class="v">${fmt(l.nb_ilots)}</div><div class="l">îlots</div></div>
      </div>
      <div class="section-title">Conformité lot par lot (assemblage)</div>
      ${stackBar(l.classes_lots, { "Conforme": COL.lotc[0], "Non conforme": COL.lotc[1], "Non renseigné": COL.lotc[2] })}
      <div class="section-title">Arrêté d'approbation</div>
      <div style="font-size:12.5px">${esc(l.arrete) || "<i>Non renseigné</i>"}</div>
      <div class="section-title">Usages des lots</div>
      <div class="bars">${usages.map(([k, v]) => `<div class="barrow" style="cursor:default;grid-template-columns:140px 1fr 44px"><span title="${esc(k)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(k.toLowerCase().replace(/^./, x => x.toUpperCase()))}</span><div class="track"><span style="width:${v / umax * 100}%;background:#5B7F86"></span></div><span class="n">${fmt(v)}</span></div>`).join("")}</div>
      ${l.chevauchements.length ? `<div class="section-title">Chevauchements</div>${l.chevauchements.map(cid => { const f = CHEV.features.find(x => x.properties.id === cid); return `<div class="linkchip chev" data-chev="${cid}">${cid} · ${fmt(f.properties.superficie_ha, 2)} ha — avec ${esc(f.properties.lotissements.split(" / ").filter(n => n !== l.nom).join(", "))}</div>`; }).join("")}` : ""}
    </div>
    <div class="fiche-actions">
      <button class="btn primary" data-act="zoom">Zoomer sur le plan</button>
      <button class="btn" data-act="solo">Afficher seul</button>
      <button class="btn" data-act="geojson">GeoJSON</button>
    </div>`;
  el.hidden = false;
  $(".fiche-close", el).onclick = clearSelection;
  $$("[data-chev]", el).forEach(x => x.onclick = () => { if (S.mode !== "p3") setMode("p3"); selectChev(x.dataset.chev, true); });
  $("[data-act=zoom]", el).onclick = () => fitTo([id]);
  $("[data-act=solo]", el).onclick = () => { S.visible = new Set([id]); applyFilters(); syncTree(); fitTo([id]); };
  $("[data-act=geojson]", el).onclick = () => download(`${l.id}.geojson`, JSON.stringify({ type: "FeatureCollection", features: ASM.features.filter(f => f.properties.k === l.k).map(f => ({ type: "Feature", properties: { lotissement: l.nom, ilot: f.properties.i, lot: f.properties.l, usage: f.properties.u, conformite_lot: LOTC[f.properties.c] }, geometry: f.geometry })) }), "application/geo+json");
}
function download(name, text, type) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ================================================================ légende */
function renderLegend() {
  const rows = [], sw = (c, t) => rows.push(`<div class="row"><span class="sw" style="background:${c}"></span>${t}</div>`);
  if (S.mode === "overview") {
    rows.push("<h4>Carte</h4>");
    if (S.confFilter) sw(COL.conf[S.confFilter], `Lots ${S.confFilter === "Conforme" ? "conformes" : "non conformes"}`);
    else if (S.statFilter) sw(COL.statut[S.statFilter], STAT_LABEL[S.statFilter]);
    else sw(COL.asm, "Assemblage des lotissements");
  } else if (S.mode === "p1") { rows.push("<h4>Conformité</h4>"); CONF_ORDER.forEach(c => sw(COL.conf[c], c)); }
  else if (S.mode === "p2") { rows.push("<h4>Arrêté d'approbation</h4>"); STAT_ORDER.forEach(s => sw(COL.statut[s], STAT_LABEL[s])); }
  else if (S.mode === "p3") { rows.push("<h4>Lotissements</h4>"); sw(COL.involved, "Avec chevauchement"); sw(COL.muted, "Sans chevauchement"); }
  else { rows.push("<h4>Combinaisons d'enjeux</h4>"); COMBOS.forEach(c => sw(c.color, `${c.n}. ${c.enjeu}`)); }
  if (S.showChev || S.showPromo) rows.push(`<div class="sep"></div>`);
  if (S.showChev) rows.push(`<div class="row"><span class="sw hatch"></span>Zone de chevauchement</div>`);
  if (S.showPromo) rows.push(`<div class="row"><span class="sw pt" style="background:${COL.promo}"></span>Programme immobilier agréé</div>`);
  $("#legend").innerHTML = rows.join("");
}

/* ================================================================ recherche & tableau */
function initSearch() {
  const inp = $("#search"), ul = $("#search-results");
  let hl = -1, res = [];
  const render = () => {
    const q = norm(inp.value.trim());
    if (!q) { ul.hidden = true; return; }
    res = META.lotissements.filter(l => norm(l.nom).includes(q)).slice(0, 12);
    ul.innerHTML = res.map((l, i) => `<li data-id="${l.id}" class="${i === hl ? "hl" : ""}"><span class="dot" style="background:${COL.conf[l.conformite]}"></span>${esc(l.nom)}</li>`).join("") || `<li style="cursor:default;color:#73838A">Aucun résultat</li>`;
    ul.hidden = false;
  };
  const go = id => { ul.hidden = true; inp.value = BY_ID[id].nom; select(id, true); };
  inp.addEventListener("input", () => { hl = -1; render(); });
  inp.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { hl = Math.min(hl + 1, res.length - 1); render(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { hl = Math.max(hl - 1, 0); render(); e.preventDefault(); }
    else if (e.key === "Enter" && res.length) go(res[Math.max(hl, 0)].id);
    else if (e.key === "Escape") ul.hidden = true;
  });
  ul.addEventListener("mousedown", e => { const li = e.target.closest("li[data-id]"); if (li) go(li.dataset.id); });
  inp.addEventListener("blur", () => setTimeout(() => ul.hidden = true, 150));
}

const COLS = [["num", "N°", true], ["nom", "Lotissement"], ["statut", "Arrêté"], ["conformite", "Conformité"], ["plan_approuve", "Approbation"],
  ["nb_ilots", "Îlots", true], ["nb_lots", "Lots", true], ["nchev", "Chevauch.", true], ["combo", "Situation", true]];
let sortKey = "num", sortDir = 1;
function renderTable() {
  const q = norm($("#table-filter").value);
  const rows = META.lotissements.map(l => ({ ...l, nchev: l.chevauchements.length }))
    .filter(l => !q || norm(`${l.nom} ${l.statut} ${l.conformite} ${l.plan_approuve}`).includes(q))
    .sort((a, b) => (a[sortKey] > b[sortKey] ? 1 : a[sortKey] < b[sortKey] ? -1 : 0) * sortDir);
  const pill = (c, t) => `<span class="pill"><span class="dot" style="background:${c}"></span>${t}</span>`;
  const cell = (l, k) => k === "conformite" ? pill(COL.conf[l.conformite], l.conformite) : k === "statut" ? pill(COL.statut[l.statut], l.statut)
    : k === "combo" ? pill(COMBOS[l.combo - 1].color, l.combo) : typeof l[k] === "number" ? fmt(l[k]) : esc(l[k]);
  $("#table").innerHTML = `<thead><tr>${COLS.map(([k, t, n]) => `<th data-k="${k}" class="${n ? "num" : ""}">${t}${sortKey === k ? (sortDir > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead>
  <tbody>${rows.map(l => `<tr data-id="${l.id}">${COLS.map(([k, , n]) => `<td class="${n ? "num" : ""}">${cell(l, k)}</td>`).join("")}</tr>`).join("")}</tbody>
  <tfoot><tr style="font-weight:700"><td></td><td>${rows.length} lotissements</td><td colspan="7"></td></tr></tfoot>`;
  $$("#table th").forEach(th => th.onclick = () => { const k = th.dataset.k; sortDir = sortKey === k ? -sortDir : 1; sortKey = k; renderTable(); });
  $$("#table tbody tr[data-id]").forEach(tr => tr.onclick = () => { $("#table-dialog").close(); select(tr.dataset.id, true); });
}
function exportCSV() {
  const head = ["N°", "Lotissement", "Arrêté (voie)", "Conformité", "Approbation", "Arrêté d'approbation", "Îlots", "Lots", "Chevauchements", "Situation", "Enjeu", "À vérifier"];
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = META.lotissements.map(l => { const c = COMBOS[l.combo - 1]; return [l.num, l.nom, l.statut, l.conformite, l.plan_approuve, l.arrete, l.nb_ilots, l.nb_lots, l.chevauchements.join(" "), `${c.n}. ${comboLabel(c)}`, c.enjeu, l.a_verifier].map(q).join(";"); });
  download("lotissements_bingerville.csv", "﻿" + [head.map(q).join(";"), ...lines].join("\r\n"), "text/csv;charset=utf-8");
}

/* ================================================================ UI globale */
function toast(msg) {
  const t = Object.assign(document.createElement("div"), { className: "toast", textContent: msg });
  $(".map-wrap").appendChild(t); setTimeout(() => t.remove(), 7000);
}
function initUI() {
  $$(".tabs button").forEach(b => b.onclick = () => setMode(b.dataset.mode));
  $$(".basemaps button").forEach(b => b.onclick = () => {
    $$(".basemaps button").forEach(x => x.classList.toggle("active", x === b));
    const bm = BASEMAPS[b.dataset.bm];
    ["base-ov", "base"].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); if (map.getSource(id)) map.removeSource(id); });
    const { overlay, ...src } = bm;
    map.addSource("base", { type: "raster", tileSize: 256, ...src });
    map.addLayer({ id: "base", type: "raster", source: "base" }, "lots-fill");
    if (overlay) { map.addSource("base-ov", { type: "raster", tileSize: 256, tiles: overlay, maxzoom: bm.maxzoom }); map.addLayer({ id: "base-ov", type: "raster", source: "base-ov" }, "lots-fill"); }
    S.basemap = b.dataset.bm; S.bmErrors = 0;
  });
  $("#labels").onchange = e => { S.showNoms = e.target.checked; applyFilters(); };
  $("#btn-table").onclick = () => { renderTable(); $("#table-dialog").showModal(); };
  $("#table-filter").oninput = renderTable;
  $("#btn-csv").onclick = exportCSV;
  $("[data-close]").onclick = () => $("#table-dialog").close();
  $("#sidebar-toggle").onclick = () => { $("#sidebar").classList.toggle("collapsed"); setTimeout(() => map.resize(), 250); };
  $("#legend").onclick = () => $("#legend").classList.toggle("open");
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#table-dialog").open) clearSelection(); });
  initSearch();
}

load().then(() => { initUI(); initMap(); }).catch(err => {
  console.error(err);
  $("#loading").innerHTML = `<span>Impossible de charger les données (${esc(err.message)}).</span>`;
});
})();
