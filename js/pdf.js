// Feuille de résultats PDF (jsPDF + AutoTable, chargés par index.html), personnalisée par le thème de la course.

const OR = "#FFF9C4", ARGENT = "#F5F5F5", BRONZE = "#FFE0B2", ENTETE = "#E3F2FD";
const MARGE = 42.5; // 1,5 cm en points

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

  const doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
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

  // ── Classement individuel ──────────────────────────────────
  let y = titreSection("Classement individuel", hautContenu + 10);
  doc.autoTable({
    ...optionsTable,
    startY: y,
    head: [["#", "Dossard", "Nom", "Prénom", "École / Club", "Catégorie", "Sexe", "Né(e)", "Temps"]],
    body: res.individuel.map((l) => [l.position, l.dossard, l.nom, l.prenom, l.ecole, l.categorie, l.sexe, l.naissance, l.enCours ? "En course" : l.temps]),
    columnStyles: { 0: { cellWidth: 28, fontStyle: "bold" }, 1: { cellWidth: 42 }, 5: { cellWidth: 50 }, 6: { cellWidth: 32 }, 7: { cellWidth: 36 }, 8: { cellWidth: 56, fontStyle: "bold" } },
    didParseCell: (d) => { if (d.section === "body") d.cell.styles.fillColor = fondPodium(+d.row.raw[0]); },
  });
  y = doc.lastAutoTable.finalY;

  // ── Classement par école ───────────────────────────────────
  if (t.afficherEcoles !== false && res.ecoles.length) {
    const sautSiBesoin = (besoin) => { if (y + besoin > H - MARGE - 20) { doc.addPage(); y = hautContenu; } };
    sautSiBesoin(70);
    y = titreSection("Classement par école / club", y + 24);

    res.ecoles.forEach((g) => {
      sautSiBesoin(60);
      y += 8;
      doc.setFillColor(couleur).rect(MARGE, y, L - 2 * MARGE, 20, "F");
      doc.setFont("helvetica", "bold").setFontSize(10).setTextColor("#FFFFFF");
      doc.text(`${g.rang}. ${g.ecole}`, MARGE + 6, y + 13.5, { maxWidth: L - 2 * MARGE - 200 });
      doc.setFont("helvetica", "normal").setFontSize(8).setTextColor("#E3F2FD");
      const infos = [`${g.nbFinishers} classé(s)`];
      if (g.nbDnf) infos.push(`${g.nbDnf} DNF`);
      if (g.somme != null) infos.push(`top 3 : ${g.sommeTxt}`);
      doc.text(infos.join("  |  "), L - MARGE - 6, y + 13.5, { align: "right" });

      doc.autoTable({
        ...optionsTable,
        startY: y + 20,
        head: [["#École", "#Gén.", "Dossard", "Nom", "Prénom", "Catégorie", "Sexe", "Né(e)", "Temps"]],
        body: g.participants.map((l) => [l.dnf ? "DNF" : String(l.rangEcole), l.position, l.dossard, l.nom, l.prenom, l.categorie, l.sexe, l.naissance, l.temps]),
        columnStyles: { 0: { cellWidth: 40, fontStyle: "bold" }, 1: { cellWidth: 36 }, 2: { cellWidth: 42 }, 5: { cellWidth: 50 }, 6: { cellWidth: 32 }, 7: { cellWidth: 36 }, 8: { cellWidth: 56, fontStyle: "bold" } },
        didParseCell: (d) => { if (d.section === "body") d.cell.styles.fillColor = fondPodium(+d.row.raw[0]); },
      });
      y = doc.lastAutoTable.finalY;
    });
  }

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
