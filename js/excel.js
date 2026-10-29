// Import / export Excel avec SheetJS (chargé par index.html : window.XLSX).

function lib() {
  if (!window.XLSX) throw new Error("La bibliothèque Excel n'est pas chargée (connexion nécessaire au premier lancement).");
  return window.XLSX;
}

const normaliser = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Lit la première feuille d'un .xlsx / .xls / .csv et renvoie les lignes de participants. */
export async function lireParticipants(fichier) {
  const XLSX = lib();
  const wb = XLSX.read(await fichier.arrayBuffer(), { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const lignes = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
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
    ecole: col("ecole", "école / club", "club", "school", "equipe"),
    categorie: col("categorie", "cat", "classe"),
    telephone: col("telephone", "tel", "phone"),
    bulletin: col("bulletin", "bulletinok", "bulletin ok", "inscrit"),
  };
  if (c.dossard === -1 || c.nom === -1)
    throw new Error("Colonnes obligatoires introuvables : le fichier doit contenir au minimum « Dossard » et « Nom ».");

  return lignes.slice(1).map((r) => {
    const get = (k) => (k >= 0 ? String(r[k] ?? "").trim() : "");
    let sexe = get(c.sexe).toUpperCase();
    if (sexe !== "M" && sexe !== "F") sexe = "F";
    const annee = parseInt(get(c.annee), 10);
    return {
      dossard: get(c.dossard), nom: get(c.nom), prenom: get(c.prenom), sexe,
      annee: Number.isFinite(annee) ? annee : null,
      ecole: get(c.ecole), categorie: get(c.categorie), telephone: get(c.telephone),
      bulletin: ["1", "oui", "true", "yes", "x", "vrai"].includes(get(c.bulletin).toLowerCase()),
    };
  }).filter((l) => l.dossard || l.nom);
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
    largeurs: [10, 20, 18, 6, 8, 26, 16, 16, 11],
    lignes: [
      ["Dossard", "Nom", "Prénom", "Sexe", "Né(e)", "École / Club", "Catégorie", "Téléphone", "Bulletin OK"],
      ...inscrits.map((i) => [i.dossard || "", i.nom, i.prenom, i.sexe || "", i.annee || "", i.ecole || "", i.categorie || "", i.telephone || "", i.bulletin ? "Oui" : "Non"]),
    ],
  }]);
}

export function exporterResultats(nomFichier, res) {
  const feuilles = [{
    nom: "Classement",
    largeurs: [6, 10, 20, 18, 26, 14, 6, 8, 12],
    lignes: [
      ["#", "Dossard", "Nom", "Prénom", "École / Club", "Catégorie", "Sexe", "Né(e)", "Temps"],
      ...res.individuel.map((l) => [l.position, l.dossard, l.nom, l.prenom, l.ecole, l.categorie, l.sexe, l.naissance, l.enCours ? "En course" : l.temps]),
    ],
  }];
  if (res.ecoles.length) feuilles.push({
    nom: "Écoles",
    largeurs: [6, 30, 10, 8, 14],
    lignes: [["#", "École / Club", "Classés", "DNF", "Somme top 3"], ...res.ecoles.map((g) => [g.rang, g.ecole, g.nbFinishers, g.nbDnf, g.sommeTxt])],
  });
  ecrire(nomFichier, feuilles);
}

export function telechargerModele() {
  ecrire("Modele_Import_Participants.xlsx", [
    {
      nom: "Import",
      largeurs: [12, 20, 18, 8, 8, 25, 16, 16, 12],
      lignes: [
        ["Dossard", "Nom", "Prenom", "Sexe", "Né", "Ecole", "Categorie", "Telephone", "Bulletin"],
        ["1", "Dupont", "Marie", "F", 2010, "Lycée Jean Moulin", "Cadette", "0612345678", "oui"],
        ["2", "Martin", "Thomas", "M", 2009, "Collège Vauban", "Cadet", "", ""],
        ["3", "Bernard", "Léa", "F", 2011, "Lycée Jean Moulin", "Cadette", "", "1"],
      ],
    },
    {
      nom: "Instructions",
      largeurs: [28, 70],
      lignes: [
        ["Instructions d'import — Loopace Chrono"],
        [],
        ["1. Remplissez la feuille « Import » à partir de la ligne 2 (la ligne 1 contient les en-têtes, ne la modifiez pas)."],
        ["2. Seules les colonnes Dossard et Nom sont obligatoires. Les autres peuvent rester vides."],
        ["3. Enregistrez le fichier, puis utilisez « Importer Excel » dans l'onglet Courses."],
        [],
        ["Colonne", "Description"],
        ["Dossard ★", "Numéro de dossard (obligatoire, unique dans la course)"],
        ["Nom ★", "Nom de famille (obligatoire)"],
        ["Prenom", "Prénom du participant"],
        ["Sexe", "F ou M (défaut : F si absent ou valeur inconnue)"],
        ["Né", "Année de naissance (ex : 2008)"],
        ["Ecole", "École ou club d'appartenance"],
        ["Categorie", "Catégorie (ex : Poussins, Benjamins, Cadets…)"],
        ["Telephone", "Numéro de téléphone (optionnel)"],
        ["Bulletin", "Bulletin d'inscription complet ? Valeurs acceptées : oui / 1 / true / x"],
        [],
        ["★ = colonne obligatoire"],
      ],
    },
  ]);
}
