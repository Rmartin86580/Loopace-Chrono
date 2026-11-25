# Loopace Chrono — Journal des modifications

Loopace Chrono est le chronométrage de course de l'écosystème Loopace : inscriptions, départ, arrivées au
dossard, classements et feuille de résultats PDF. Il fonctionne dans le navigateur ou installé comme une
application, sans internet le jour de la course. Les données restent sur l'ordinateur.

Les mises à jour arrivent toutes seules : il suffit de recharger la page, ou de relancer l'application installée.

---

## Version 22 — 25 novembre 2026 · Export FFA, diplômes et nouvelle administration

### Export FFA
- Nouveau bouton **« Export FFA »** dans l'onglet Résultats : un fichier Excel au format de la réglementation
  FFA hors stade, à envoyer à la commission départementale (place, dossard, nom, prénom, sexe, année,
  catégorie en code FFA, place dans la catégorie, nationalité, club, département, licence, temps). Les
  abandons suivent les arrivés, et une feuille « Épreuve » résume la course.
- Deux nouveaux champs dans la fiche participant et l'import Excel : **Nationalité** (FRA si vide) et
  **Département** du club. Ils n'apparaissent que pour les courses en catégories FFA ou avec des clubs, et
  peuvent aussi être ajoutés en colonnes dans le PDF.

### Diplômes
- Option à cocher dans la fiche course : un bouton **« Diplômes »** apparaît alors dans l'onglet Résultats.
- Un diplôme par coureur en A5, deux par feuille A4 à découper, aux couleurs et au logo du modèle PDF : nom,
  école ou club, course, place, place dans la catégorie, temps, et une médaille pour les podiums.
- Au choix : tous les arrivés, les 3 premiers au général et de chaque catégorie, ou les N premiers, avec en
  option un diplôme « pour sa participation » pour ceux qui n'ont pas fini.
- Ordre au choix (classement, école ou club, catégorie), titre et signature personnalisables.

### Administration réorganisée
- Un bandeau en haut affiche l'état de la sauvegarde automatique, la protection des données et la version.
- Un menu à gauche range les réglages en rubriques : Sauvegarde, Modèles PDF, Catégories, Son, Import Excel.

### Nouveautés dans l'application
- Ce journal se lit dans l'application, avec le lien « version · nouveautés » en bas de chaque page.
- Après une mise à jour, un message l'annonce une fois.

---

## Version 19 — 25 novembre 2026 · Fiabilité du chronométrage

### Sauvegarde automatique sur l'ordinateur
- **Un dossier à choisir une seule fois** (Administration → Sauvegarde automatique) ; ensuite l'application
  y enregistre tout elle-même, sans export ni import :
  - une sauvegarde complète mise à jour quelques secondes après chaque modification (chaque arrivée comprise) ;
  - une copie datée au départ et à la fin de chaque course, à l'archivage et chaque jour d'utilisation, dans
    le sous-dossier « Historique » (les 30 dernières sont gardées).
- **Une pastille en haut de l'écran** indique « Sauvegardé à 10:42 ». Elle passe en orange si le navigateur
  redemande l'autorisation, et en rouge si le dossier n'est plus accessible (clé USB retirée…).
- **Données perdues ?** Il suffit de choisir à nouveau le même dossier : l'application propose de tout restaurer.
- Un dossier OneDrive ou une clé USB garde en plus une copie hors de l'ordinateur.
- L'application demande aussi au navigateur de ne jamais effacer ses données de lui-même.
- Fonctionne avec Chrome et Edge. L'export manuel reste disponible pour changer d'ordinateur.

### Temps officiels au format FFA
- Les temps sont **arrondis à la seconde supérieure**, comme l'exige la FFA en chronométrage manuel
  (16:48,2 → 00:16:49) : résultats, PDF, Excel, écran chrono et écran public.
- Le classement reste celui de l'ordre réel d'arrivée.
- Écart au premier, vitesse, allure et classements d'équipe au temps sont calculés sur ces temps officiels.

### Chronomètre plus sûr
- Les temps ne dépendent plus de l'heure de l'ordinateur : si Windows corrige son heure pendant une course,
  les temps ne bougent pas.
- Pendant une course, l'écran ne se met plus en veille. L'écran public reste allumé tant qu'il est affiché.

---

## Version 18 — 30 octobre 2026 · Feuille de résultats sur mesure, écoles et clubs

- **Modèle de feuille de résultats en glisser-déposer** : on compose la page PDF sur un aperçu (à la souris,
  au doigt ou au clavier), en choisissant les classements et les colonnes, dans l'ordre voulu.
- **Format proche des résultats FFA** : colonne « Nom Prénom », licence, rang par sexe (« 1-H »), rang dans
  la catégorie (« M1-H(1) »), allure (« 3:21 /km »).
- **École et club séparés.** La fiche course indique si les participants viennent d'écoles, de clubs ou des
  deux : seuls les champs et classements utiles s'affichent.
- **Classements par école et par club** : tous les inscrits de l'équipe sont listés. Le gagnant se décide
  au choix sur les places au général, sur les temps des N premiers, ou à l'équipe la plus représentée.
- **Podiums « sans cumul »** (option) : un coureur déjà sur le podium général laisse sa place au suivant sur
  le podium de sa catégorie.
- Bouton **Dupliquer** pour les modèles de feuille de résultats.
- La fenêtre du modèle tient dans l'écran d'un PC portable (boutons toujours visibles).

## Version 14 — 30 octobre 2026 · Fiche course et archives

- Fiche course réorganisée en sections.
- Archives complètes : PDF, participants et temps. On revoit le résumé, on refait le PDF ou l'Excel, et on
  peut « Dupliquer en nouvelle course » pour l'édition suivante.
- Archives rangées par année, avec une recherche par nom, lieu ou année.

## Version 6 — 29 octobre 2026 · Dossards

- Plage de dossards dans la fiche course (ex. 100 à 199), respectée lors de l'attribution.
- Aperçu « qui reçoit quel numéro » avant de valider l'attribution.

## Version 4 — 29 octobre 2026 · Participants et catégories

- Liste des participants avec filtres (bulletin incomplet, sans dossard, école, catégorie) et tri par colonne.
- Import Excel sans doublons : réimporter une liste complète les fiches existantes sans perdre les dossards.
- Nom, sexe et année de naissance obligatoires à l'import.
- **Dupliquer une course**, avec ou sans ses participants.
- Catégories automatiques (FFA, FFTri, UNSS, classes) mises à jour d'elles-mêmes sur tous les postes ;
  barème modifiable à la main dans Administration.

## Version 3 — 29 octobre 2026 · Première version web

- Refonte web complète de RTB_Chronométrage v2 : courses, inscriptions, départ groupé, arrivées au dossard
  (clavier ou douchette), arrêt avec DNF, écran public, classements, PDF, Excel et archives.
- Installation comme une application sur PC, fonctionnement sans internet.
- Bips d'arrivée réglables en volume, pensés pour s'entendre dans le bruit d'une arrivée.
- L'attribution des dossards ne modifie jamais un dossard déjà donné.
