// Diplômes PDF (jsPDF, chargé par index.html) : un par coureur, en A5 paysage, deux par feuille A4 à découper.
// Couleur, logo et titre de l'organisateur viennent du modèle PDF de la course.

const A4_L = 595.28;
const A4_H = 841.89;
const A5_H = A4_H / 2;
const MARGE = 22;
const MEDAILLES = { 1: "#D4A017", 2: "#9E9E9E", 3: "#B8733A" };

const hexValide = (c) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c || "");
/** 1er / 1re, 2e, 3e… */
export const ordinal = (n, sexe) => (n === 1 ? (sexe === "F" ? "1re" : "1er") : `${n}e`);

/**
 * @param {object} p
 * @param {object} p.course     course (nom, date, lieu, distance)
 * @param {object|null} p.theme modèle PDF de la course (couleur, logo, titre, pied de page)
 * @param {object[]} p.lignes   lignes de résultats (calc) des coureurs qui reçoivent un diplôme, dans l'ordre voulu
 * @param {number} p.nbArrives  nombre d'arrivés (« 3e sur 120 »)
 * @param {string} p.titre      titre du diplôme (« Diplôme » par défaut)
 * @param {string} p.signature  texte sous la ligne de signature (optionnel)
 * @returns {Blob}
 */
export function genererDiplomes({ course, theme, lignes, nbArrives, titre, signature }) {
  if (!window.jspdf?.jsPDF) throw new Error("La bibliothèque PDF n'est pas chargée (connexion nécessaire au premier lancement).");
  const t = theme || {};
  const couleur = hexValide(t.couleur) ? t.couleur : "#15291F";
  const doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const date = course.date ? course.date.split("-").reverse().join("/") : "";
  const details = [date, course.lieu, Number(course.distance) > 0 && `${String(course.distance).replace(".", ",")} km`].filter(Boolean).join("  ·  ");

  /** Texte centré, réduit si trop large pour la largeur disponible. */
  function centre(txt, y, taille, { gras = false, italique = false, teinte = "#212121", max = A4_L - 2 * MARGE - 60 } = {}) {
    let corps = taille;
    doc.setFont("helvetica", gras ? "bold" : italique ? "italic" : "normal").setTextColor(teinte);
    while (corps > 8 && doc.setFontSize(corps).getTextWidth(txt) > max) corps -= 1;
    doc.text(txt, A4_L / 2, y, { align: "center" });
  }

  function medaille(rang, x, y, legende) {
    doc.setFillColor(MEDAILLES[rang]).circle(x, y, 22, "F");
    doc.setDrawColor("#FFFFFF").setLineWidth(1.5).circle(x, y, 18, "S");
    doc.setFont("helvetica", "bold").setFontSize(20).setTextColor("#FFFFFF").text(String(rang), x, y + 7, { align: "center" });
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor("#616161").text(legende, x, y + 34, { align: "center" });
  }

  function diplome(l, y0) {
    const fini = !l.dnf && l.ms != null;
    // Cadre double à la couleur du modèle
    doc.setDrawColor(couleur).setLineWidth(2.5).rect(MARGE, y0 + MARGE, A4_L - 2 * MARGE, A5_H - 2 * MARGE);
    doc.setLineWidth(0.6).rect(MARGE + 6, y0 + MARGE + 6, A4_L - 2 * MARGE - 12, A5_H - 2 * MARGE - 12);

    if (t.logo) {
      try {
        const p = doc.getImageProperties(t.logo);
        const r = Math.min(54 / p.width, 54 / p.height);
        doc.addImage(t.logo, MARGE + 18, y0 + MARGE + 16, p.width * r, p.height * r);
      } catch { /* logo illisible : ignoré */ }
    }
    if (t.titre?.trim()) centre(t.titre.trim(), y0 + 62, 11, { teinte: "#616161", max: 330 });

    // Médaille : podium au général, sinon podium de la catégorie
    if (fini && +l.position <= 3) medaille(+l.position, A4_L - MARGE - 56, y0 + MARGE + 50, "Scratch");
    else if (fini && l.rangCategorie <= 3) medaille(l.rangCategorie, A4_L - MARGE - 56, y0 + MARGE + 50, l.categorie);

    centre((titre || "Diplôme").toUpperCase(), y0 + 104, 34, { gras: true, teinte: couleur, max: 340 });
    centre("décerné à", y0 + 128, 12, { italique: true, teinte: "#757575" });
    centre(`${l.prenom} ${l.nom.toUpperCase()}`.trim(), y0 + 162, 26, { gras: true });
    const equipe = [l.ecole, l.club].filter(Boolean).join("  ·  ");
    if (equipe) centre(equipe, y0 + 182, 11, { teinte: "#616161" });

    centre(course.nom, y0 + 214, 14, { gras: true, teinte: couleur });
    if (details) centre(details, y0 + 231, 10, { teinte: "#616161" });

    if (fini) {
      centre(`${l.sexe === "F" ? "Classée" : "Classé"} ${ordinal(+l.position, l.sexe)} sur ${nbArrives}`, y0 + 270, 19, { gras: true });
      const suite = [l.rangCategorie && l.categorie && `${ordinal(l.rangCategorie, l.sexe)} en ${l.categorie}`, `Temps : ${l.temps}`].filter(Boolean).join("   ·   ");
      centre(suite, y0 + 292, 13, { teinte: "#424242" });
    } else {
      centre("Pour sa participation", y0 + 278, 19, { gras: true });
    }

    // Date à gauche, signature à droite, pied de page du modèle au centre
    const yBas = y0 + A5_H - MARGE - 38;
    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor("#616161");
    if (date) doc.text(`Le ${date}`, MARGE + 24, yBas + 14);
    if (signature?.trim()) {
      const xSig = A4_L - MARGE - 24;
      doc.setDrawColor("#9E9E9E").setLineWidth(0.5).line(xSig - 170, yBas, xSig, yBas);
      doc.text(signature.trim(), xSig - 85, yBas + 14, { align: "center", maxWidth: 170 });
    }
    if (t.piedPage?.trim()) {
      doc.setFontSize(8).setTextColor("#9E9E9E");
      doc.text(t.piedPage.trim(), A4_L / 2, y0 + A5_H - MARGE - 12, { align: "center", maxWidth: 300 });
    }
  }

  lignes.forEach((l, k) => {
    if (k && k % 2 === 0) doc.addPage();
    diplome(l, (k % 2) * A5_H);
  });
  // Trait de coupe au milieu de chaque feuille
  for (let p = 1; p <= doc.getNumberOfPages(); p++) {
    doc.setPage(p);
    doc.setDrawColor("#BDBDBD").setLineWidth(0.5).setLineDashPattern([4, 4], 0).line(8, A5_H, A4_L - 8, A5_H).setLineDashPattern([], 0);
  }
  return doc.output("blob");
}
