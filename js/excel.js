// Import / export Excel avec SheetJS (chargé par index.html : window.XLSX).

import { codeCategorie } from "./pdf.js?v=27";

function lib() {
  if (!window.XLSX) throw new Error("La bibliothèque Excel n'est pas chargée (connexion nécessaire au premier lancement).");
  return window.XLSX;
}

// Les étoiles qui marquent les colonnes obligatoires du modèle (« Nom ★ ») ne comptent pas dans le nom de colonne
const normaliser = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[★*]/g, "").toLowerCase().trim();

/** « F », « Fille », « Femme », « Féminin » → F ; « M », « H », « G », « Homme », « Garçon », « Masculin » → M ; sinon vide. */
function lireSexe(v) {
  const s = normaliser(v);
  if (/^(f|fille|femme|feminin|dame)s?$/.test(s)) return "F";
  if (/^(m|h|g|homme|garcon|masculin|monsieur)s?$/.test(s)) return "M";
  return "";
}

/** Année de naissance : nombre (2010), date Excel, ou texte contenant l'année (« 12/03/2010 ») ; sinon null. */
function lireAnnee(brut) {
  let a = null;
  if (brut instanceof Date && !isNaN(brut)) a = brut.getFullYear();
  else if (typeof brut === "number") a = Math.trunc(brut);
  else a = Number(String(brut ?? "").match(/(19|20)\d\d/)?.[0]) || null;
  return a && a >= 1900 && a <= new Date().getFullYear() ? a : null;
}

export const COLONNES_OBLIGATOIRES = ["Nom", "Sexe", "Né (année de naissance)"];

/**
 * Lit la première feuille d'un .xlsx / .xls / .csv et renvoie les lignes de participants,
 * avec leur numéro de ligne dans le fichier (pour signaler celles qui sont incomplètes).
 */
export async function lireParticipants(fichier) {
  const XLSX = lib();
  const wb = XLSX.read(await fichier.arrayBuffer(), { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // Texte tel qu'affiché pour tous les champs (garde le 0 d'un téléphone saisi en texte) ;
  // valeurs brutes pour l'année, qui peut être une vraie date Excel
  const lignes = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
  const brutes = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
  if (!lignes.length) return [];

  const entetes = new Map();
  lignes[0].forEach((v, k) => { const n = normaliser(v); if (n && !entetes.has(n)) entetes.set(n, k); });
  const col = (...noms) => { for (const n of noms) { const k = entetes.get(normaliser(n)); if (k != null) return k; } return -1; };

  const c = {
    dossard: col("dossard", "bib", "numero", "n°", "no"),
    nom: col("nom", "name", "lastname"),
    prenom: col("prenom", "firstname"),
    sexe: col("sexe", "sex", "genre"),
    annee: col("né", "née", "nee", "ne(e)", "né(e)", "naissance", "annee", "born"),
    ecole: col("ecole", "école / club", "etablissement", "school"),
    club: col("club", "equipe", "association"),
    categorie: col("categorie", "cat", "classe"),
    telephone: col("telephone", "tel", "phone"),
    licence: col("licence", "n° licence", "n licence", "no licence", "numero de licence", "num licence", "license"),
    nationalite: col("nationalite", "nat", "nat.", "nationality", "pays"),
    departement: col("departement", "dept", "dep", "dpt", "dept.", "departement du club"),
    bulletin: col("bulletin", "bulletinok", "bulletin ok", "inscrit"),
  };
  const manquantes = [["Nom", c.nom], ["Sexe", c.sexe], ["Né (année de naissance)", c.annee]].filter(([, k]) => k === -1).map(([n]) => `« ${n} »`);
  if (manquantes.length)
    throw new Error(`Colonne(s) obligatoire(s) introuvable(s) : ${manquantes.join(", ")}. Le fichier doit contenir au minimum les colonnes Nom, Sexe et Né (année de naissance).`);

  return lignes.slice(1).map((r, k) => {
    const get = (j) => (j >= 0 ? String(r[j] ?? "").trim() : "");
    return {
      ligne: k + 2,
      dossard: get(c.dossard), nom: get(c.nom), prenom: get(c.prenom),
      sexe: lireSexe(get(c.sexe)), sexeLu: get(c.sexe),
      annee: lireAnnee(brutes[k + 1]?.[c.annee]), anneeLue: get(c.annee),
      ecole: get(c.ecole), club: get(c.club), categorie: get(c.categorie), telephone: get(c.telephone), licence: get(c.licence),
      nationalite: get(c.nationalite).toUpperCase(), departement: get(c.departement).toUpperCase(),
      bulletin: ["1", "oui", "true", "yes", "x", "vrai"].includes(get(c.bulletin).toLowerCase()),
    };
  }).filter((l) => l.dossard || l.nom || l.prenom || l.sexeLu || l.anneeLue); // lignes entièrement vides ignorées
}

function ecrire(nomFichier, feuilles) {
  const XLSX = lib();
  const wb = XLSX.utils.book_new();
  feuilles.forEach(({ nom, lignes, largeurs }) => {
    const ws = XLSX.utils.aoa_to_sheet(lignes);
    if (largeurs) ws["!cols"] = largeurs.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, nom);
  });
  XLSX.writeFile(wb, nomFichier);
}

export function exporterParticipants(nomFichier, inscrits) {
  ecrire(nomFichier, [{
    nom: "Participants",
    largeurs: [10, 20, 18, 6, 8, 26, 26, 14, 12, 12, 16, 16, 11],
    lignes: [
      ["Dossard", "Nom", "Prénom", "Sexe", "Né(e)", "École", "Club", "Licence", "Nationalité", "Département", "Catégorie", "Téléphone", "Bulletin OK"],
      ...inscrits.map((i) => [i.dossard || "", i.nom, i.prenom, i.sexe || "", i.annee || "", i.ecole || "", i.club || "", i.licence || "", i.nationalite || "", i.departement || "", i.categorie || "", i.telephone || "", i.bulletin ? "Oui" : "Non"]),
    ],
  }]);
}

const LARGEURS_CLASSEMENT = [6, 10, 20, 18, 26, 26, 14, 14, 6, 8, 12];
const lignesClassement = (res) => [
  ["#", "Dossard", "Nom", "Prénom", "École", "Club", "Licence", "Catégorie", "Sexe", "Né(e)", "Temps"],
  ...res.individuel.map((l) => [l.position, l.dossard, l.nom, l.prenom, l.ecole, l.club, l.licence, l.categorie, l.sexe, l.naissance, l.enCours ? "En course" : l.temps]),
];

export function exporterResultats(nomFichier, res) {
  const feuilles = [{ nom: "Classement", largeurs: LARGEURS_CLASSEMENT, lignes: lignesClassement(res) }];
  if (res.ecoles.length) feuilles.push({
    nom: "Écoles",
    largeurs: [6, 30, 10, 8, 14],
    lignes: [["#", "École", "Inscrits", "Classés", "DNF", `Total (${res.regle.txt})`], ...res.ecoles.map((g) => [g.rang, g.ecole, g.nbInscrits, g.nbFinishers, g.nbDnf, g.scoreTxt])],
  });
  if (res.clubs.length) feuilles.push({
    nom: "Clubs",
    largeurs: [6, 30, 10, 8, 14],
    lignes: [["#", "Club", "Inscrits", "Classés", "DNF", `Total (${res.regle.txt})`], ...res.clubs.map((g) => [g.rang, g.ecole, g.nbInscrits, g.nbFinishers, g.nbDnf, g.scoreTxt])],
  });
  ecrire(nomFichier, feuilles);
}

/**
 * Résultats d'un événement : une feuille par course, avec son classement, nommée d'après la course.
 * @param {{nom: string, res: object}[]} parties  les courses dans l'ordre du programme
 */
export function exporterResultatsEvenement(nomFichier, parties) {
  const pris = new Set();
  const nomFeuille = (nom) => {
    // Excel : 31 caractères au plus, sans \ / ? * [ ] :, et deux feuilles ne peuvent pas avoir le même nom
    const base = String(nom || "Course").replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 27) || "Course";
    let n = base;
    for (let k = 2; pris.has(n.toLowerCase()); k++) n = `${base} ${k}`;
    pris.add(n.toLowerCase());
    return n;
  };
  ecrire(nomFichier, parties.map(({ nom, res }) => ({ nom: nomFeuille(nom), largeurs: LARGEURS_CLASSEMENT, lignes: lignesClassement(res) })));
}

/**
 * Résultats au format demandé par la FFA (réglementation des courses hors stade), à envoyer à la commission
 * départementale : place, dossard, nom, prénom, sexe, année, catégorie en code FFA (SE, M1, CA…), place dans
 * la catégorie (par sexe), nationalité, club, département, licence, temps officiel. Les abandons suivent les
 * arrivés ; les coureurs encore en course ne sont pas exportés.
 */
export function exporterFFA(nomFichier, c, res) {
  const code = (cat) => (cat ? codeCategorie(cat.replace(/\s+[FM]$/, "")) : ""); // « Minimes F » → MI
  const lignes = res.individuel.filter((l) => !l.enCours).map((l) => [
    l.dsq ? "Disqualifié" : l.dnf ? "Abandon" : Number(l.position), l.dossard, l.nom.toUpperCase(), l.prenom, l.sexe, l.naissance ? Number(l.naissance) : "",
    code(l.categorie), l.dnf ? "" : l.rangCatSexe ?? "", l.nationalite, l.club, l.departement, l.licence, l.dnf ? "" : l.temps,
  ]);
  const arrivants = lignes.filter((r) => typeof r[0] === "number").length;
  const date = c.date ? c.date.split("-").reverse().join("/") : "";
  ecrire(nomFichier, [
    {
      nom: "Résultats",
      largeurs: [8, 9, 22, 18, 6, 7, 6, 8, 6, 28, 6, 12, 10],
      lignes: [["Clt", "Dossard", "Nom", "Prénom", "Sexe", "Année", "Cat.", "Clt cat.", "Nat.", "Club", "Dépt", "N° licence", "Temps"], ...lignes],
    },
    {
      nom: "Épreuve",
      largeurs: [20, 50],
      lignes: [
        ["Épreuve", c.nom], ["Date", date], ["Lieu", c.lieu || ""], ["Distance (km)", Number(c.distance) || ""],
        ["Arrivants", arrivants], ["Abandons et disqualifiés", lignes.length - arrivants],
        ["Chronométrage", "Manuel, temps arrondis à la seconde supérieure"], ["Logiciel", "Loopace Chrono"],
      ],
    },
  ]);
  return { arrivants, abandons: lignes.length - arrivants };
}

export function telechargerModele() {
  ecrire("Modele_Import_Participants.xlsx", [
    {
      nom: "Import",
      // Colonnes obligatoires en premier : Nom, Sexe, Né
      largeurs: [20, 18, 8, 8, 10, 25, 25, 14, 12, 12, 16, 16, 12],
      lignes: [
        ["Nom ★", "Prenom", "Sexe ★", "Né ★", "Dossard", "Ecole", "Club", "Licence", "Nationalite", "Departement", "Categorie", "Telephone", "Bulletin"],
        ["Dupont", "Marie", "F", 2010, "", "Lycée Jean Moulin", "", "", "", "", "", "0612345678", "oui"],
        ["Martin", "Thomas", "M", 2009, "", "Collège Vauban", "", "", "", "", "", "", ""],
        ["Bernard", "Léa", "F", 2011, "12", "Lycée Jean Moulin", "Lencloitre JC 86", "2849415", "FRA", "86", "", "", "1"],
      ],
    },
    {
      nom: "Instructions",
      largeurs: [28, 70],
      lignes: [
        ["Instructions d'import — Loopace Chrono"],
        [],
        ["1. Remplissez la feuille « Import » à partir de la ligne 2 (la ligne 1 contient les en-têtes, ne la modifiez pas). Les colonnes marquées ★ sont obligatoires."],
        ["2. Les colonnes Nom, Sexe et Né (année de naissance) sont obligatoires et doivent être remplies sur chaque ligne ; une ligne incomplète est ignorée et signalée. Les autres colonnes peuvent rester vides."],
        ["3. Enregistrez le fichier, puis bouton « Excel » → « Choisir un fichier… » dans l'onglet Courses."],
        [],
        ["Colonne", "Description"],
        ["Nom ★", "Nom de famille (obligatoire)"],
        ["Prenom", "Prénom du participant (conseillé : sert à repérer les doublons)"],
        ["Sexe ★", "F ou M (obligatoire) ; Fille, Femme, Garçon, Homme, H sont aussi acceptés"],
        ["Né ★", "Année de naissance (obligatoire), ex : 2010 ; une date complète (12/03/2010) convient aussi"],
        ["Dossard", "Numéro de dossard, unique dans la course ; vide = à attribuer plus tard"],
        ["Ecole", "École ou établissement (classement par école)"],
        ["Club", "Club ou association (classement par club)"],
        ["Licence", "Numéro de licence (optionnel), affichable dans une colonne du PDF"],
        ["Nationalite", "Code à 3 lettres (FRA, BEL, ESP…) ; vide = FRA. Sert à l'export FFA"],
        ["Departement", "Département du club (ex : 86). Sert à l'export FFA"],
        ["Categorie", "Catégorie, seulement si la course est en saisie libre (sinon calculée d'après l'année)"],
        ["Telephone", "Numéro de téléphone (optionnel)"],
        ["Bulletin", "Bulletin d'inscription complet ? Valeurs acceptées : oui / 1 / true / x"],
        [],
        ["★ = colonne obligatoire"],
      ],
    },
  ]);
}
