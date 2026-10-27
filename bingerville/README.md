# Cartographie foncière : lotissements de Bingerville

Plateforme SIG web de présentation des lotissements de la localité de Bingerville (Côte d'Ivoire), construite à partir des travaux réalisés sous QGIS (`BINGERVILLE_20261027.qgz`).

**Site :** https://amaude.github.io/Mappia_Example_9/bingerville/

## Contenu

| Volet | Ce que montre la plateforme |
|---|---|
| Vue d'ensemble | Nombre total de lotissements, lots, superficie, conformité, approbations, chevauchements, promotions immobilières |
| Projet 1 — Présentation générale | Les lotissements uniques, **un plan = une couche**, classés Conforme / Non conforme (dont Modifié) / Semi conforme ; groupe des lotissements non géolocalisés ; points des promotions immobilières |
| Projet 2 — Arrêtés d'approbation | Lotissements approuvés par voie normale et par voie de régularisation (et plans « Neutre »), croisés avec la conformité |
| Projet 3 — Chevauchements | Les zones où des plans se superposent, avec les lotissements concernés et les superficies |

Interactions : arbre de couches (afficher / masquer chaque plan ou groupe), recherche, fiche détaillée par lotissement (lots, îlots, superficies, usages, conformité lot par lot, chevauchements), affichage des lots au zoom ≥ 14, conformité lot par lot, fonds Plan / Satellite / OSM, tableau triable et export CSV, téléchargement GeoJSON de chaque plan.

## Données

- Classement (approbation × conformité) repris de l'arbre « ARRÊTÉ D'APPROBATION » du projet QGIS.
- Superficies calculées en UTM 30N (EPSG:32630) ; données publiées en WGS84 (GeoJSON).
- `data/non_geolocalises.json` : liste des lotissements recensés mais non géolocalisés (à compléter). Format :
  ```json
  { "lotissements": [ { "nom": "NOM DU LOTISSEMENT", "appro": "Normale" } ] }
  ```
  Le total des lotissements de la localité se met à jour automatiquement.

## Mettre à jour

```bash
pip install geopandas pyogrio
python3 outils/build_data.py "<dossier BINGERVILLE_20261027>" data
```

Technologies : MapLibre GL JS, HTML/CSS/JS statique, hébergement GitHub Pages.
