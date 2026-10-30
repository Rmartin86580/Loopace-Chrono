// Logique métier : départ, arrivées, arrêt, classements individuel et par école.
// Un inscrit est « partant » s'il avait son bulletin au moment du départ (il reçoit alors une heure de départ).

import { state, course, inscritsDe } from "./store.js?v=14";

// ── Formats ───────────────────────────────────────────────────
const p2 = (n) => String(n).padStart(2, "0");

export function fmtDuree(ms, dixiemes = false) {
  if (ms == null || ms < 0) return "";
  const s = Math.floor(ms / 1000);
  const base = `${p2(Math.floor(s / 3600))}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}`;
  return dixiemes ? `${base}.${Math.floor((ms % 1000) / 100)}` : base;
}

export const fmtHeure = (t) => (t ? new Date(t).toLocaleTimeString("fr-FR") : "");

export function fmtDate(iso) {
  if (!iso) return "";
  const [a, m, j] = iso.split("-");
  return `${j}/${m}/${a}`;
}

/** Tri « naturel » : 2 avant 10, vides à la fin. */
export function compareDossard(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return String(a).localeCompare(String(b), "fr", { numeric: true });
}

const memeDossard = (a, b) => {
  if (a == null || b == null) return false;
  a = String(a).trim(); b = String(b).trim();
  return a === b || (/^\d+$/.test(a) && /^\d+$/.test(b) && Number(a) === Number(b));
};

export const nomComplet = (i) => `${i.prenom || ""} ${i.nom || ""}`.trim();
export const duree = (i) => (i.depart != null && i.arrivee != null ? i.arrivee - i.depart : null);

// ── Chronomètre ───────────────────────────────────────────────
export function etatChrono(c) {
  return c?.chrono || { etat: "attente", depart: null, fin: null };
}

/** Temps affiché par le grand chronomètre. */
export function tempsCourse(c, now = Date.now()) {
  const ch = etatChrono(c);
  if (ch.depart == null) return 0;
  return (ch.fin ?? now) - ch.depart;
}

/** Répartition des inscrits d'une course pendant le chrono. */
export function situation(courseId) {
  return situationDe(inscritsDe(courseId));
}

/** Même répartition sur une liste d'inscrits quelconque (par exemple celle d'une archive). */
export function situationDe(tous) {
  const partants = tous.filter((i) => i.depart != null);
  const arrives = partants.filter((i) => i.arrivee != null).sort((a, b) => a.arrivee - b.arrivee);
  const dnf = partants.filter((i) => i.arrivee == null && i.statut === "DNF").sort((a, b) => compareDossard(a.dossard, b.dossard));
  const enCours = partants.filter((i) => i.arrivee == null && i.statut !== "DNF").sort((a, b) => compareDossard(a.dossard, b.dossard));
  const avecBulletin = tous.filter((i) => i.bulletin);
  return { tous, partants, arrives, dnf, enCours, avecBulletin };
}

/** Départ groupé : tous les inscrits dont le bulletin est complet partent à la même heure. */
export function demarrer(courseId) {
  const c = course(courseId);
  const now = Date.now();
  inscritsDe(courseId).forEach((i) => {
    i.depart = i.bulletin ? now : null;
    i.arrivee = null;
    i.statut = null;
  });
  c.chrono = { etat: "en-cours", depart: now, fin: null };
}

/**
 * Enregistre l'arrivée d'un dossard.
 * @returns {{ok: boolean, message: string, inscrit?: object, termine?: boolean}}
 */
export function arrivee(courseId, dossard) {
  const c = course(courseId);
  if (etatChrono(c).etat !== "en-cours") return { ok: false, message: "La course n'est pas en cours." };
  const i = inscritsDe(courseId).find((x) => memeDossard(x.dossard, dossard));
  if (!i) return { ok: false, message: `Dossard ${dossard} inconnu dans cette course.` };
  if (i.depart == null) return { ok: false, message: `Dossard ${dossard} (${nomComplet(i)}) n'a pas pris le départ : bulletin incomplet.` };
  if (i.arrivee != null) return { ok: false, message: `Dossard ${dossard} (${nomComplet(i)}) est déjà arrivé.` };
  i.arrivee = Date.now();
  i.statut = null;

  // Arrêt automatique quand plus personne n'est en course
  const termine = situation(courseId).enCours.length === 0;
  if (termine) c.chrono = { ...c.chrono, etat: "arretee", fin: i.arrivee };
  return { ok: true, message: "", inscrit: i, termine };
}

/** Arrêt manuel : les partants pas encore arrivés passent DNF. */
export function arreter(courseId) {
  const c = course(courseId);
  situation(courseId).enCours.forEach((i) => { i.statut = "DNF"; });
  c.chrono = { ...etatChrono(c), etat: "arretee", fin: Date.now() };
}

/** Annule la dernière arrivée ; si la course était terminée, elle reprend. */
export function annulerDerniere(courseId) {
  const { arrives } = situation(courseId);
  const derniere = arrives[arrives.length - 1];
  if (!derniere) return null;
  derniere.arrivee = null;
  derniere.statut = null;
  const c = course(courseId);
  if (etatChrono(c).etat === "arretee") c.chrono = { ...c.chrono, etat: "en-cours", fin: null };
  return derniere;
}

/** Remise à zéro : tous les temps de la course sont effacés. */
export function reinitialiser(courseId) {
  inscritsDe(courseId).forEach((i) => { i.depart = null; i.arrivee = null; i.statut = null; });
  course(courseId).chrono = { etat: "attente", depart: null, fin: null };
}

// ── Résultats ─────────────────────────────────────────────────
function ligne(i, position) {
  const ms = duree(i);
  const dnf = i.statut === "DNF";
  return {
    id: i.id,
    position: dnf ? "DNF" : position != null ? String(position) : "-",
    dossard: i.dossard || "",
    nom: i.nom || "",
    prenom: i.prenom || "",
    ecole: i.ecole || "",
    categorie: i.categorie || "",
    sexe: i.sexe || "",
    naissance: i.annee ? String(i.annee) : "",
    ms,
    temps: dnf ? "DNF" : fmtDuree(ms),
    dnf,
    enCours: !dnf && ms == null,
    rangEcole: null,
  };
}

/** Classement individuel (au temps), puis classement par école (somme des 3 meilleurs temps). */
export function resultats(courseId) {
  return resultatsDe(course(courseId), inscritsDe(courseId));
}

/** Mêmes résultats calculés sur une course et ses inscrits donnés (par exemple ceux d'une archive). */
export function resultatsDe(c, inscrits) {
  const { partants, dnf, enCours } = situationDe(inscrits);
  const arrives = partants.filter((i) => i.arrivee != null).sort((a, b) => duree(a) - duree(b));

  const lArrives = arrives.map((i, k) => ligne(i, k + 1));
  const lDnf = dnf.map((i) => ligne(i));
  const lEnCours = enCours.map((i) => ligne(i));
  const individuel = [...lArrives, ...lDnf, ...lEnCours];

  const groupes = new Map();
  [...lArrives, ...lDnf].forEach((l) => {
    const cle = l.ecole.trim() || "(sans école)";
    if (!groupes.has(cle)) groupes.set(cle, []);
    groupes.get(cle).push(l);
  });

  const ecoles = [...groupes.entries()].map(([ecole, membres]) => {
    const finishers = membres.filter((l) => !l.dnf).sort((a, b) => a.ms - b.ms)
      .map((l, k) => ({ ...l, rangEcole: k + 1 }));
    const dnfs = membres.filter((l) => l.dnf).sort((a, b) => compareDossard(a.dossard, b.dossard));
    const somme = finishers.length >= 3 ? finishers[0].ms + finishers[1].ms + finishers[2].ms : null;
    return { ecole, participants: [...finishers, ...dnfs], nbFinishers: finishers.length, nbDnf: dnfs.length, somme, meilleur: finishers[0]?.ms ?? null };
  })
    .sort((a, b) => (a.somme ?? Infinity) - (b.somme ?? Infinity) || (a.meilleur ?? Infinity) - (b.meilleur ?? Infinity))
    .map((g, k) => ({ ...g, rang: k + 1, sommeTxt: g.somme != null ? fmtDuree(g.somme) : "-" }));

  const morceaux = [`${lArrives.length} classé(s) / ${lDnf.length} DNF / ${partants.length} partant(s)`];
  if (c?.date) morceaux.push(fmtDate(c.date));
  let info = morceaux.join("  |  ");
  if (c?.distance) info += ` — ${String(c.distance).replace(".", ",")} km`;

  return { individuel, ecoles, info, nbClasses: lArrives.length };
}

// ── Catégories automatiques ───────────────────────────────────
// La catégorie dépend de l'âge atteint dans l'année de fin de saison. Saison du 1er septembre au 31 août par
// défaut (une course d'octobre 2026 compte pour 2027) ; saison civile pour le triathlon (âge au 31 décembre
// de l'année de la course). Âges à vérifier chaque saison auprès de la fédération.
export const BAREMES = {
  libre: { nom: "Saisie libre" },
  ffa: {
    nom: "Automatique — FFA (athlétisme)",
    tranches: [
      [0, 6, "Baby Athlé"], [7, 9, "Éveil Athlé"], [10, 11, "Poussins"], [12, 13, "Benjamins"], [14, 15, "Minimes"],
      [16, 17, "Cadets"], [18, 19, "Juniors"], [20, 22, "Espoirs"], [23, 34, "Seniors"],
      [35, 39, "Masters M0"], [40, 44, "Masters M1"], [45, 49, "Masters M2"], [50, 54, "Masters M3"], [55, 59, "Masters M4"],
      [60, 64, "Masters M5"], [65, 69, "Masters M6"], [70, 74, "Masters M7"], [75, 79, "Masters M8"], [80, 84, "Masters M9"], [85, 150, "Masters M10"],
    ],
  },
  fftri: {
    nom: "Automatique — FFTri (triathlon)",
    civile: true,
    tranches: [
      [0, 7, "Mini-poussins"], [8, 9, "Poussins"], [10, 11, "Pupilles"], [12, 13, "Benjamins"], [14, 15, "Minimes"],
      [16, 17, "Cadets"], [18, 19, "Juniors"], [20, 24, "Seniors S1"], [25, 29, "Seniors S2"], [30, 34, "Seniors S3"], [35, 39, "Seniors S4"],
      [40, 44, "Masters M1"], [45, 49, "Masters M2"], [50, 54, "Masters M3"], [55, 59, "Masters M4"], [60, 64, "Masters M5"],
      [65, 69, "Masters M6"], [70, 74, "Masters M7"], [75, 79, "Masters M8"], [80, 84, "Masters M9"], [85, 150, "Masters M10"],
    ],
  },
  unss: {
    nom: "Automatique — UNSS (scolaire)",
    tranches: [[0, 13, "Benjamins"], [14, 15, "Minimes"], [16, 17, "Cadets"], [18, 19, "Juniors"], [20, 150, "Seniors"]],
  },
  // Classe « normale » pour l'âge (sans redoublement ni avance) : à corriger à la main au cas par cas
  classes: {
    nom: "Automatique — Classes (PS → Terminale)",
    tranches: [
      [0, 4, "PS"], [5, 5, "MS"], [6, 6, "GS"], [7, 7, "CP"], [8, 8, "CE1"], [9, 9, "CE2"], [10, 10, "CM1"], [11, 11, "CM2"],
      [12, 12, "6e"], [13, 13, "5e"], [14, 14, "4e"], [15, 15, "3e"], [16, 16, "2nde"], [17, 17, "1re"], [18, 18, "Terminale"],
    ],
  },
};

// Barèmes officiels publiés avec le site (baremes.json), chargés au démarrage : ils remplacent ceux
// ci-dessus, qui ne servent plus que de secours au tout premier lancement hors ligne.
let baremesOfficiels = null;
export function definirBaremesOfficiels(data) { baremesOfficiels = data; }
export const versionBaremes = () => baremesOfficiels?.version || null;

/** D'où vient le barème : « manuel » (modifié dans Administration), « officiel » (baremes.json) ou « integre ». */
export function sourceBareme(cle) {
  if (state.baremes?.[cle]) return "manuel";
  return baremesOfficiels?.baremes?.[cle] ? "officiel" : "integre";
}

/**
 * Barème effectif : la version modifiée à la main dans Administration (state.baremes) en priorité,
 * sinon la version officielle publiée, sinon celle intégrée au code.
 */
export function bareme(cle) {
  const base = BAREMES[cle];
  if (!base?.tranches) return base;
  const maj = state.baremes?.[cle] || baremesOfficiels?.baremes?.[cle];
  return maj ? { ...base, tranches: maj.tranches, civile: !!maj.civile } : base;
}

/** Barème sans la modification manuelle : ce que « Revenir au barème officiel » rétablit. */
export function baremeOfficiel(cle) {
  const base = BAREMES[cle];
  const off = baremesOfficiels?.baremes?.[cle];
  return off ? { ...base, tranches: off.tranches, civile: !!off.civile } : base;
}

/**
 * Année de référence de la saison : celle du 31 août qui suit la date de la course (ou d'aujourd'hui),
 * ou l'année de la course elle-même en saison civile.
 */
export function anneeSaison(dateIso, civile = false) {
  const d = dateIso ? new Date(dateIso + "T12:00:00") : new Date();
  return !civile && d.getMonth() >= 8 ? d.getFullYear() + 1 : d.getFullYear();
}

/** Libellé de la saison de la course, ex. « saison 2025-2026 » ou « saison 2026 ». */
export function libelleSaison(c) {
  const civile = !!bareme(c?.categories)?.civile;
  const ref = anneeSaison(c?.date, civile);
  return civile ? `saison ${ref}` : `saison ${ref - 1}-${ref}`;
}

/** Catégorie d'un participant pour la course, ou null si elle n'est pas calculable (saisie libre, année absente). */
export function categorieAuto(c, annee, sexe) {
  const b = bareme(c?.categories);
  if (!b?.tranches || !annee) return null;
  const age = anneeSaison(c.date, b.civile) - annee;
  const t = b.tranches.find(([de, a]) => age >= de && age <= a);
  if (!t) return null;
  return c.categoriesSexe && (sexe === "F" || sexe === "M") ? `${t[2]} ${sexe}` : t[2];
}

/** Années de naissance de chaque catégorie pour la saison de la course (aide affichée dans la fiche course). */
export function tableCategories(c) {
  const b = bareme(c?.categories);
  if (!b?.tranches) return [];
  const ref = anneeSaison(c.date, b.civile);
  return b.tranches.map(([de, a, nom]) => ({ nom, de: ref - a, a: ref - de, premiere: de === 0, derniere: a >= 150 }));
}

/**
 * Recalcule la catégorie des inscrits qui ont une année de naissance, sauf celles corrigées à la main ;
 * renvoie le nombre de catégories modifiées.
 */
export function appliquerCategories(courseId) {
  const c = course(courseId);
  let n = 0;
  inscritsDe(courseId).forEach((i) => {
    if (i.categorieManuelle) return;
    const cat = categorieAuto(c, i.annee, i.sexe);
    if (cat && cat !== i.categorie) { i.categorie = cat; n++; }
  });
  return n;
}

/**
 * Après une mise à jour d'un barème : recalcule les courses qui l'utilisent.
 * « seulementAVenir » laisse intactes les courses déjà parties ou terminées (mise à jour automatique).
 */
export function recalculerBareme(cle, seulementAVenir = false) {
  const courses = state.courses.filter((c) => c.categories === cle && (!seulementAVenir || etatChrono(c).etat === "attente"));
  return { courses: courses.length, modifiees: courses.reduce((n, c) => n + appliquerCategories(c.id), 0) };
}

// ── Attribution des dossards ──────────────────────────────────
// Seuls les bulletins complets encore sans dossard sont numérotés, triés par école puis par nom ;
// les dossards déjà donnés ne bougent jamais et leurs numéros sont sautés.
const fr = (a, b) => String(a || "").localeCompare(String(b || ""), "fr", { numeric: true });
const ordreNom = (a, b) => fr(a.ecole, b.ecole) || fr(a.nom, b.nom) || fr(a.prenom, b.prenom);

/** Numéros déjà pris dans la course (comparés en nombre : « 007 » occupe le 7). */
export function dossardsPris(courseId) {
  return new Set(inscritsDe(courseId).filter((i) => i.dossard && /^\d+$/.test(String(i.dossard).trim())).map((i) => Number(i.dossard)));
}

/** Nombre de numéros encore libres dans une plage (null si la plage n'a pas de fin). */
export function libresDansPlage(courseId, [de, a]) {
  if (a == null) return null;
  const pris = dossardsPris(courseId);
  let n = 0;
  for (let k = de; k <= a; k++) if (!pris.has(k)) n++;
  return n;
}

/**
 * Calcule l'attribution sans rien modifier (pour l'aperçu), du numéro « debut » jusqu'à « fin » au plus.
 * @returns {{attributions: {inscrit: object, numero: number}[], manque: number}} manque > 0 : plage trop petite
 */
export function proposerDossards(courseId, debut, fin = null) {
  const pris = dossardsPris(courseId);
  const aNumeroter = inscritsDe(courseId).filter((i) => i.bulletin && !i.dossard).sort(ordreNom);
  const attributions = [];
  let n = debut;
  for (const i of aNumeroter) {
    while (pris.has(n)) n++;
    if (fin != null && n > fin) return { attributions: [], manque: aNumeroter.length - attributions.length };
    pris.add(n);
    attributions.push({ inscrit: i, numero: n });
  }
  return { attributions, manque: 0 };
}

export function nbInscrits(courseId) { return state.inscrits.filter((i) => i.courseId === courseId).length; }
