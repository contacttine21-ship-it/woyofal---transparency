# Woyofal Transparency

Simulateur de recharge Woyofal (SENELEC) — Niveau 1 : calcul de kWh théorique, détection d'écart, estimation par appareils, suivi de consommation.

## Mise en place initiale (une seule fois)

1. Crée un nouveau dépôt sur GitHub, par exemple `woyofal-transparency` (public ou privé, peu importe).
2. Dans ce dépôt, crée l'arborescence de fichiers ci-dessous en important tous les fichiers de ce dossier (glisser-déposer sur la page GitHub "Add file → Upload files", ou `git push` depuis un ordinateur).
3. Assure-toi que le fichier `.github/workflows/build-apk.yml` est bien présent — c'est lui qui déclenche la compilation.
4. Fais un premier commit sur la branche `main`.
5. Va dans l'onglet **Actions** du dépôt : la compilation démarre automatiquement. Elle prend quelques minutes la première fois (ajout de la plateforme Android).
6. Une fois la coche verte obtenue, clique sur le run terminé → section **Artifacts** en bas de page → télécharge `woyofal-transparency-debug-apk`.
7. Décompresse le zip téléchargé : il contient `app-debug.apk`. Installe-le sur un téléphone Android (autoriser "sources inconnues" si demandé).

## Pour chaque modification ultérieure

Même méthode que pour AgriMind :
1. Modifie `src/App.jsx` (ou `src/App.css`) localement.
2. Sur GitHub, ouvre le fichier concerné → icône crayon (Edit) → sélectionne tout → colle le nouveau contenu.
3. Commit directement sur `main`.
4. Attends la coche verte dans l'onglet Actions.
5. Télécharge le nouvel APK dans les Artifacts.
6. Désinstalle l'ancienne version sur le téléphone, installe la nouvelle.

## Ce qui manque encore pour une vraie application (pas seulement un prototype)

- **Persistance des données** : aujourd'hui, fermer l'app efface tout (recharge, appareils, suivi). Il faudra brancher un stockage (Capacitor Preferences pour du local simple, ou Firebase comme pour AgriMind si tu veux une synchronisation multi-appareils).
- **Icône et nom d'application** : actuellement l'icône par défaut de Capacitor. À personnaliser dans `android/app/src/main/res/` une fois la plateforme générée.
- **Vérification du tarif** : la grille utilisée (RFM 429 F, T1 82 F, T2 136,49 F, T3 159,36 F/kWh, sans taxe additionnelle) vient de la grille que tu as fournie — à confirmer avec une source SENELEC officielle avant toute mise en avant publique de l'outil.
