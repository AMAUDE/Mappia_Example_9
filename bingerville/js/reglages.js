/* ============================================================
   RÉGLAGES D'AFFICHAGE — afficher (true) ou masquer (false)
   Changez seulement true ↔ false. Ne supprimez pas les virgules.
   Après modification : changez le numéro ?v= dans index.html (3 lignes)
   puis rechargez le site avec Ctrl + F5.
   ============================================================ */
window.REGLAGES = {

  // ---------- Pages (onglets en haut)
  pages: {
    presentation: true,      // 1 Présentation
    approbation: true,       // 2 Approbation
    chevauchements: true     // 3 Chevauchements
  },

  // ---------- Boîtes sur la carte
  boites: {
    imagerie: true,          // boîte du haut « Imagerie »
    legende: true,           // boîte du bas « Légende »
    recherche: true          // barre « Rechercher un lotissement »
  },

  // ---------- Couches de la carte (true = proposée dans les boîtes et visible sur la carte)
  couches: {
    limite_administrative: true,
    noms_lotissements: true,
    zones_chevauchement: true,
    programmes_agrees: true,
    promotion_s3i: true
  },

  // ---------- Fonds de carte proposés dans la boîte « Imagerie »
  fonds: {
    plan: true,
    satellite: true,
    openstreetmap: true
  },

  // ---------- Blocs de la Vue d'ensemble
  vue_ensemble: {
    chiffre_lotissements: true,      // 105 lotissements à Bingerville
    chiffre_chevauchements: true,    // zones de chevauchement
    chiffre_programmes: true,        // programmes immobiliers agréés
    bloc_conformite: true,
    bloc_arretes: true,              // Normale / Régularisation
    bloc_approbation: true,          // arrêtés reçus / non transmis
    bouton_revenir: true             // « Revenir à l'assemblage »
  }
};
