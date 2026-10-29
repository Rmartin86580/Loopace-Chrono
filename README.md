# Loopace Chrono

Le module de chronométrage de l'écosystème Loopace : inscriptions, départ groupé, arrivées au dossard,
classements individuel et par école, feuille de résultats PDF. Refonte web de RTB_Chronométrage v2 (WPF).
Site 100 % statique en HTML/CSS/JS (aucune installation, aucun serveur) ; les données restent dans le
navigateur (IndexedDB), rien n'est envoyé en ligne.

| Fichier | Rôle |
|---|---|
| `index.html` | Application : onglets Courses, Chronomètre, Résultats, Archives, Administration |
| `ecran.html` / `ecran.css` / `js/ecran.js` | Écran public (TV, vidéoprojecteur) : grand chrono et classement en direct |
| `js/app.js` | Interface de l'application |
| `js/calc.js` | Logique : départ, arrivées, arrêt (DNF), classement individuel et par école (somme des 3 meilleurs) |
| `js/store.js` | Données locales (IndexedDB) et synchronisation entre onglets (BroadcastChannel) |
| `js/excel.js` | Import / export Excel et modèle d'import (SheetJS) |
| `js/pdf.js` | Feuille de résultats PDF selon le thème de la course (jsPDF + AutoTable) |
| `baremes.json` | Barèmes officiels des catégories automatiques (FFA, FFTri, UNSS, classes), mis à jour sur tous les postes |
| `sw.js` | Cache hors ligne : une fois ouverte avec du réseau, l'application fonctionne sans |
| `manifest.webmanifest` | Installation en application sur PC (nom, icônes `assets/chrono-app-*.png`, raccourcis) |
| `styles.css` | DA Loopace vert sombre & citron, thème clair au choix (même réglage que les autres sites) |

## Déroulé d'une course

1. **Courses** : créer la course et choisir ses **catégories** — saisie libre, ou automatiques selon le barème
   **FFA** (Baby Athlé → Masters M10), **FFTri** (Mini-poussins → Seniors S1-S4 → Masters M1-M10),
   **UNSS** (Benjamins → Seniors) ou **Classes** (PS → Terminale, classe normale pour l'âge), avec en option
   la séparation filles / garçons (« Minimes F », « CM1 F »). La catégorie est calculée d'après l'année de
   naissance et la saison de la date de course (1er septembre → 31 août ; année civile pour la FFTri) ; la
   fiche course affiche les années de chaque catégorie pour vérification, et tout est recalculé si on change
   le barème ou la date. Une catégorie corrigée à la main dans la fiche participant (redoublement, avance…)
   est conservée lors des recalculs ; vider le champ revient au calcul. Sans année de naissance, la catégorie
   reste saisie à la main.
   Les barèmes se mettent à jour **automatiquement** : les années de naissance avancent seules à chaque
   saison, et le site publie les barèmes officiels dans `baremes.json`, rechargé à chaque lancement. Quand une
   fédération change ses catégories, il suffit de modifier ce fichier, de changer sa `version` (date) et de
   l'envoyer sur GitHub : tous les postes reçoivent le nouveau barème et recalculent les courses pas encore
   parties. **Administration → Catégories automatiques** permet aussi de modifier un barème à la main (prioritaire
   sur l'officiel, inclus dans la sauvegarde) ; « Revenir au barème officiel » annule cette modification. Inscrire les participants (à la main ou « Importer Excel »), cocher
   « Bulletin » pour ceux qui prennent le départ, puis éventuellement « Attribuer les dossards » : seuls les
   bulletins complets encore sans dossard sont numérotés, les dossards déjà donnés ne changent jamais.
   « Dupliquer » copie une course (réglages, et au choix ses participants avec ou sans dossards et bulletins)
   pour une autre course du même cross ou l'édition suivante ; les temps ne sont jamais copiés.
2. **Chronomètre** : choisir la course, « DÉPART » (tous les bulletins complets partent ensemble), taper le
   dossard à chaque arrivée puis Entrée (ou le scanner avec une douchette USB réglée en clavier AZERTY,
   suffixe Entrée). Un bip confirme chaque arrivée, un bip grave signale une erreur, une petite mélodie la
   fin de course ; **Administration → Options** permet de couper le son, de régler son volume et de le tester
   (réglages mémorisés sur ce poste).
   « Annuler la dernière arrivée » corrige une erreur de saisie.
   Le chrono s'arrête seul quand tout le monde est arrivé ; « ARRÊT » classe DNF ceux qui sont encore en course.
   « Écran public » ouvre une fenêtre à placer sur le second écran (bouton Plein écran).
3. **Résultats** : classement individuel et par école, export PDF ou Excel. « Archiver la course » range le
   PDF dans **Archives** et supprime la course.

Les données vivent dans ce navigateur, sur cet appareil : **Administration → Exporter une sauvegarde** avant
de changer d'ordinateur, et ouvrir l'application au moins une fois avec du réseau avant d'aller sur le terrain.
Le chrono survit à un rechargement de la page (heure de départ enregistrée).

## Installer en application sur PC

Loopace Chrono s'installe comme une application (PWA) avec **Chrome ou Edge** : icône dans le menu Démarrer
et sur le bureau, fenêtre à part sans barre d'adresse, fonctionne hors ligne.

1. Ouvrir le site (en ligne, ou en local avec `Lancer le site.bat`).
2. Cliquer sur **« Installer l'appli »** en haut à droite (ou l'icône d'installation dans la barre d'adresse,
   ou menu ⋮ → « Installer Loopace Chrono »).

Les données sont liées à l'adresse d'installation : installer depuis l'adresse définitive (GitHub Pages)
plutôt que depuis `localhost`, sinon les courses saisies resteront rattachées à la version locale
(passer par Administration → Exporter une sauvegarde / Restaurer pour les transférer).
Les mises à jour du site arrivent toutes seules dans l'application au lancement suivant (avec du réseau).

## Voir le site en local

Double-cliquer sur `Lancer le site.bat`, ou :

```bash
python -m http.server 5520
```

Puis ouvrir http://localhost:5520 (l'application a besoin de http, pas d'un simple double-clic sur `index.html`).

## Mettre le site en ligne (GitHub Pages)

Dépôt : https://github.com/Rmartin86580/Loopace-Chrono

Settings → Pages → « Deploy from a branch » → branche `main`, dossier `/ (root)`.
Le module est alors en ligne sur https://rmartin86580.github.io/Loopace-Chrono/ (adresse à utiliser pour
installer l'application). Puis, dans le hub (`Loopace/index.html`), passer Loopace Chrono de « À venir » à
« Disponible » avec le bouton « Ouvrir Chrono ».
