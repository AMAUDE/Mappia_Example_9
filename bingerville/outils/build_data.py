"""Construit les données web de la plateforme à partir du projet QGIS Bingerville.

Usage : python3 -I build_data.py <dossier BINGERVILLE_20261027> <dossier sortie data>
"""
import sys, os, re, json, glob, unicodedata, collections
import xml.etree.ElementTree as ET
import zipfile
import geopandas as gpd
import pandas as pd
from shapely.geometry import mapping
from shapely.ops import unary_union

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(os.path.join(OUT, "lots"), exist_ok=True)
UTM = 32630

# ---------------------------------------------------------------- projet QGIS
qgz = os.path.join(SRC, "BINGERVILLE_20261027.qgz")
with zipfile.ZipFile(qgz) as z:
    qgs_name = [n for n in z.namelist() if n.endswith(".qgs")][0]
    root = ET.fromstring(z.read(qgs_name))

APPRO = {"NORMAL": "Normale", "REGULARISATION": "Régularisation", "NEUTRE": "Neutre"}
def conf_label(g):
    g = g.upper()
    if g.startswith("SEMI"): return "Semi conforme"
    if g.startswith("NON"): return "Non conforme"
    if g.startswith("MODIF"): return "Modifié"
    if g.startswith("CONFORME"): return "Conforme"
    raise ValueError(g)

tree = root.find("layer-tree-group")
arrete = [g for g in tree.findall("layer-tree-group") if g.get("name") == "ARRETE D'APPROBATION"][0]
entries = []
for ga in arrete.findall("layer-tree-group"):
    for gc in ga.findall("layer-tree-group"):
        for lyr in gc.findall("layer-tree-layer"):
            src = lyr.get("source").split("|")[0]
            entries.append(dict(appro=APPRO[ga.get("name")], conformite=conf_label(gc.get("name")),
                                groupe_qgis=f"{ga.get('name')} / {gc.get('name')}", source=src))
print("couches dans l'arbre ARRETE D'APPROBATION :", len(entries))

# fichiers sur disque : QGIS écrit "è", le zip a stocké "#U00e8"
def disk_path(rel):
    p = os.path.join(SRC, rel.lstrip("./"))
    if os.path.exists(p): return p
    want = os.path.basename(p)
    for f in glob.glob(os.path.join(os.path.dirname(p), "*.shp")):
        dec = re.sub(r"#U([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), os.path.basename(f))
        if unicodedata.normalize("NFC", dec) == unicodedata.normalize("NFC", want): return f
    raise FileNotFoundError(rel)

def slugify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:70]

def clean(v):
    if v is None or (isinstance(v, float) and pd.isna(v)): return ""
    return str(v).strip()

CLASSE = {"conforme": "Conforme", "modifie": "Modifié", "non_conforme": "Non conforme"}

lotissements, emprises, used_shp = [], [], set()
slugs = set()
for e in entries:
    shp = disk_path(e["source"]); used_shp.add(os.path.abspath(shp))
    g = gpd.read_file(shp)
    g = g[g.geometry.notna() & ~g.geometry.is_empty].copy()
    if g.crs.to_epsg() != UTM: g = g.to_crs(UTM)
    g["geometry"] = g.geometry.make_valid()
    name = g["lotissemen"].mode().iloc[0].strip()
    slug = slugify(name); i = 2
    while slug in slugs: slug = f"{slugify(name)}-{i}"; i += 1
    slugs.add(slug)
    area_lots = float(g.geometry.area.sum())
    # emprise : fermeture morphologique (comble les voies entre îlots)
    emp = unary_union(list(g.geometry)).buffer(12, join_style=2).buffer(-12, join_style=2)
    emp = emp.simplify(0.5)
    usages = collections.Counter(clean(u).upper() or "NON RENSEIGNÉ" for u in g["usage"])
    classes = collections.Counter(CLASSE.get(clean(c), "Non renseigné") for c in g["classe"])
    ilots = g["num_ilot"].map(clean); ilots = ilots[ilots != ""].nunique()
    barcode = clean(g["barcode_id"].mode().iloc[0]) if g["barcode_id"].notna().any() else ""
    origine = clean(g["origine"].mode().iloc[0]) if g["origine"].notna().any() else ""
    ctr = gpd.GeoSeries([emp.representative_point()], crs=UTM).to_crs(4326).iloc[0]
    bounds = gpd.GeoSeries([emp], crs=UTM).to_crs(4326).total_bounds
    rec = dict(id=slug, nom=name, appro=e["appro"], conformite=e["conformite"], groupe_qgis=e["groupe_qgis"],
               fichier=os.path.basename(e["source"]), barcode=barcode, origine=origine,
               nb_lots=int(len(g)), nb_ilots=int(ilots),
               superficie_ha=round(emp.area / 1e4, 2), superficie_lots_ha=round(area_lots / 1e4, 2),
               usages=dict(usages.most_common()), classes_lots=dict(classes.most_common()),
               centre=[round(ctr.x, 6), round(ctr.y, 6)], bbox=[round(b, 6) for b in bounds],
               chevauchements=[])
    lotissements.append(rec)
    emprises.append(dict(geometry=emp, id=slug, nom=name, appro=e["appro"], conformite=e["conformite"],
                         nb_lots=rec["nb_lots"], superficie_ha=rec["superficie_ha"]))
    # lots de ce plan (une couche par plan)
    lots = gpd.GeoDataFrame(dict(
        i=g["num_ilot"].map(clean), l=g["num_lot"].map(clean), u=g["usage"].map(clean),
        c=g["classe"].map(lambda c: CLASSE.get(clean(c), "")),
        s=g.geometry.area.round(0).astype(int)), geometry=g.geometry.simplify(0.05), crs=UTM).to_crs(4326)
    lots.to_file(os.path.join(OUT, "lots", f"{slug}.geojson"), driver="GeoJSON",
                 layer_options={"COORDINATE_PRECISION": 7, "RFC7946": "YES"})

emp_gdf = gpd.GeoDataFrame(emprises, crs=UTM)

# ---------------------------------------------------------------- chevauchements
ch = gpd.read_file(os.path.join(SRC, "Assemblage BINGERVILLE", "Chevauchement.gpkg")).to_crs(UTM)
by_name = {l["nom"]: l for l in lotissements}
def norm(s): return re.sub(r"[^A-Z0-9]", "", unicodedata.normalize("NFKD", s.upper()).encode("ascii", "ignore").decode())
by_norm = {norm(k): v for k, v in by_name.items()}
ch_feats, warnings = [], []
for k, r in ch.reset_index(drop=True).iterrows():
    names = [n.strip() for n in clean(r["lotis_chev"]).split(" / ") if n.strip()]
    ids = []
    for n in names:
        l = by_name.get(n) or by_norm.get(norm(n))
        if l is None: warnings.append(f"Chevauchement {r['id']}: '{n}' introuvable parmi les 104 plans"); ids.append(None); continue
        ids.append(l["id"])
    cid = f"CH-{k+1:02d}"
    for i in ids:
        if i: next(l for l in lotissements if l["id"] == i)["chevauchements"].append(cid)
    ch_feats.append(dict(geometry=r.geometry, id=cid, id_source=int(r["id"]) if pd.notna(r["id"]) else None,
                         lotissements=" / ".join(names), ids=json.dumps(ids), nb_lotis=len(names),
                         superficie_ha=round(r.geometry.area / 1e4, 3)))
ch_gdf = gpd.GeoDataFrame(ch_feats, crs=UTM)

# ---------------------------------------------------------------- promotions
pr = gpd.read_file(os.path.join(SRC, "Assemblage BINGERVILLE", "Promotion immobilier.gpkg")).to_crs(UTM)
pr = pr[pr.geometry.notna()].reset_index(drop=True)
pr["promoteur"] = pr["Lotissment"].map(clean).replace("", "Non renseigné")
pr["superficie_ha"] = (pr.geometry.area / 1e4).round(2)
pr["id"] = [f"PI-{i+1:02d}" for i in range(len(pr))]
# lotissement d'accueil (plus grande intersection avec une emprise)
hosts = []
for geom in pr.geometry:
    inter = emp_gdf[emp_gdf.intersects(geom)]
    if len(inter):
        best = inter.assign(a=inter.geometry.intersection(geom).area).sort_values("a").iloc[-1]
        hosts.append(best["nom"] if best["a"] > 0.1 * geom.area else "")
    else: hosts.append("")
pr["dans_lotissement"] = hosts
pr_pts = pr.copy(); pr_pts["geometry"] = pr.geometry.representative_point()
cols = ["id", "promoteur", "superficie_ha", "dans_lotissement", "geometry"]

# ---------------------------------------------------------------- écriture
def write(gdf, name, prec=6):
    gdf.to_crs(4326).to_file(os.path.join(OUT, name), driver="GeoJSON",
                             layer_options={"COORDINATE_PRECISION": prec, "RFC7946": "YES"})
write(emp_gdf, "emprises.geojson")
write(ch_gdf, "chevauchements.geojson")
write(pr[cols], "promotions_emprises.geojson")
write(pr_pts[cols], "promotions_points.geojson")

ng_path = os.path.join(OUT, "non_geolocalises.json")
if not os.path.exists(ng_path):
    json.dump({"note": "Lotissements recensés mais non géolocalisés. Compléter la liste 'lotissements'.",
               "lotissements": []}, open(ng_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

# shapefiles présents mais non retenus dans l'arbre (anciennes versions)
all_shp = {os.path.abspath(p) for p in glob.glob(os.path.join(SRC, "BINGERVILLE LOTISSEMENT", "*.shp"))}
ecartes = []
for p in sorted(all_shp - used_shp):
    g = gpd.read_file(p, columns=["lotissemen"], read_geometry=False)
    ecartes.append(dict(fichier=re.sub(r"#U([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), os.path.basename(p)),
                        nom=clean(g["lotissemen"].mode().iloc[0]), nb_lots=len(g)))

lotissements.sort(key=lambda l: l["nom"])
emp_all = unary_union(list(emp_gdf.geometry))
meta = dict(
    titre="Cartographie foncière : lotissements de Bingerville",
    source=f"Projet QGIS {os.path.basename(qgz)}", genere_le=pd.Timestamp.now().strftime("%Y-%m-%d"),
    bbox=[round(b, 6) for b in gpd.GeoSeries([emp_all], crs=UTM).to_crs(4326).total_bounds],
    totaux=dict(lotissements_geolocalises=len(lotissements), lots=sum(l["nb_lots"] for l in lotissements),
                superficie_ha=round(emp_all.area / 1e4, 1),
                chevauchements=len(ch_gdf), superficie_chevauchements_ha=round(ch_gdf.geometry.area.sum() / 1e4, 2),
                promotions=len(pr), promoteurs=int(pr["promoteur"].nunique())),
    lotissements=lotissements, versions_ecartees=ecartes, avertissements=warnings)
json.dump(meta, open(os.path.join(OUT, "lotissements.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

c = collections.Counter((l["appro"], l["conformite"]) for l in lotissements)
print(json.dumps(meta["totaux"], ensure_ascii=False))
for k, v in sorted(c.items()): print(" ", k, v)
print("écartés:", ecartes); print("avertissements:", warnings)
