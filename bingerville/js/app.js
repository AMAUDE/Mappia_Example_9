/* Cartographie foncière : lotissements de Bingerville
   Plateforme de présentation — MapLibre GL JS, données statiques (GeoJSON) */
(() => {
"use strict";

const COL = {
  conf: { "Conforme": "#2E9E5B", "Non conforme": "#D64545", "Modifié": "#E8902B", "Semi conforme": "#B8A12A" },
  appro: { "Normale": "#2F6FD6", "Régularisation": "#8E4FC9", "Neutre": "#7A8794" },
  lot: { "Conforme": "#2E9E5B", "Non conforme": "#D64545", "Modifié": "#E8902B", "": "#9AA5AB" },
  chev: "#E0245E", promo: "#0B9A9A", muted: "#9AA5AB"
};
const CONF_ORDER = ["Conforme", "Non conforme", "Modifié", "Semi conforme"];
const APPRO_ORDER = ["Normale", "Régularisation", "Neutre"];
const CONF_NOTE = { "Semi conforme": "Absence de bâtis pour valider la conformité" };
const APPRO_LABEL = { "Normale": "Approbation par voie normale", "Régularisation": "Approbation par voie de régularisation", "Neutre": "Neutre" };
const LOTS_MINZOOM = 14;

const BASEMAPS = {
  light: { tiles: ["https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png", "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png"], attribution: "© OpenStreetMap © CARTO", maxzoom: 20 },
  sat: { tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], attribution: "Imagerie © Esri, Maxar, Earthstar Geographics", maxzoom: 19 },
  osm: { tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], attribution: "© contributeurs OpenStreetMap", maxzoom: 19 },
  mq: { tiles: mqTiles("sat"), attribution: "Imagerie © MapQuest", maxzoom: 18 },
  mqhyb: { tiles: mqTiles("sat"), overlay: mqTiles("hyb"), attribution: "Imagerie © MapQuest", maxzoom: 18 }
};
/* MapQuest : serveur de tuiles a/b/c/d.tiles.mapquest.com. Si MapQuest exige une clé,
   la renseigner ici (compte gratuit sur developer.mapquest.com). */
function mqTiles(style) {
  const MQ_KEY = "";
  return ["a", "b", "c", "d"].map(s => `https://${s}.tiles.mapquest.com/render/latest/${style}/{z}/{x}/{y}/256/png${MQ_KEY ? "?key=" + MQ_KEY : ""}`);
}

const S = { mode: "overview", visible: new Set(), showPromo: true, showChev: true, showNoms: true,
  lotClasse: false, selected: null, selChev: null, loadedLots: new Map(), loading: new Set(), basemap: "light", bmErrors: 0 };
let META, BY_ID, EMPRISES, CHEV, PROMO_PTS, PROMO_POLY, NOGEO, map, popup;

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const fmt = (n, d = 0) => Number(n).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const h = (strings, ...vals) => strings.reduce((a, s, i) => a + s + (i < vals.length ? vals[i] : ""), "");

/* ================================================================ chargement */
async function load() {
  const j = u => fetch(u).then(r => { if (!r.ok) throw new Error(u); return r.json(); });
  [META, EMPRISES, CHEV, PROMO_PTS, PROMO_POLY, NOGEO] = await Promise.all([
    j("data/lotissements.json"), j("data/emprises.geojson"), j("data/chevauchements.geojson"),
    j("data/promotions_points.geojson"), j("data/promotions_emprises.geojson"),
    j("data/non_geolocalises.json").catch(() => ({ lotissements: [] }))
  ]);
  BY_ID = Object.fromEntries(META.lotissements.map(l => [l.id, l]));
  META.lotissements.forEach((l, i) => l.num = i + 1);
  NOGEO.lotissements = (NOGEO.lotissements || []).map(x => typeof x === "string" ? { nom: x } : x);
  EMPRISES.features.forEach(f => { const l = BY_ID[f.properties.id]; f.properties.nchev = l.chevauchements.length; });
  CHEV.features.forEach(f => {
    let ids = f.properties.ids; if (typeof ids === "string") try { ids = JSON.parse(ids); } catch { ids = []; }
    f.properties.idsArr = ids || [];
  });
  S.visible = new Set(META.lotissements.map(l => l.id));
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
    style: {
      version: 8,
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources: { base: { type: "raster", tileSize: 256, ...BASEMAPS.light } },
      layers: [{ id: "bg", type: "background", paint: { "background-color": "#EEEBE4" } }, { id: "base", type: "raster", source: "base" }]
    },
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
    map.addSource("emprises", { type: "geojson", data: EMPRISES, promoteId: "id" });
    map.addSource("chev", { type: "geojson", data: CHEV });
    map.addSource("promo-poly", { type: "geojson", data: PROMO_POLY });
    map.addSource("promo-pts", { type: "geojson", data: PROMO_PTS });
    const lblPts = { type: "FeatureCollection", features: META.lotissements.map(l => ({ type: "Feature", properties: { id: l.id, nom: l.nom, conformite: l.conformite, appro: l.appro }, geometry: { type: "Point", coordinates: l.centre } })) };
    map.addSource("labels", { type: "geojson", data: lblPts });

    map.addLayer({ id: "emp-fill", type: "fill", source: "emprises",
      paint: { "fill-color": COL.muted, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0.55, LOTS_MINZOOM, 0.28, 16, 0.08] } });
    map.addLayer({ id: "lots-anchor", type: "background", layout: { visibility: "none" }, paint: { "background-opacity": 0 } });
    map.addLayer({ id: "emp-line", type: "line", source: "emprises",
      paint: { "line-color": COL.muted, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.8, 16, 2.2], "line-opacity": 0.95 } });
    map.addLayer({ id: "emp-hover", type: "line", source: "emprises",
      paint: { "line-color": "#14232A", "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2.5, 0] } });
    map.addLayer({ id: "promo-poly-fill", type: "fill", source: "promo-poly", minzoom: 13,
      paint: { "fill-color": COL.promo, "fill-opacity": 0.18 } });
    map.addLayer({ id: "promo-poly-line", type: "line", source: "promo-poly", minzoom: 13,
      paint: { "line-color": COL.promo, "line-width": 1.6, "line-dasharray": [2, 1] } });
    map.addLayer({ id: "chev-fill", type: "fill", source: "chev", paint: { "fill-pattern": "hatch", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0.95, 16, 0.45] } });
    map.addLayer({ id: "chev-line", type: "line", source: "chev",
      paint: { "line-color": COL.chev, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.2, 16, 2.6] } });
    map.addLayer({ id: "chev-sel", type: "line", source: "chev", filter: ["==", ["get", "id"], ""],
      paint: { "line-color": "#14232A", "line-width": 3.5 } });
    map.addLayer({ id: "sel-line", type: "line", source: "emprises", filter: ["==", ["get", "id"], ""],
      paint: { "line-color": "#0E3B43", "line-width": 4, "line-opacity": 0.95 } });
    map.addLayer({ id: "sel-line-in", type: "line", source: "emprises", filter: ["==", ["get", "id"], ""],
      paint: { "line-color": "#E9C46A", "line-width": 1.6 } });
    map.addLayer({ id: "promo-pts", type: "circle", source: "promo-pts",
      paint: { "circle-color": COL.promo, "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4.5, 15, 8], "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
    map.addLayer({ id: "labels", type: "symbol", source: "labels", minzoom: 12.2,
      layout: { "text-field": ["get", "nom"], "text-font": ["Open Sans Semibold"], "text-size": ["interpolate", ["linear"], ["zoom"], 12, 10, 16, 13],
        "text-max-width": 9, "text-padding": 4, "text-allow-overlap": false },
      paint: { "text-color": "#14232A", "text-halo-color": "rgba(255,255,255,.92)", "text-halo-width": 1.6 } });
    map.addLayer({ id: "promo-lbl", type: "symbol", source: "promo-pts", minzoom: 14,
      layout: { "text-field": ["case", ["==", ["get", "promoteur"], "Non renseigné"], "Promotion immobilière", ["get", "promoteur"]],
        "text-font": ["Open Sans Semibold"], "text-size": 11, "text-offset": [0, 1.3], "text-anchor": "top" },
      paint: { "text-color": "#066", "text-halo-color": "#fff", "text-halo-width": 1.5 } });

    bindMapEvents();
    setMode(S.mode);
    $("#loading").classList.add("off");
  });
  map.on("moveend", ensureLots);
  map.on("error", e => {
    if (!["base", "base-ov"].includes(e.sourceId) || !S.basemap.startsWith("mq")) return;
    if (++S.bmErrors === 6) toast("Les tuiles MapQuest ne répondent pas (clé API probablement requise). Revenez au fond « Satellite ».");
  });
  map.on("zoom", () => $("#zoom-hint").classList.toggle("off", map.getZoom() >= LOTS_MINZOOM));
}

function bindMapEvents() {
  let hoverId = null;
  const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: "tip", offset: 8 });
  map.on("mousemove", "emp-fill", e => {
    const f = e.features[0]; if (!f) return;
    if (hoverId !== f.id) {
      if (hoverId != null) map.setFeatureState({ source: "emprises", id: hoverId }, { hover: false });
      hoverId = f.id; map.setFeatureState({ source: "emprises", id: hoverId }, { hover: true });
    }
    map.getCanvas().style.cursor = "pointer";
    if (map.getZoom() < LOTS_MINZOOM) tip.setLngLat(e.lngLat).setHTML(`<b style="font-size:12px">${esc(f.properties.nom)}</b>`).addTo(map); else tip.remove();
  });
  map.on("mouseleave", "emp-fill", () => {
    if (hoverId != null) map.setFeatureState({ source: "emprises", id: hoverId }, { hover: false });
    hoverId = null; map.getCanvas().style.cursor = ""; tip.remove();
  });
  map.on("click", e => {
    const layers = ["promo-pts", "chev-fill", ...lotFillLayers(), "emp-fill"].filter(id => map.getLayer(id) && map.getLayoutProperty(id, "visibility") !== "none");
    const fs = map.queryRenderedFeatures(e.point, { layers });
    if (!fs.length) return;
    const f = fs[0], L = f.layer.id;
    if (L === "promo-pts") return showPromoPopup(f, e.lngLat);
    if (L === "chev-fill") { selectChev(f.properties.id, false); return showChevPopup(f, e.lngLat); }
    if (L.startsWith("lots-")) { const pid = L.slice(5, -5); select(pid, false); return showLotPopup(f, pid, e.lngLat); }
    if (L === "emp-fill") select(f.properties.id, false);
  });
  ["promo-pts", "chev-fill"].forEach(id => {
    map.on("mouseenter", id, () => map.getCanvas().style.cursor = "pointer");
    map.on("mouseleave", id, () => map.getCanvas().style.cursor = "");
  });
}

const kv = rows => `<div class="kv">${rows.filter(r => r[1] !== "" && r[1] != null).map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join("")}</div>`;
function showLotPopup(f, pid, ll) {
  const p = f.properties, l = BY_ID[pid];
  popup.setLngLat(ll).setHTML(`<div class="pp"><h5>${esc(l.nom)}</h5>${kv([
    ["Îlot", esc(p.i) || "—"], ["Lot", esc(p.l) || "—"], ["Usage", esc(p.u) || "—"],
    ["Conformité du lot", p.c ? `<span class="dot" style="background:${COL.lot[p.c]}"></span> ${esc(p.c)}` : "—"],
    ["Surface", p.s ? fmt(p.s) + " m²" : "—"]])}</div>`).addTo(map);
}
function showPromoPopup(f, ll) {
  const p = f.properties;
  popup.setLngLat(ll).setHTML(`<div class="pp"><h5><span class="dot" style="background:${COL.promo}"></span> Promotion immobilière ${esc(p.id)}</h5>${kv([
    ["Promoteur", p.promoteur === "Non renseigné" ? "<i>non renseigné</i>" : esc(p.promoteur)],
    ["Superficie", fmt(p.superficie_ha, 2) + " ha"], ["Dans le lotissement", esc(p.dans_lotissement) || "Hors emprise des 104 plans"]])}</div>`).addTo(map);
}
function showChevPopup(f, ll) {
  const p = f.properties;
  popup.setLngLat(ll).setHTML(`<div class="pp"><h5 style="color:${COL.chev}">Chevauchement ${esc(p.id)}</h5>${kv([
    ["Superficie", fmt(p.superficie_ha, 2) + " ha"], ["Plans concernés", p.nb_lotis]])}
    <div style="font-size:12px;margin-top:4px">${p.lotissements.split(" / ").map(esc).join("<br>")}</div></div>`).addTo(map);
}

/* ---------------------------------------------- lots : une couche par plan */
const lotFillLayers = () => [...S.loadedLots.keys()].map(id => `lots-${id}-fill`);
function inView(l) {
  const b = map.getBounds(), [w, s, e, n] = l.bbox;
  return !(e < b.getWest() || w > b.getEast() || n < b.getSouth() || s > b.getNorth());
}
async function ensureLots() {
  if (!map.getSource("emprises") || map.getZoom() < LOTS_MINZOOM - 0.5) return;
  const todo = META.lotissements.filter(l => S.visible.has(l.id) && !S.loadedLots.has(l.id) && !S.loading.has(l.id) && inView(l));
  await Promise.all(todo.map(async l => {
    S.loading.add(l.id);
    try {
      const data = await fetch(`data/lots/${l.id}.geojson`).then(r => r.json());
      map.addSource(`lots-${l.id}`, { type: "geojson", data });
      map.addLayer({ id: `lots-${l.id}-fill`, type: "fill", source: `lots-${l.id}`, minzoom: LOTS_MINZOOM,
        paint: { "fill-color": lotColor(l), "fill-opacity": 0.55 } }, "lots-anchor");
      map.addLayer({ id: `lots-${l.id}-line`, type: "line", source: `lots-${l.id}`, minzoom: LOTS_MINZOOM,
        paint: { "line-color": "#fff", "line-width": ["interpolate", ["linear"], ["zoom"], 14, 0.4, 18, 1.4], "line-opacity": 0.9 } }, "lots-anchor");
      S.loadedLots.set(l.id, true);
      applyLotVisibility(l.id);
    } catch (err) { console.warn("lots", l.id, err); }
    S.loading.delete(l.id);
  }));
}
function lotColor(l) {
  if (S.lotClasse) return ["match", ["get", "c"], "Conforme", COL.lot["Conforme"], "Non conforme", COL.lot["Non conforme"], "Modifié", COL.lot["Modifié"], COL.lot[""]];
  return planColor(l);
}
function planColor(l) {
  if (S.mode === "p2") return COL.appro[l.appro];
  if (S.mode === "p3") return l.chevauchements.length ? "#5B6B73" : COL.muted;
  return COL.conf[l.conformite];
}
function applyLotVisibility(id) {
  const vis = S.visible.has(id) ? "visible" : "none";
  [`lots-${id}-fill`, `lots-${id}-line`].forEach(L => map.getLayer(L) && map.setLayoutProperty(L, "visibility", vis));
}
function refreshLotStyles() {
  for (const id of S.loadedLots.keys()) map.setPaintProperty(`lots-${id}-fill`, "fill-color", lotColor(BY_ID[id]));
}

/* ---------------------------------------------- style des emprises par mode */
function styleEmprises() {
  let color;
  if (S.mode === "p2") color = ["match", ["get", "appro"], ...APPRO_ORDER.flatMap(k => [k, COL.appro[k]]), COL.muted];
  else if (S.mode === "p3") color = ["case", [">", ["get", "nchev"], 0], "#5B6B73", "#B9C2C6"];
  else color = ["match", ["get", "conformite"], ...CONF_ORDER.flatMap(k => [k, COL.conf[k]]), COL.muted];
  map.setPaintProperty("emp-fill", "fill-color", color);
  map.setPaintProperty("emp-line", "line-color", color);
  applyFilters();
  refreshLotStyles();
}
function applyFilters() {
  const ids = [...S.visible];
  const f = ["in", ["get", "id"], ["literal", ids]];
  ["emp-fill", "emp-line", "emp-hover", "labels"].forEach(L => map.setFilter(L, f));
  for (const id of S.loadedLots.keys()) applyLotVisibility(id);
  const vis = b => b ? "visible" : "none";
  ["promo-pts", "promo-lbl", "promo-poly-fill", "promo-poly-line"].forEach(L => map.setLayoutProperty(L, "visibility", vis(S.showPromo)));
  ["chev-fill", "chev-line", "chev-sel"].forEach(L => map.setLayoutProperty(L, "visibility", vis(S.showChev)));
  map.setLayoutProperty("labels", "visibility", vis(S.showNoms));
  ensureLots();
}

/* ================================================================ modes */
function setMode(mode) {
  S.mode = mode;
  $$(".tabs button").forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
  S.visible = new Set(META.lotissements.map(l => l.id));
  S.showChev = mode !== "p2";
  S.showPromo = mode !== "p3";
  S.selChev = null; if (map.getLayer("chev-sel")) map.setFilter("chev-sel", ["==", ["get", "id"], ""]);
  ({ overview: renderOverview, p1: renderP1, p2: renderP2, p3: renderP3 })[mode]();
  styleEmprises();
  renderLegend();
  if (S.selected) renderFiche(S.selected);
  $("#panel").scrollTop = 0;
}

const total = () => META.totaux.lotissements_geolocalises + NOGEO.lotissements.length;
const count = (pred) => META.lotissements.filter(pred).length;

function barRows(order, colors, key, extraLabel = {}) {
  const max = Math.max(...order.map(k => count(l => l[key] === k)));
  return `<div class="bars">${order.map(k => {
    const n = count(l => l[key] === k);
    return `<div class="barrow" data-filter="${key}" data-value="${esc(k)}" title="Afficher uniquement : ${esc(k)}">
      <span><span class="dot" style="background:${colors[k]}"></span> ${esc(extraLabel[k] || k)}</span>
      <div class="track"><span style="width:${max ? n / max * 100 : 0}%;background:${colors[k]}"></span></div>
      <span class="n">${n}</span></div>`;
  }).join("")}</div>`;
}

function matrixTable() {
  const cell = (a, c) => count(l => l.appro === a && l.conformite === c);
  return `<table class="matrix"><thead><tr><th></th>${CONF_ORDER.map(c => `<th title="${c}"><span class="dot" style="background:${COL.conf[c]}"></span> ${c.replace("Non conforme", "Non conf.").replace("Semi conforme", "Semi conf.")}</th>`).join("")}<th>Total</th></tr></thead>
  <tbody>${APPRO_ORDER.map(a => `<tr><td><span class="dot" style="background:${COL.appro[a]}"></span> ${a}</td>${CONF_ORDER.map(c => { const n = cell(a, c); return `<td class="clk" data-a="${a}" data-c="${c}">${n || "·"}</td>`; }).join("")}<td><b>${count(l => l.appro === a)}</b></td></tr>`).join("")}</tbody>
  <tfoot><tr><td>Total</td>${CONF_ORDER.map(c => `<td>${count(l => l.conformite === c)}</td>`).join("")}<td>${META.lotissements.length}</td></tr></tfoot></table>`;
}

function renderOverview() {
  const T = META.totaux, ng = NOGEO.lotissements.length;
  $("#panel").innerHTML = h`
    <p class="lead">Cette plateforme présente la <strong>cartographie des lotissements de la localité de Bingerville</strong>, issue des travaux réalisés sous QGIS. Elle répond à trois questions : quels lotissements existent et sont-ils conformes, comment ont-ils été approuvés, et où se chevauchent-ils ?</p>
    <div class="kpis">
      <div class="kpi hero"><div class="v">${total()}</div><div><div class="l">lotissements recensés à Bingerville</div><div class="s">${T.lotissements_geolocalises} géolocalisés · ${ng} non géolocalisé${ng > 1 ? "s" : ""}</div></div></div>
      <div class="kpi"><div class="v">${fmt(T.lots)}</div><div class="l">lots numérisés</div></div>
      <div class="kpi"><div class="v">${fmt(T.superficie_ha)}</div><div class="l">hectares couverts</div><div class="s">emprise cumulée des plans</div></div>
      <div class="kpi"><div class="v" style="color:${COL.chev}">${T.chevauchements}</div><div class="l">zones de chevauchement</div><div class="s">${fmt(T.superficie_chevauchements_ha, 1)} ha concernés</div></div>
      <div class="kpi"><div class="v" style="color:${COL.promo}">${T.promotions}</div><div class="l">promotions immobilières</div><div class="s">sites localisés</div></div>
    </div>
    <div class="section-title">Conformité des plans</div>
    <div class="card">${barRows(CONF_ORDER, COL.conf, "conformite")}</div>
    <div class="section-title">Arrêtés d'approbation</div>
    <div class="card">${barRows(APPRO_ORDER, COL.appro, "appro", { "Normale": "Voie normale", "Régularisation": "Régularisation" })}</div>
    <div class="section-title">Croisement approbation × conformité</div>
    <div class="card" style="padding:6px 8px">${matrixTable()}</div>
    <div class="section-title">Parcours de présentation</div>
    <div class="bars">
      <button class="btn" data-goto="p1" style="text-align:left"><b>1.</b> Présentation générale des lotissements uniques →</button>
      <button class="btn" data-goto="p2" style="text-align:left"><b>2.</b> Catégorisation par arrêté d'approbation →</button>
      <button class="btn" data-goto="p3" style="text-align:left"><b>3.</b> Lotissements ayant des chevauchements →</button>
    </div>
    ${qualityNote()}`;
  bindPanelCommon();
}

function qualityNote() {
  const items = [];
  if (META.versions_ecartees?.length) items.push(`<b>${META.versions_ecartees.length} plan(s)</b> présent(s) dans le dossier mais non retenu(s) dans l'arbre QGIS (versions non retenues) : ${META.versions_ecartees.map(v => esc(v.nom.length > 60 ? v.nom.slice(0, 60) + "…" : v.nom)).join(" ; ")}.`);
  if (META.avertissements?.length) items.push(...META.avertissements.map(esc));
  return `<details class="note" style="margin-top:18px"><summary><b>Méthode et contrôle qualité</b></summary>
    <p style="margin:6px 0 0">Source : ${esc(META.source)}. Un plan = une couche. Statuts et approbations repris tels qu'organisés dans le groupe « ARRÊTÉ D'APPROBATION » du projet. Superficies calculées en UTM 30N (EPSG:32630). L'emprise d'un plan est obtenue en refermant les îlots sur 12 m (voies incluses).</p>
    ${items.length ? `<ul>${items.map(i => `<li>${i}</li>`).join("")}</ul>` : ""}</details>`;
}

/* --------------------------- arbre des couches */
function itemHTML(l) {
  const sel = S.selected === l.id ? " sel" : "";
  return `<div class="item${sel}" data-id="${l.id}">
    <input type="checkbox" ${S.visible.has(l.id) ? "checked" : ""} aria-label="Afficher ${esc(l.nom)}">
    <span class="dot" style="background:${planColor(l)}"></span>
    <span class="iname" title="${esc(l.nom)}">${esc(l.nom)}</span>
    <span class="imeta">${fmt(l.nb_lots)} lots</span>
    <button class="zoom" title="Zoomer sur le plan" aria-label="Zoomer">⌖</button></div>`;
}
function groupHTML(title, color, list, opts = {}) {
  const ids = list.map(l => l.id).join(",");
  const note = opts.note ? `<div class="empty" style="padding:2px 10px 6px">${esc(opts.note)}</div>` : "";
  const body = opts.body ?? (list.length ? list.map(itemHTML).join("") : `<div class="empty">Aucun lotissement</div>`);
  return `<div class="group${opts.open ? " open" : ""}" data-ids="${ids}">
    <div class="ghead"><span class="caret">▶</span>
      ${opts.nocheck ? "" : `<input type="checkbox" class="gcheck" checked aria-label="Afficher le groupe ${esc(title)}">`}
      ${color ? `<span class="dot" style="background:${color}"></span>` : ""}
      <span class="gname">${esc(title)}</span><span class="gcount">${opts.countLabel ?? list.length}</span></div>
    <div class="gbody">${note}${body}</div></div>`;
}
function nogeoGroup() {
  const L = NOGEO.lotissements;
  const body = L.length ? L.map(x => `<div class="item nogeo"><span class="dot" style="background:#C9CFD2"></span><span class="iname">${esc(x.nom)}</span>${x.appro ? `<span class="imeta">${esc(x.appro)}</span>` : ""}</div>`).join("")
    : `<div class="empty">Liste à compléter dans <code>data/non_geolocalises.json</code>. Ces lotissements sont comptés dans le total mais ne figurent pas sur la carte.</div>`;
  return groupHTML("Lotissements non géolocalisés", "#C9CFD2", [], { nocheck: true, body, countLabel: L.length });
}
function layerToggles() {
  return `<div class="group open"><div class="gbody" style="display:block;border:0">
    <label class="item"><input type="checkbox" id="tg-promo" ${S.showPromo ? "checked" : ""}><span class="dot" style="background:${COL.promo};border-radius:50%"></span><span class="iname">Promotions immobilières (${META.totaux.promotions} sites)</span></label>
    <label class="item"><input type="checkbox" id="tg-chev" ${S.showChev ? "checked" : ""}><span class="dot" style="background:repeating-linear-gradient(45deg,${COL.chev} 0 2px,#fbd 2px 4px)"></span><span class="iname">Zones de chevauchement (${META.totaux.chevauchements})</span></label>
  </div></div>`;
}
function treeTools() {
  return `<div class="tree-tools"><input class="tree-filter" type="search" placeholder="Filtrer la liste…">
    <button class="btn small" data-all="1">Tout afficher</button><button class="btn small" data-all="0">Tout masquer</button></div>`;
}

/* Regroupement binaire demandé (Conforme / Non conforme).
   « Modifié » est rangé côté non conforme ; « Semi conforme » (absence de bâtis) reste à valider. */
const BINAIRE = { conforme: ["Conforme"], nonConforme: ["Non conforme", "Modifié"], aValider: ["Semi conforme"] };
function renderP1() {
  const ng = NOGEO.lotissements.length;
  const of = arr => META.lotissements.filter(l => arr.includes(l.conformite));
  const nc = of(BINAIRE.nonConforme), av = of(BINAIRE.aValider);
  $("#panel").innerHTML = `
    <div class="section-title">Projet 1</div>
    <h2 style="font-size:18px;margin-bottom:6px">Présentation générale des lotissements uniques</h2>
    <p class="lead">Liste des lotissements uniques (dernière version ou version la plus conforme au terrain). <strong>Chaque plan est une couche</strong> que l'on peut afficher, masquer et consulter.</p>
    <div class="kpis">
      <div class="kpi hero"><div class="v">${total()}</div><div><div class="l">lotissements existants dans la localité</div><div class="s">${META.totaux.lotissements_geolocalises} géolocalisés + ${ng} non géolocalisé${ng > 1 ? "s" : ""}</div></div></div>
      <div class="kpi"><div class="v" style="color:${COL.conf["Conforme"]}">${of(BINAIRE.conforme).length}</div><div class="l">conformes</div></div>
      <div class="kpi"><div class="v" style="color:${COL.conf["Non conforme"]}">${nc.length}</div><div class="l">non conformes</div><div class="s">${count(l => l.conformite === "Non conforme")} non conformes + ${count(l => l.conformite === "Modifié")} modifiés</div></div>
      <div class="kpi" style="grid-column:1/-1"><div class="v" style="color:${COL.conf["Semi conforme"]}">${av.length}</div><div class="l">semi conformes — conformité à valider</div><div class="s">absence de bâtis pour valider la conformité</div></div>
    </div>
    <div class="section-title">Couches</div>
    ${layerToggles()}
    ${treeTools()}
    <div id="tree">
      ${groupHTML("Conforme", COL.conf["Conforme"], of(BINAIRE.conforme), { open: true })}
      ${groupHTML("Non conforme", COL.conf["Non conforme"], nc, { open: true,
        body: BINAIRE.nonConforme.map(c => groupHTML(c === "Non conforme" ? "Non conforme" : "Modifié", COL.conf[c], META.lotissements.filter(l => l.conformite === c))).join("") })}
      ${groupHTML("Semi conforme (à valider)", COL.conf["Semi conforme"], av, { note: CONF_NOTE["Semi conforme"] })}
      ${nogeoGroup()}
    </div>`;
  bindPanelCommon(); bindTree();
}

function renderP2() {
  $("#panel").innerHTML = `
    <div class="section-title">Projet 2</div>
    <h2 style="font-size:18px;margin-bottom:6px">Catégorisation par arrêté d'approbation</h2>
    <p class="lead">Lotissements approuvés <strong>par voie normale</strong> et <strong>par voie de régularisation</strong>, avec leur conformité. Les plans classés « Neutre » dans le projet QGIS sont présentés à part.</p>
    <div class="kpis">
      <div class="kpi"><div class="v" style="color:${COL.appro["Normale"]}">${count(l => l.appro === "Normale")}</div><div class="l">voie normale</div><div class="s">${fmt(META.lotissements.filter(l => l.appro === "Normale").reduce((a, l) => a + l.nb_lots, 0))} lots</div></div>
      <div class="kpi"><div class="v" style="color:${COL.appro["Régularisation"]}">${count(l => l.appro === "Régularisation")}</div><div class="l">voie de régularisation</div><div class="s">${fmt(META.lotissements.filter(l => l.appro === "Régularisation").reduce((a, l) => a + l.nb_lots, 0))} lots</div></div>
      <div class="kpi" style="grid-column:1/-1"><div class="v" style="color:${COL.appro["Neutre"]}">${count(l => l.appro === "Neutre")}</div><div class="l">neutres (ni normale ni régularisation dans le projet)</div></div>
    </div>
    <div class="section-title">Approbation × conformité</div>
    <div class="card" style="padding:6px 8px">${matrixTable()}</div>
    <div class="section-title">Couches</div>
    ${layerToggles()}
    ${treeTools()}
    <div id="tree">
      ${APPRO_ORDER.map(a => {
        const list = META.lotissements.filter(l => l.appro === a);
        const sub = CONF_ORDER.filter(c => list.some(l => l.conformite === c)).map(c => groupHTML(c, COL.conf[c], list.filter(l => l.conformite === c), { note: CONF_NOTE[c] })).join("");
        return groupHTML(APPRO_LABEL[a], COL.appro[a], list, { open: a !== "Neutre", body: sub });
      }).join("")}
    </div>`;
  bindPanelCommon(); bindTree();
}

function renderP3() {
  const inv = META.lotissements.filter(l => l.chevauchements.length).sort((a, b) => b.chevauchements.length - a.chevauchements.length || a.nom.localeCompare(b.nom));
  const feats = [...CHEV.features].sort((a, b) => b.properties.superficie_ha - a.properties.superficie_ha);
  $("#panel").innerHTML = `
    <div class="section-title">Projet 3</div>
    <h2 style="font-size:18px;margin-bottom:6px">Lotissements ayant des chevauchements</h2>
    <p class="lead">Zones où deux plans ou plus se superposent. Cliquez une zone pour la localiser et voir les plans concernés.</p>
    <div class="kpis">
      <div class="kpi"><div class="v" style="color:${COL.chev}">${CHEV.features.length}</div><div class="l">zones de chevauchement</div></div>
      <div class="kpi"><div class="v">${inv.length}</div><div class="l">lotissements concernés</div><div class="s">sur ${META.lotissements.length} géolocalisés</div></div>
      <div class="kpi" style="grid-column:1/-1"><div class="v">${fmt(META.totaux.superficie_chevauchements_ha, 2)} ha</div><div class="l">superficie totale en chevauchement</div></div>
    </div>
    <div class="section-title">Zones (par superficie décroissante)</div>
    <div id="chev-list">${feats.map(f => { const p = f.properties; return `<button class="chev" data-chev="${p.id}">
      <div class="top"><span class="cid">${p.id} · ${p.nb_lotis} plans</span><span class="area">${fmt(p.superficie_ha, 2)} ha</span></div>
      <div class="names">${p.lotissements.split(" / ").map(n => `<span>${esc(n)}</span>`).join("")}</div></button>`; }).join("")}</div>
    <div class="section-title">Lotissements concernés</div>
    ${treeTools()}
    <div id="tree">${groupHTML("Avec chevauchement", "#5B6B73", inv, { open: true })}
      ${groupHTML("Sans chevauchement", "#B9C2C6", META.lotissements.filter(l => !l.chevauchements.length))}</div>`;
  $$("#chev-list .chev").forEach(b => b.onclick = () => selectChev(b.dataset.chev, true));
  bindPanelCommon(); bindTree();
}

/* --------------------------- interactions panneau */
function bindPanelCommon() {
  $$("[data-goto]").forEach(b => b.onclick = () => setMode(b.dataset.goto));
  $$(".barrow").forEach(r => r.onclick = () => {
    const key = r.dataset.filter, v = r.dataset.value;
    const only = META.lotissements.filter(l => l[key] === v).map(l => l.id);
    const same = only.length === S.visible.size && only.every(id => S.visible.has(id));
    S.visible = new Set(same ? META.lotissements.map(l => l.id) : only);
    applyFilters(); syncTree(); fitTo([...S.visible]);
  });
  $$(".matrix td.clk").forEach(td => td.onclick = () => {
    const only = META.lotissements.filter(l => l.appro === td.dataset.a && l.conformite === td.dataset.c).map(l => l.id);
    if (!only.length) return;
    S.visible = new Set(only); applyFilters(); syncTree(); fitTo(only);
  });
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
      if (e.target.closest(".zoom")) { S.visible.add(id); applyFilters(); syncTree(); zoomTo(id); return; }
      select(id, true); return;
    }
    const head = e.target.closest(".ghead");
    if (head) {
      const g = head.parentElement;
      if (e.target.matches(".gcheck")) {
        const ids = g.dataset.ids ? g.dataset.ids.split(",").filter(Boolean) : [];
        ids.forEach(id => e.target.checked ? S.visible.add(id) : S.visible.delete(id));
        applyFilters(); syncTree(); return;
      }
      g.classList.toggle("open");
    }
  });
  $$(".tree-tools [data-all]").forEach(b => b.onclick = () => {
    S.visible = b.dataset.all === "1" ? new Set(META.lotissements.map(l => l.id)) : new Set();
    applyFilters(); syncTree();
  });
  const f = $(".tree-filter");
  if (f) f.oninput = () => {
    const q = norm(f.value);
    $$("#tree .item[data-id]").forEach(it => it.style.display = !q || norm(BY_ID[it.dataset.id].nom).includes(q) ? "" : "none");
    if (q) $$("#tree .group").forEach(g => g.classList.add("open"));
  };
  syncTree();
}
function syncTree() {
  $$("#tree .item[data-id]").forEach(it => {
    it.querySelector("input").checked = S.visible.has(it.dataset.id);
    it.classList.toggle("sel", S.selected === it.dataset.id);
  });
  $$("#tree .group").forEach(g => {
    const cb = g.querySelector(":scope > .ghead > .gcheck"); if (!cb) return;
    const ids = (g.dataset.ids || "").split(",").filter(Boolean);
    const n = ids.filter(id => S.visible.has(id)).length;
    cb.checked = ids.length > 0 && n === ids.length; cb.indeterminate = n > 0 && n < ids.length;
  });
}
const norm = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/* ================================================================ sélection & fiche */
function fitTo(ids) {
  if (!ids.length) return;
  let b = [180, 90, -180, -90];
  ids.forEach(id => { const x = BY_ID[id].bbox; b = [Math.min(b[0], x[0]), Math.min(b[1], x[1]), Math.max(b[2], x[2]), Math.max(b[3], x[3])]; });
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: fitPadding(), maxZoom: 16, duration: 900 });
}
function fitPadding() {
  const fiche = !$("#fiche").hidden && window.innerWidth > 760;
  return { top: 60, bottom: 40, left: 40, right: fiche ? 400 : 60 };
}
function zoomTo(id) { fitTo([id]); }
function select(id, zoom) {
  S.selected = id;
  map.setFilter("sel-line", ["==", ["get", "id"], id]);
  map.setFilter("sel-line-in", ["==", ["get", "id"], id]);
  renderFiche(id);
  syncTree();
  if (zoom) { S.visible.add(id); applyFilters(); syncTree(); zoomTo(id); }
}
function clearSelection() {
  S.selected = null; $("#fiche").hidden = true;
  map.setFilter("sel-line", ["==", ["get", "id"], ""]); map.setFilter("sel-line-in", ["==", ["get", "id"], ""]);
  syncTree();
}
function selectChev(cid, zoom) {
  S.selChev = cid;
  map.setFilter("chev-sel", ["==", ["get", "id"], cid]);
  $$("#chev-list .chev").forEach(b => b.classList.toggle("sel", b.dataset.chev === cid));
  const f = CHEV.features.find(f => f.properties.id === cid);
  const el = $(`#chev-list .chev[data-chev="${cid}"]`); if (el && !zoom) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  if (zoom && f) {
    const ids = f.properties.idsArr.filter(Boolean);
    ids.forEach(id => S.visible.add(id)); applyFilters(); syncTree();
    const bb = bboxOf(f.geometry);
    map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: fitPadding(), maxZoom: 16.5, duration: 900 });
  }
}
function bboxOf(g) {
  const b = [180, 90, -180, -90];
  const walk = c => typeof c[0] === "number" ? (b[0] = Math.min(b[0], c[0]), b[1] = Math.min(b[1], c[1]), b[2] = Math.max(b[2], c[0]), b[3] = Math.max(b[3], c[1])) : c.forEach(walk);
  walk(g.coordinates); return b;
}

function stackBar(obj, colors) {
  const tot = Object.values(obj).reduce((a, b) => a + b, 0) || 1;
  return `<div class="stack">${Object.entries(obj).map(([k, v]) => `<span title="${esc(k)} : ${v}" style="width:${v / tot * 100}%;background:${colors[k] || "#C9CFD2"}"></span>`).join("")}</div>
  <div class="legend-inline">${Object.entries(obj).map(([k, v]) => `<span><span class="dot" style="background:${colors[k] || "#C9CFD2"}"></span> ${esc(k)} : <b>${fmt(v)}</b> (${fmt(v / tot * 100, 1)} %)</span>`).join("")}</div>`;
}

function renderFiche(id) {
  const l = BY_ID[id], el = $("#fiche");
  const promos = PROMO_PTS.features.filter(f => f.properties.dans_lotissement === l.nom);
  const usages = Object.entries(l.usages).slice(0, 8);
  const umax = usages[0]?.[1] || 1;
  el.innerHTML = `
    <div class="fiche-head">
      <div class="kicker">Lotissement n° ${l.num} / ${META.lotissements.length}</div>
      <h2>${esc(l.nom)}</h2>
      <div class="badges">
        <span class="badge" style="background:${COL.conf[l.conformite]}">${esc(l.conformite)}</span>
        <span class="badge" style="background:${COL.appro[l.appro]}">${l.appro === "Neutre" ? "Approbation : neutre" : "Voie " + (l.appro === "Normale" ? "normale" : "de régularisation")}</span>
        ${l.chevauchements.length ? `<span class="badge" style="background:${COL.chev}">${l.chevauchements.length} chevauchement${l.chevauchements.length > 1 ? "s" : ""}</span>` : ""}
      </div>
      <button class="fiche-close" aria-label="Fermer">×</button>
    </div>
    <div class="fiche-body">
      ${CONF_NOTE[l.conformite] ? `<div class="note" style="margin:0 0 10px">${CONF_NOTE[l.conformite]}.</div>` : ""}
      <div class="facts">
        <div class="fact"><div class="v">${fmt(l.nb_lots)}</div><div class="l">lots</div></div>
        <div class="fact"><div class="v">${fmt(l.nb_ilots)}</div><div class="l">îlots</div></div>
        <div class="fact"><div class="v">${fmt(l.superficie_lots_ha, 2)} ha</div><div class="l">surface cumulée des lots</div></div>
        <div class="fact"><div class="v">${fmt(l.superficie_ha, 1)} ha</div><div class="l">emprise du plan (voies incl.)</div></div>
      </div>
      <div class="section-title">Conformité lot par lot</div>
      ${stackBar(l.classes_lots, { ...COL.lot, "Non renseigné": "#C9CFD2" })}
      <div class="section-title">Usages des lots</div>
      <div class="bars">${usages.map(([k, v]) => `<div class="barrow" style="cursor:default;grid-template-columns:140px 1fr 44px"><span title="${esc(k)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(k.toLowerCase().replace(/^./, c => c.toUpperCase()))}</span><div class="track"><span style="width:${v / umax * 100}%;background:#5B7F86"></span></div><span class="n">${fmt(v)}</span></div>`).join("")}</div>
      ${l.chevauchements.length ? `<div class="section-title">Chevauchements</div>${l.chevauchements.map(c => { const f = CHEV.features.find(x => x.properties.id === c); return `<div class="linkchip chev" data-chev="${c}">${c} · ${fmt(f.properties.superficie_ha, 2)} ha — avec ${esc(f.properties.lotissements.split(" / ").filter(n => n !== l.nom).join(", "))}</div>`; }).join("")}` : ""}
      ${promos.length ? `<div class="section-title">Promotions immobilières dans le plan</div>${promos.map(f => `<span class="linkchip" data-promo="${f.properties.id}">${f.properties.id} · ${esc(f.properties.promoteur === "Non renseigné" ? "promoteur non renseigné" : f.properties.promoteur)} · ${fmt(f.properties.superficie_ha, 2)} ha</span>`).join("")}` : ""}
      <div class="section-title">Référence</div>
      <dl class="kvlist">
        <dt>Groupe QGIS</dt><dd>ARRÊTÉ D'APPROBATION / ${esc(l.groupe_qgis)}</dd>
        <dt>Couche</dt><dd>${esc(l.fichier)}</dd>
        ${l.barcode ? `<dt>Code</dt><dd>${esc(l.barcode)}</dd>` : ""}
        ${l.origine ? `<dt>Origine</dt><dd>${esc(l.origine)}</dd>` : ""}
      </dl>
    </div>
    <div class="fiche-actions">
      <button class="btn primary" data-act="zoom">Zoomer sur le plan</button>
      <button class="btn" data-act="lots">Voir les lots</button>
      <button class="btn" data-act="solo">Afficher seul</button>
      <a class="btn" href="data/lots/${l.id}.geojson" download="${l.id}.geojson">GeoJSON</a>
    </div>`;
  el.hidden = false;
  $(".fiche-close", el).onclick = clearSelection;
  $$("[data-chev]", el).forEach(c => c.onclick = () => { if (S.mode !== "p3") setMode("p3"); selectChev(c.dataset.chev, true); });
  $$("[data-promo]", el).forEach(c => c.onclick = () => {
    const f = PROMO_PTS.features.find(x => x.properties.id === c.dataset.promo);
    S.showPromo = true; applyFilters();
    map.flyTo({ center: f.geometry.coordinates, zoom: 16.5 }); showPromoPopup(f, f.geometry.coordinates);
  });
  $("[data-act=zoom]", el).onclick = () => zoomTo(id);
  $("[data-act=lots]", el).onclick = () => { S.visible.add(id); applyFilters(); syncTree(); map.flyTo({ center: l.centre, zoom: Math.max(map.getZoom(), 16) }); };
  $("[data-act=solo]", el).onclick = () => { S.visible = new Set([id]); applyFilters(); syncTree(); zoomTo(id); };
}

/* ================================================================ légende */
function renderLegend() {
  const rows = [];
  if (S.mode === "p2") { rows.push("<h4>Arrêté d'approbation</h4>"); APPRO_ORDER.forEach(a => rows.push(`<div class="row"><span class="sw" style="background:${COL.appro[a]}"></span>${APPRO_LABEL[a]}</div>`)); }
  else if (S.mode === "p3") rows.push("<h4>Lotissements</h4>", `<div class="row"><span class="sw" style="background:#5B6B73"></span>Avec chevauchement</div>`, `<div class="row"><span class="sw" style="background:#B9C2C6"></span>Sans chevauchement</div>`);
  else { rows.push("<h4>Conformité du plan</h4>"); CONF_ORDER.forEach(c => rows.push(`<div class="row"><span class="sw" style="background:${COL.conf[c]}"></span>${c}</div>`)); }
  if (S.lotClasse) { rows.push(`<div class="sep"></div><h4>Lots (zoom ≥ ${LOTS_MINZOOM})</h4>`); ["Conforme", "Modifié", "Non conforme"].forEach(c => rows.push(`<div class="row"><span class="sw" style="background:${COL.lot[c]}"></span>Lot ${c.toLowerCase()}</div>`)); }
  if (S.showChev || S.showPromo) rows.push(`<div class="sep"></div>`);
  if (S.showChev) rows.push(`<div class="row"><span class="sw hatch"></span>Zone de chevauchement</div>`);
  if (S.showPromo) rows.push(`<div class="row"><span class="sw pt" style="background:${COL.promo}"></span>Promotion immobilière</div>`);
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
    const ng = NOGEO.lotissements.filter(x => norm(x.nom).includes(q)).slice(0, 4);
    ul.innerHTML = res.map((l, i) => `<li data-id="${l.id}" class="${i === hl ? "hl" : ""}"><span class="dot" style="background:${COL.conf[l.conformite]}"></span>${esc(l.nom)}</li>`).join("")
      + ng.map(x => `<li style="color:#73838A;cursor:default"><span class="dot" style="background:#C9CFD2"></span>${esc(x.nom)} — non géolocalisé</li>`).join("")
      || `<li style="cursor:default;color:#73838A">Aucun résultat</li>`;
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

const COLS = [
  ["num", "N°", true], ["nom", "Lotissement"], ["appro", "Approbation"], ["conformite", "Conformité"],
  ["nb_ilots", "Îlots", true], ["nb_lots", "Lots", true], ["superficie_lots_ha", "Surf. lots (ha)", true],
  ["superficie_ha", "Emprise (ha)", true], ["nchev", "Chevauch.", true]];
let sortKey = "num", sortDir = 1;
function renderTable() {
  const q = norm($("#table-filter").value);
  const rows = META.lotissements.map(l => ({ ...l, nchev: l.chevauchements.length }))
    .filter(l => !q || norm(`${l.nom} ${l.appro} ${l.conformite}`).includes(q))
    .sort((a, b) => (a[sortKey] > b[sortKey] ? 1 : a[sortKey] < b[sortKey] ? -1 : 0) * sortDir);
  const cell = (l, k) => k === "conformite" ? `<span class="pill"><span class="dot" style="background:${COL.conf[l.conformite]}"></span>${l.conformite}</span>`
    : k === "appro" ? `<span class="pill"><span class="dot" style="background:${COL.appro[l.appro]}"></span>${l.appro}</span>`
    : k.startsWith("superficie") ? fmt(l[k], 2) : typeof l[k] === "number" ? fmt(l[k]) : esc(l[k]);
  const ng = q ? [] : NOGEO.lotissements;
  $("#table").innerHTML = `<thead><tr>${COLS.map(([k, t, n]) => `<th data-k="${k}" class="${n ? "num" : ""}">${t}${sortKey === k ? (sortDir > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead>
  <tbody>${rows.map(l => `<tr data-id="${l.id}">${COLS.map(([k, , n]) => `<td class="${n ? "num" : ""}">${cell(l, k)}</td>`).join("")}</tr>`).join("")}
  ${ng.map(x => `<tr style="color:#73838A"><td class="num">—</td><td>${esc(x.nom)}</td><td>${esc(x.appro || "")}</td><td colspan="6">Non géolocalisé</td></tr>`).join("")}</tbody>
  <tfoot><tr style="font-weight:700"><td></td><td>${rows.length} lotissements${ng.length ? ` + ${ng.length} non géolocalisés` : ""}</td><td></td><td></td>
  <td class="num">${fmt(rows.reduce((a, l) => a + l.nb_ilots, 0))}</td><td class="num">${fmt(rows.reduce((a, l) => a + l.nb_lots, 0))}</td>
  <td class="num">${fmt(rows.reduce((a, l) => a + l.superficie_lots_ha, 0), 2)}</td><td></td><td></td></tr></tfoot>`;
  $$("#table th").forEach(th => th.onclick = () => { const k = th.dataset.k; sortDir = sortKey === k ? -sortDir : 1; sortKey = k; renderTable(); });
  $$("#table tbody tr[data-id]").forEach(tr => tr.onclick = () => { $("#table-dialog").close(); select(tr.dataset.id, true); });
}
function exportCSV() {
  const head = ["N°", "Lotissement", "Approbation", "Conformité", "Groupe QGIS", "Îlots", "Lots", "Surface lots (ha)", "Emprise (ha)", "Chevauchements", "Couche"];
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = META.lotissements.map(l => [l.num, l.nom, l.appro, l.conformite, l.groupe_qgis, l.nb_ilots, l.nb_lots,
    String(l.superficie_lots_ha).replace(".", ","), String(l.superficie_ha).replace(".", ","), l.chevauchements.join(" "), l.fichier].map(q).join(";"));
  NOGEO.lotissements.forEach(x => lines.push(["", x.nom, x.appro || "", "Non géolocalisé", "", "", "", "", "", "", ""].map(q).join(";")));
  const blob = new Blob(["﻿" + [head.map(q).join(";"), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "lotissements_bingerville.csv" });
  a.click(); URL.revokeObjectURL(a.href);
}

function toast(msg) {
  const t = Object.assign(document.createElement("div"), { className: "toast", textContent: msg });
  document.querySelector(".map-wrap").appendChild(t); setTimeout(() => t.remove(), 7000);
}

/* ================================================================ UI globale */
function initUI() {
  $$(".tabs button").forEach(b => b.onclick = () => setMode(b.dataset.mode));
  $$(".basemaps button").forEach(b => b.onclick = () => {
    $$(".basemaps button").forEach(x => x.classList.toggle("active", x === b));
    const bm = BASEMAPS[b.dataset.bm];
    ["base-ov", "base"].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); if (map.getSource(id)) map.removeSource(id); });
    const { overlay, ...src } = bm;
    map.addSource("base", { type: "raster", tileSize: 256, ...src });
    map.addLayer({ id: "base", type: "raster", source: "base" }, "emp-fill");
    if (overlay) {
      map.addSource("base-ov", { type: "raster", tileSize: 256, tiles: overlay, maxzoom: bm.maxzoom });
      map.addLayer({ id: "base-ov", type: "raster", source: "base-ov" }, "emp-fill");
    }
    S.bmErrors = 0;
    S.basemap = b.dataset.bm;
  });
  $("#lot-classe").onchange = e => { S.lotClasse = e.target.checked; refreshLotStyles(); renderLegend(); if (S.lotClasse && map.getZoom() < LOTS_MINZOOM) map.easeTo({ zoom: LOTS_MINZOOM + 0.5 }); };
  $("#labels").onchange = e => { S.showNoms = e.target.checked; applyFilters(); };
  $("#btn-table").onclick = () => { renderTable(); $("#table-dialog").showModal(); };
  $("#table-filter").oninput = renderTable;
  $("#btn-csv").onclick = exportCSV;
  $("[data-close]").onclick = () => $("#table-dialog").close();
  $("#sidebar-toggle").onclick = () => { $("#sidebar").classList.toggle("collapsed"); setTimeout(() => map.resize(), 250); };
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#table-dialog").open) clearSelection(); });
  $("#legend").onclick = () => $("#legend").classList.toggle("open");
  initSearch();
}

load().then(() => { initUI(); initMap(); }).catch(err => {
  console.error(err);
  $("#loading").innerHTML = `<span>Impossible de charger les données (${esc(err.message)}). Ouvrez le site via un serveur web (GitHub Pages) et non en fichier local.</span>`;
});
})();
