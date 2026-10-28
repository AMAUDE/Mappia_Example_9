"""Données web v2 — à partir des couches exportées de QGIS :
conformite (statistiques et statuts par lotissement), assemblage (lots, conformité lot par lot),
chevauchement, programmes_agrees, promotion_s3i.
Usage : python3 -I build_data_v2.py <dossier export> <dossier data>
"""
import sys, os, re, json, unicodedata, collections, shutil
import geopandas as gpd, pandas as pd
from shapely.ops import unary_union

SRC, OUT = sys.argv[1], sys.argv[2]
UTM = 32630
if os.path.isdir(os.path.join(OUT, "lots")): shutil.rmtree(os.path.join(OUT, "lots"))
for f in ["emprises.geojson", "promotions_points.geojson", "promotions_emprises.geojson"]:
    if os.path.exists(os.path.join(OUT, f)): os.remove(os.path.join(OUT, f))

def clean(v):
    if v is None or (isinstance(v, float) and pd.isna(v)): return ""
    return str(v).strip()
def slugify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:70]
def norm(s): return re.sub(r"[^A-Z0-9]", "", unicodedata.normalize("NFKD", s.upper()).encode("ascii", "ignore").decode())

# ------------------------------------------------ couche « conformite » : attributs par lotissement
c = gpd.read_file(os.path.join(SRC, "conformite.gpkg"), read_geometry=False)
STAT = {"NORMAL": "Normale", "REGULARISATION": "Régularisation"}
CONF = {"conforme": "Conforme", "non_conforme": "Non conforme"}
attrs = {}
for nom, g in c.groupby("lotissement"):
    r = g.iloc[0]
    for col in ["statut_lotis", "classe", "plan_approuve"]:
        assert g[col].nunique(dropna=False) == 1, (nom, col)
    attrs[nom.strip()] = dict(
        statut=STAT[clean(r["statut_lotis"])], conformite=CONF[clean(r["classe"])],
        approuve=clean(r["plan_approuve"]).startswith("Approuvé"), plan_approuve=clean(r["plan_approuve"]),
        arrete=clean(r["arrete_approb"]), a_verifier=clean(r["a_verifier"]), barcode=clean(r["barcode_id"]),
        origine=clean(r["origine"]))
print("lotissements (couche conformite):", len(attrs))

# ------------------------------------------------ assemblage : lots
a = gpd.read_file(os.path.join(SRC, "assemblage.gpkg"))
a = a[a.geometry.notna() & ~a.geometry.is_empty].copy()
if a.crs.to_epsg() != UTM: a = a.to_crs(UTM)
from shapely.geometry import MultiPolygon, Polygon, GeometryCollection
def polys(g):
    from shapely.validation import make_valid as _mv
    g = _mv(g)
    if isinstance(g, (Polygon, MultiPolygon)): return g
    parts = [p for p in getattr(g, "geoms", []) if isinstance(p, (Polygon, MultiPolygon))]
    flat = [q for p in parts for q in (p.geoms if isinstance(p, MultiPolygon) else [p])]
    return MultiPolygon(flat) if flat else None
a = a.set_geometry(gpd.GeoSeries([polys(g) for g in a.geometry], index=a.index, crs=a.crs))
print("géométries vides après nettoyage :", int(a.geometry.isna().sum()))
a = a[a.geometry.notna()].copy()
a["lotissement"] = a["lotissement"].map(clean)
assert set(a["lotissement"]) == set(attrs), (set(a["lotissement"]) ^ set(attrs))
CL = {"conforme": 0, "non_conforme": 1, "modifie": 1}
noms = sorted(attrs)
idx = {n: i for i, n in enumerate(noms)}
slugs, lotissements, emprises = set(), [], []
for nom in noms:
    g = a[a["lotissement"] == nom]
    s = slugify(nom); k = 2
    while s in slugs: s = f"{slugify(nom)}-{k}"; k += 1
    slugs.add(s)
    emp = unary_union(list(g.geometry)).buffer(12, join_style=2).buffer(-12, join_style=2).simplify(0.5)
    ctr = gpd.GeoSeries([emp.representative_point()], crs=UTM).to_crs(4326).iloc[0]
    bb = gpd.GeoSeries([emp], crs=UTM).to_crs(4326).total_bounds
    cl = collections.Counter({0: "Conforme", 1: "Non conforme"}.get(CL.get(clean(x)), "Non renseigné") for x in g["classe"])
    us = collections.Counter(clean(u).upper() or "NON RENSEIGNÉ" for u in g["usage"])
    ilots = g["num_ilot"].map(clean); ilots = ilots[ilots != ""].nunique()
    rec = dict(id=s, k=idx[nom], nom=nom, **attrs[nom], nb_lots=int(len(g)), nb_ilots=int(ilots),
               superficie_lots_ha=round(float(g.geometry.area.sum()) / 1e4, 2), superficie_ha=round(emp.area / 1e4, 2),
               classes_lots=dict(cl.most_common()), usages=dict(us.most_common()),
               centre=[round(ctr.x, 6), round(ctr.y, 6)], bbox=[round(b, 6) for b in bb], chevauchements=[])
    lotissements.append(rec)
    emprises.append(dict(geometry=emp, id=s, nom=nom))
emp_gdf = gpd.GeoDataFrame(emprises, crs=UTM)

lots = gpd.GeoDataFrame(dict(
    k=a["lotissement"].map(idx).astype(int),
    c=a["classe"].map(lambda x: CL.get(clean(x), 2)).astype(int),
    i=a["num_ilot"].map(clean), l=a["num_lot"].map(clean), u=a["usage"].map(clean)),
    geometry=a.geometry.simplify(0.1), crs=UTM).to_crs(4326)
lots.to_file(os.path.join(OUT, "assemblage.geojson"), driver="GeoJSON",
             layer_options={"COORDINATE_PRECISION": 6, "RFC7946": "YES"})

# ------------------------------------------------ chevauchements
by_norm = {norm(l["nom"]): l for l in lotissements}
ch = gpd.read_file(os.path.join(SRC, "chevauchement.gpkg")).to_crs(UTM)
ch = ch[ch.geometry.notna() & ~ch.geometry.is_empty].reset_index(drop=True)
feats, warns = [], []
for i, r in ch.iterrows():
    names = [n.strip() for n in clean(r["lotis_chev"]).split(" / ") if n.strip()]
    ids = []
    for n in names:
        l = by_norm.get(norm(n))
        if l is None: warns.append(f"Chevauchement {clean(r['id'])} : « {n} » absent de la couche conformité"); continue
        ids.append(l["id"])
    cid = f"CH-{i+1:02d}"
    for x in ids: next(l for l in lotissements if l["id"] == x)["chevauchements"].append(cid)
    feats.append(dict(geometry=r.geometry, id=cid, lotissements=" / ".join(names), ids=json.dumps(ids),
                      nb_lotis=len(names), type=clean(r["type_chev"]), synthese=clean(r["synthese"]),
                      superficie_ha=round(r.geometry.area / 1e4, 3)))
ch_gdf = gpd.GeoDataFrame(feats, crs=UTM)
ch_gdf.to_crs(4326).to_file(os.path.join(OUT, "chevauchements.geojson"), driver="GeoJSON",
                            layer_options={"COORDINATE_PRECISION": 6, "RFC7946": "YES"})

# ------------------------------------------------ programmes immobiliers
p = gpd.read_file(os.path.join(SRC, "programmes_agrees.gpkg")).to_crs(4326)
p = p[p.geometry.notna()].reset_index(drop=True)
pp = gpd.GeoDataFrame(dict(
    id=[f"PI-{int(n):02d}" if pd.notna(n) else f"PI-{i+1:02d}" for i, n in enumerate(p["num"])],
    entreprise=p["entreprise"].map(clean), programme=p["programme"].map(clean),
    nb_logts=p["nb_logts"].fillna(0).astype(int), annee=p["annee_agr"].map(lambda v: "" if pd.isna(v) else str(int(v))),
    superficie_ha=(p["superf_m2"].fillna(0) / 1e4).round(2), lieu=p["lieu_ref"].map(clean),
    precision=p["precision"].map(clean), dans_commune=p["dans_commune"].map(clean)), geometry=p.geometry, crs=4326)
pp.to_file(os.path.join(OUT, "programmes.geojson"), driver="GeoJSON", layer_options={"COORDINATE_PRECISION": 6, "RFC7946": "YES"})
s3 = gpd.read_file(os.path.join(SRC, "promotion_s3i.gpkg")).to_crs(4326)
s3 = gpd.GeoDataFrame(dict(nom=s3["Lotissment"].map(clean)), geometry=s3.geometry, crs=4326)
s3.to_file(os.path.join(OUT, "promotions_s3i.geojson"), driver="GeoJSON", layer_options={"COORDINATE_PRECISION": 6, "RFC7946": "YES"})

emp_all = unary_union(list(emp_gdf.geometry))
classes = collections.Counter(int(x) for x in lots["c"])
meta = dict(
    titre="Cartographie foncière : lotissements de Bingerville",
    source="Projet QGIS BINGERVILLE_20261027 — couches « conformite » (Direction.gpkg) et « Assemblage BINGERVILLE »",
    genere_le=pd.Timestamp.now().strftime("%Y-%m-%d"),
    bbox=[round(b, 6) for b in gpd.GeoSeries([emp_all], crs=UTM).to_crs(4326).total_bounds],
    noms=noms,
    totaux=dict(lotissements=len(lotissements), lots=int(len(lots)),
                lots_conformes=classes[0], lots_non_conformes=classes[1], lots_non_renseignes=classes[2],
                chevauchements=len(ch_gdf), superficie_chevauchements_ha=round(ch_gdf.geometry.area.sum() / 1e4, 2),
                programmes=len(pp), programmes_dans_commune=int((pp["dans_commune"] == "oui").sum())),
    lotissements=lotissements, avertissements=warns)
json.dump(meta, open(os.path.join(OUT, "lotissements.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(json.dumps(meta["totaux"], ensure_ascii=False))
print(collections.Counter((l["statut"], l["conformite"], l["approuve"], bool(l["chevauchements"])) for l in lotissements))
print("avertissements:", warns)
