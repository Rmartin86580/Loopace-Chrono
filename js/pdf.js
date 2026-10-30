// Feuille de résultats PDF (jsPDF + AutoTable, chargés par index.html), selon le modèle PDF de la course :
// le modèle choisit le contenu (classements, colonnes, orientation) et l'apparence (couleur, logo, titres).

const OR = "#FFF9C4", ARGENT = "#F5F5F5", BRONZE = "#FFE0B2", ENTETE = "#E3F2FD";

/** Colonnes possibles des classements, dans l'ordre proposé (« # » en tête et « Temps » sont toujours présentes). */
export const COLONNES_PDF = [
  { cle: "dossard", titre: "Dossard", largeur: 42 },
  { cle: "nom", titre: "Nom" },
  { cle: "prenom", titre: "Prénom" },
  { cle: "nomPrenom", titre: "Nom Prénom", aide: "Nom Prénom (une seule colonne, NOM Prénom)" },
  { cle: "ecole", titre: "École" },
  { cle: "club", titre: "Club" },
  { cle: "licence", titre: "Licence", largeur: 64 },
  { cle: "categorie", titre: "Catégorie", largeur: 54 },
  { cle: "sexe", titre: "Sexe", largeur: 30 },
  { cle: "naissance", titre: "Né(e)", largeur: 34 },
  { cle: "rangCategorie", titre: "Rg cat.", largeur: 52, aide: "Rang dans la catégorie (ex. M1-H(1))" },
  { cle: "rangSexe", titre: "Rg sexe", largeur: 40, aide: "Rang par sexe (ex. 1-H)" },
  { cle: "ecart", titre: "Écart au 1er", largeur: 58 },
  { cle: "vitesse", titre: "km/h", largeur: 36, aide: "Vitesse (km/h)" },
  { cle: "allure", titre: "Allure", largeur: 50, aide: "Allure (ex. 3:21 /km)" },
  { cle: "temps", titre: "Temps", largeur: 56, aide: "Temps (toujours affiché)", fixe: true },
];
export const COLONNES_DEFAUT = ["dossard", "nom", "prenom", "ecole", "categorie", "sexe", "naissance"];

/** Classements possibles ; le modèle les range dans l'ordre voulu (t.sections). */
export const SECTIONS_PDF = [
  { cle: "general", titre: "Classement général", aide: "Tout le monde, au temps" },
  { cle: "sexe", titre: "Par sexe", aide: "Filles, garçons" },
  { cle: "categorie", titre: "Par catégorie", aide: "Un bloc par catégorie" },
  { cle: "ecole", titre: "Par école", aide: "Tous les inscrits, école par école" },
  { cle: "club", titre: "Par club", aide: "Tous les inscrits, club par club" },
  { cle: "podiums", titre: "Podiums", aide: "3 premiers filles, garçons, catégories — page à part" },
];

/** Classements d'un modèle, dans son ordre ; anciens modèles : d'après leurs cases à cocher, dans l'ordre d'origine. */
export function sectionsDe(t) {
  if (Array.isArray(t?.sections)) return t.sections.filter((cle) => SECTIONS_PDF.some((s) => s.cle === cle));
  return [
    t?.classementGeneral !== false && "general", t?.classementSexe && "sexe", t?.classementCategorie && "categorie",
    t?.afficherEcoles !== false && "ecole", t?.afficherClubs && "club", t?.podiums && "podiums",
  ].filter(Boolean);
}

const deuxChiffres = (n) => String(n).padStart(2, "0");
function fmtEcart(ms) {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
  return `+${h ? `${h}:${deuxChiffres(m)}` : m}:${deuxChiffres(sec)}`;
}
const MARGE = 42.5; // 1,5 cm en points

// Codes courts des catégories, pour les rangs « M1-H(1) » : Masters M1 → M1, Seniors → SE, Minimes 1 → MI1…
const CODES = {
  "baby athle": "BB", "eveil athle": "EA", "mini-poussins": "MP", poussins: "PO", pupilles: "PU", benjamins: "BE",
  minimes: "MI", cadets: "CA", juniors: "JU", espoirs: "ES", seniors: "SE",
};
export function codeCategorie(nom) {
  const n = String(nom ?? "").trim();
  const masters = n.match(/\s([A-Z]\d{1,2})$/);
  if (masters) return masters[1];
  if (n.length <= 4) return n; // classes : CP, 6e…
  const cle = n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const [, base, num = ""] = cle.match(/^(.*?)(?:\s+(\d+))?$/);
  return (CODES[base] || base.replace(/[^a-z]/g, "").slice(0, 2).toUpperCase()) + num;
}
const lettreSexe = (s) => ({ M: "H", F: "F" })[s] || "";

const hexValide = (c) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c || "");
const borne = (v, min, max, def) => (Number.isFinite(+v) && v !== "" && v != null ? Math.min(max, Math.max(min, +v)) : def);
const fondPodium = (rang) => ({ 1: OR, 2: ARGENT, 3: BRONZE })[rang] || "#FFFFFF";

/**
 * @param {object} p
 * @param {object} p.course   course (nom…)
 * @param {object|null} p.theme thème PDF (couleur, logo, titre…)
 * @param {object} p.res       résultat de calc.resultats()
 * @returns {Blob}
 */
export function genererPdf({ course, theme, res }) {
  if (!window.jspdf?.jsPDF) throw new Error("La bibliothèque PDF n'est pas chargée (connexion nécessaire au premier lancement).");
  const t = theme || {};
  const couleur = hexValide(t.couleur) ? t.couleur : "#15291F";
  const tailleLogo = borne(t.tailleLogo, 20, 200, 60);
  const tailleTitre = borne(t.tailleTitre, 8, 48, 16);
  const pied = (t.piedPage?.trim() || "Loopace Chrono") + "  —  Page ";

  const doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4", orientation: t.paysage ? "landscape" : "portrait" });
  const L = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  // ── En-tête (répété sur chaque page) ────────────────────────
  function entete() {
    let x = MARGE;
    const lignes = [{ txt: "Loopace Chrono", taille: 11, gras: true, couleur }];
    if (t.titre?.trim()) {
      lignes.push({ txt: t.titre.trim(), taille: tailleTitre, gras: true, couleur: "#212121" });
      lignes.push({ txt: course.nom, taille: Math.max(9, tailleTitre - 4), gras: false, couleur: "#424242" });
    } else {
      lignes.push({ txt: course.nom, taille: tailleTitre, gras: true, couleur: "#212121" });
    }
    if (t.sousTitre?.trim()) lignes.push({ txt: t.sousTitre.trim(), taille: 10, gras: false, couleur: "#616161" });
    const hTexte = lignes.reduce((s, l) => s + l.taille * 1.2, 0);

    let hLogo = 0;
    if (t.logo) {
      try {
        const props = doc.getImageProperties(t.logo);
        const r = Math.min(tailleLogo / props.width, tailleLogo / props.height);
        const w = props.width * r, h = props.height * r;
        hLogo = tailleLogo;
        const hBloc = Math.max(hLogo, hTexte);
        doc.addImage(t.logo, MARGE + (tailleLogo - w) / 2, MARGE + (hBloc - h) / 2, w, h);
        x += tailleLogo + 10;
      } catch { /* logo illisible : ignoré */ }
    }
    const hBloc = Math.max(hLogo, hTexte);
    let y = MARGE + (hBloc - hTexte) / 2;
    lignes.forEach((l) => {
      doc.setFont("helvetica", l.gras ? "bold" : "normal").setFontSize(l.taille).setTextColor(l.couleur);
      y += l.taille;
      doc.text(l.txt, x, y, { maxWidth: L - x - MARGE });
      y += l.taille * 0.2;
    });

    let yInfo = MARGE + hBloc + 16;
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor("#616161");
    doc.text(res.info, L - MARGE, yInfo, { align: "right" });
    yInfo += 6;
    doc.setDrawColor(couleur).setLineWidth(1).line(MARGE, yInfo, L - MARGE, yInfo);
    return yInfo;
  }

  const basEntete = entete();
  const hautContenu = basEntete + 14;
  const optionsTable = {
    theme: "plain",
    margin: { top: hautContenu, left: MARGE, right: MARGE, bottom: MARGE + 14 },
    styles: { font: "helvetica", fontSize: 8, cellPadding: 3, textColor: "#212121", lineColor: "#E0E0E0", lineWidth: { bottom: 0.5 } },
    headStyles: { fillColor: ENTETE, fontStyle: "bold", lineWidth: 0 },
  };

  function titreSection(txt, y) {
    doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(couleur);
    doc.text(txt, MARGE, y);
    return y + 6;
  }

  // ── Colonnes choisies par le modèle ────────────────────────
  const choisies = Array.isArray(t.colonnes) ? t.colonnes : COLONNES_DEFAUT;
  const avecTemps = (cles) => (cles.includes("temps") ? cles : [...cles, "temps"]); // anciens modèles : temps en dernier
  // Ordre du modèle ; sans la colonne école ou club quand la course n'en a pas (réglage de la fiche course)
  const permise = (c) => (c.cle !== "ecole" || res.equipes?.ecole !== false) && (c.cle !== "club" || res.equipes?.club !== false);
  const colonnes = avecTemps(choisies).map((cle) => COLONNES_PDF.find((c) => c.cle === cle)).filter((c) => c && permise(c));
  const premier = res.individuel.find((l) => !l.dnf && !l.enCours)?.ms ?? null;
  const km = Number(course.distance) > 0 ? Number(course.distance) : null;
  const valeur = (l, cle) => {
    if (cle === "temps") return l.enCours ? "En course" : l.temps;
    const fini = !l.dnf && !l.enCours && l.ms != null;
    if (cle === "ecart") return fini && premier != null ? (l.ms === premier ? "—" : fmtEcart(l.ms - premier)) : "";
    if (cle === "vitesse") return fini && km ? (km / (l.ms / 3600000)).toFixed(1).replace(".", ",") : "";
    if (cle === "allure") { if (!fini || !km) return ""; const s = Math.round(l.ms / 1000 / km); return `${Math.floor(s / 60)}:${deuxChiffres(s % 60)} /km`; }
    if (cle === "nomPrenom") return `${l.nom.toUpperCase()} ${l.prenom}`.trim();
    if (cle === "rangSexe") return l.rangSexe ? `${l.rangSexe}-${lettreSexe(l.sexe)}` : "";
    if (cle === "rangCategorie") {
      if (!l.rangCatSexe || !l.categorie) return "";
      const sexe = lettreSexe(l.sexe);
      return `${codeCategorie(l.categorie)}${sexe ? `-${sexe}` : ""}(${l.rangCatSexe})`;
    }
    return l[cle] ?? "";
  };
  /** En-tête, lignes et largeurs d'un tableau : colonnes de tête fixes, puis les colonnes du modèle (temps compris). */
  function tableau(tete, lignes, sansCles = [], forcees = null) {
    const cols = (forcees ? COLONNES_PDF.filter((c) => avecTemps(forcees).includes(c.cle)) : colonnes).filter((c) => !sansCles.includes(c.cle));
    const styles = {};
    // fontStyle seulement quand il est gras : « undefined » écraserait le style normal par défaut
    const gras = (oui) => (oui ? { fontStyle: "bold" } : {});
    tete.forEach((c, k) => { styles[k] = { cellWidth: c.largeur, ...gras(k === 0) }; });
    cols.forEach((c, k) => { if (c.largeur) styles[tete.length + k] = { cellWidth: c.largeur, ...gras(c.cle === "temps") }; });
    return {
      head: [[...tete.map((c) => c.titre), ...cols.map((c) => c.titre)]],
      body: lignes.map(({ tete: v, l }) => [...v, ...cols.map((c) => valeur(l, c.cle))]),
      columnStyles: styles,
    };
  }

  let y = hautContenu - 14;

  const podium = { didParseCell: (d) => { if (d.section === "body") d.cell.styles.fillColor = fondPodium(+d.row.raw[0]); } };
  const sautSiBesoin = (besoin) => { if (y + besoin > H - MARGE - 20) { doc.addPage(); y = hautContenu; } };
  let sections = 0;
  let apresPodiums = false;
  /** Titre d'une nouvelle partie : en haut de la première page, puis à la suite (ou sur une nouvelle page si besoin). */
  function nouvelleSection(titre, pageNeuve = false) {
    if (apresPodiums) { pageNeuve = true; apresPodiums = false; }
    if (sections && (pageNeuve || y > hautContenu)) {
      if (pageNeuve) { doc.addPage(); y = hautContenu; } else sautSiBesoin(90);
    }
    y = titreSection(titre, sections && y > hautContenu ? y + 24 : hautContenu + 10);
    sections++;
  }

  /**
   * Une partie faite de groupes (sexe, catégorie, école) : un bandeau de couleur par groupe puis son tableau.
   * « rang » donne la place dans le groupe ; « sans » retire la colonne devenue inutile (ex. la catégorie).
   */
  function groupes(titre, liste, { rangTitre, rang, sans = [], infos = (g) => [], forcees = null, pageNeuve = false }) {
    if (!liste.length) return;
    nouvelleSection(titre, pageNeuve);
    liste.forEach((g, k) => {
      sautSiBesoin(60);
      y += k ? 10 : 4;
      doc.setFillColor(couleur).rect(MARGE, y, L - 2 * MARGE, 20, "F");
      doc.setFont("helvetica", "bold").setFontSize(10).setTextColor("#FFFFFF");
      doc.text(g.titre, MARGE + 6, y + 13.5, { maxWidth: L - 2 * MARGE - 220 });
      doc.setFont("helvetica", "normal").setFontSize(8).setTextColor("#E3F2FD");
      doc.text(infos(g).join("  |  "), L - MARGE - 6, y + 13.5, { align: "right" });
      doc.autoTable({
        ...optionsTable, ...podium,
        startY: y + 20,
        ...tableau([{ titre: rangTitre, largeur: 40 }, { titre: "#Gén.", largeur: 36 }],
          g.participants.map((l) => ({ tete: [String(rang(l) ?? (l.dnf ? "DNF" : "-")), l.position], l })), sans, forcees),
      });
      y = doc.lastAutoTable.finalY;
    });
  }
  const effectif = (g) => [`${g.nbFinishers} classé(s)`, ...(g.nbDnf ? [`${g.nbDnf} DNF`] : [])];

  // Colonnes des podiums : dossard, nom, puis l'école et / ou le club si le modèle les affiche
  const aCol = (cle) => colonnes.some((c) => c.cle === cle);
  const equipesPodium = ["ecole", "club"].filter(aCol);
  const colsPodium = [...(aCol("nomPrenom") ? ["dossard", "nomPrenom"] : ["dossard", "nom", "prenom"]), ...(equipesPodium.length ? equipesPodium : [res.equipes?.ecole === false ? "club" : "ecole"])];
  // Écoles et clubs : tous les inscrits sont listés, l'effectif le dit
  const infosEquipe = (g) => [`${g.nbInscrits} inscrit(s)`, ...effectif(g), ...(g.nbAbsents ? [`${g.nbAbsents} non partant(s)`] : []),
    ...(g.score != null ? [`${res.regle.txt} : ${g.scoreTxt}`] : [])];

  // Chaque classement, dans l'ordre choisi par le modèle
  const SECTIONS = {
    general() {
      nouvelleSection("Classement général");
      doc.autoTable({
        ...optionsTable, ...podium,
        startY: y,
        ...tableau([{ titre: "#", largeur: 28 }], res.individuel.map((l) => ({ tete: [l.position], l }))),
      });
      y = doc.lastAutoTable.finalY;
    },
    sexe: () => groupes("Classement par sexe", res.sexes.map((g) => ({ ...g, titre: g.nom })),
      { rangTitre: "#", rang: (l) => l.rangSexe, sans: ["sexe", "rangSexe"], infos: effectif }),
    categorie: () => groupes("Classement par catégorie", res.categories.map((g) => ({ ...g, titre: g.nom })),
      { rangTitre: "#Cat.", rang: (l) => l.rangCategorie, sans: ["categorie", "rangCategorie"], infos: effectif }),
    ecole: () => groupes("Classement par école", res.ecoles.map((g) => ({ ...g, titre: `${g.rang}. ${g.ecole}` })),
      { rangTitre: "#École", rang: (l) => l.rangEcole, sans: ["ecole"], infos: infosEquipe }),
    club: () => groupes("Classement par club", res.clubs.map((g) => ({ ...g, titre: `${g.rang}. ${g.ecole}` })),
      { rangTitre: "#Club", rang: (l) => l.rangClub, sans: ["club"], infos: infosEquipe }),
    // Podiums : les 3 premiers, filles, garçons puis chaque catégorie, sur une page à part
    podiums() {
      const top3 = (g, rang) => ({ ...g, participants: g.participants.filter((l) => !l.dnf && rang(l) <= 3) });
      const scratch = res.sexes.map((g) => ({ ...top3(g, (l) => l.rangSexe), titre: `Scratch ${g.nom.toLowerCase()}`, rang: (l) => l.rangSexe }));
      // Pas de cumul : ceux du podium scratch sont retirés des podiums de catégorie, les suivants montent
      const dejaPrimes = new Set(t.podiumsSansCumul ? scratch.flatMap((g) => g.participants.map((l) => l.id)) : []);
      const parCategorie = res.categories.map((g) => {
        const podium = g.participants.filter((l) => l.rangCategorie != null && !dejaPrimes.has(l.id)).slice(0, 3);
        return { ...g, participants: podium, titre: g.nom, rang: (l) => podium.indexOf(l) + 1 };
      });
      const liste = [...scratch, ...parCategorie].filter((g) => g.participants.length);
      if (!liste.length) return;
      nouvelleSection("Podiums", sections > 0);
      liste.forEach((g, k) => {
        sautSiBesoin(70);
        y += k ? 10 : 4;
        doc.setFillColor(couleur).rect(MARGE, y, L - 2 * MARGE, 18, "F");
        doc.setFont("helvetica", "bold").setFontSize(10).setTextColor("#FFFFFF");
        doc.text(g.titre, MARGE + 6, y + 12.5);
        doc.autoTable({
          ...optionsTable, ...podium,
          startY: y + 18,
          ...tableau([{ titre: "Place", largeur: 40 }], g.participants.map((l) => ({ tete: [g.rang(l)], l })), [], colsPodium),
        });
        y = doc.lastAutoTable.finalY;
      });
      apresPodiums = true; // la partie suivante repart sur une nouvelle page
    },
  };
  sectionsDe(t).forEach((cle) => SECTIONS[cle]());

  // ── En-tête des pages suivantes et pied de page ────────────
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p);
    if (p > 1) entete();
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor("#757575");
    doc.text(`${pied}${p} / ${n}`, L / 2, H - MARGE / 2 - 4, { align: "center" });
  }

  return doc.output("blob");
}

export function nomFichier(prefixe, nomCourse, ext) {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const nom = nomCourse.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w-]+/g, "_").replace(/^_|_$/g, "");
  return `${prefixe}${nom}_${date}.${ext}`;
}
