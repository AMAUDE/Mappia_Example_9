# Cartographie foncière : lotissements de Bingerville

Plateforme SIG web de présentation des lotissements de la localité de Bingerville (Côte d'Ivoire), construite à partir des travaux réalisés sous QGIS (`BINGERVILLE_20261027.qgz`).

**Site :** https://amaude.github.io/Mappia_Example_9/bingerville/

## Contenu

| Volet | Ce que montre la plateforme |
|---|---|
| Vue d'ensemble | 105 lotissements ; conformité (Conforme / Non conforme) et arrêtés (Normale / Régularisation) d'après la couche « conformité » ; carte de l'assemblage (bleu), clic sur une catégorie = zoom et couleur |
| Projet 1 — Présentation générale | Les lotissements uniques, **un plan = une couche**, classés Conforme / Non conforme (dont Modifié) / Semi conforme ; groupe des lotissements non géolocalisés ; points des promotions immobilières |
| Projet 2 — Arrêtés d'approbation | Lotissements approuvés par voie normale et par voie de régularisation (et plans « Neutre »), croisés avec la conformité |
| Projet 3 — Chevauchements | Les zones où des plans se superposent, avec les lotissements concernés et les superficies |

Interactions : arbre de couches (afficher / masquer chaque plan ou groupe), recherche, fiche détaillée par lotissement (lots, îlots, superficies, usages, conformité lot par lot, chevauchements), affichage des lots au zoom ≥ 14, conformité lot par lot, fonds Plan / Satellite / OSM, tableau triable et export CSV, téléchargement GeoJSON de chaque plan.

## Données

- Statistiques et statuts par lotissement : couche « conformite » (Direction.gpkg). Carte : couche « Assemblage BINGERVILLE » (conformité lot par lot ; non conforme = non conforme + modifié).
- Superficies calculées en UTM 30N (EPSG:32630) ; données publiées en WGS84 (GeoJSON).

## Modifier les textes

- Titres et paragraphes des onglets : `js/textes.js` (un texte par ligne, entre accents graves `` ` ``).
- Titre du site, sous-titre, noms des onglets et boutons fixes : `index.html`.
- Sur GitHub : ouvrir le fichier, cliquer sur le crayon (« Edit »), modifier, puis « Commit changes ». Le site se met à jour en une à deux minutes.

## Mettre à jour

```bash
pip install geopandas pyogrio
python3 outils/build_data.py "<dossier des couches exportées de QGIS>" data
```

Technologies : MapLibre GL JS, HTML/CSS/JS statique, hébergement GitHub Pages.
