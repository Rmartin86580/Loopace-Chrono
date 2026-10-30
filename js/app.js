// Loopace Chrono — interface : onglets Courses, Chronomètre, Résultats, Archives, Administration.

import * as store from "./store.js?v=18";
import { state, uid, course, inscritsDe, theme, coursesTriees, THEME_DEFAUT_ID } from "./store.js?v=18";
import * as calc from "./calc.js?v=18";
import { fmtDuree, fmtHeure, fmtDate, nomComplet, compareDossard } from "./calc.js?v=18";
import * as excel from "./excel.js?v=18";
import { genererPdf, nomFichier, COLONNES_PDF, COLONNES_DEFAUT, SECTIONS_PDF, sectionsDe } from "./pdf.js?v=18";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** Pour comparer des noms : sans accents, majuscules, espaces ni tirets superflus. */
const normaliser = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s'-]+/g, " ").trim();
const CLE_COURSE_CHRONO = "loopace-chrono-course";

// ── Petits outils d'interface ────────────────────────────────
function toast(message, type = "ok") {
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.textContent = message;
  $("#toasts").append(el);
  setTimeout(() => el.classList.add("is-out"), 3800);
  setTimeout(() => el.remove(), 4300);
}

function confirmer(titre, texte, { oui = "Confirmer", danger = false } = {}) {
  const dlg = $("#dlgConfirm");
  $("#confirmTitre").textContent = titre;
  $("#confirmTexte").textContent = texte;
  $("#confirmOui").textContent = oui;
  $("#confirmOui").classList.toggle("btn--stop", danger);
  return ouvrirDialogue(dlg).then((v) => v === "oui");
}

/**
 * Ouvre un dialogue de formulaire et renvoie la valeur du bouton : celle du bouton d'envoi (ok, oui),
 * d'un bouton [data-valeur] (annuler, supprimer…) ou « annuler » sur Échap.
 * Seul le bouton principal est de type submit : Entrée valide donc le formulaire.
 */
function ouvrirDialogue(dlg) {
  const form = dlg.querySelector("form");
  dlg.showModal();
  return new Promise((resolve) => {
    const fin = (valeur) => {
      form.removeEventListener("submit", onSubmit);
      dlg.removeEventListener("click", onClick);
      dlg.removeEventListener("cancel", onCancel);
      if (dlg.open) dlg.close();
      resolve(valeur);
    };
    const onSubmit = (e) => { e.preventDefault(); fin(e.submitter?.value || "ok"); };
    const onClick = (e) => { const b = e.target.closest("[data-valeur]"); if (b) fin(b.dataset.valeur); };
    const onCancel = (e) => { e.preventDefault(); fin("annuler"); };
    form.addEventListener("submit", onSubmit);
    dlg.addEventListener("click", onClick);
    dlg.addEventListener("cancel", onCancel);
  });
}

function telecharger(blob, nom) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: nom });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function optionsCourses(select, idChoisi, { vide = "— Choisir une course —" } = {}) {
  const liste = coursesTriees();
  select.innerHTML = `<option value="">${vide}</option>` + liste.map((c) =>
    `<option value="${c.id}"${c.id === idChoisi ? " selected" : ""}>${esc(c.nom)}${c.date ? " — " + fmtDate(c.date) : ""}</option>`).join("");
}

const ETATS = { "attente": "En attente", "en-cours": "En course", "arretee": "Terminée" };

// ── Navigation ───────────────────────────────────────────────
const VUES = ["courses", "chrono", "resultats", "archives", "admin"];
let vue = "courses";

function naviguer() {
  const v = location.hash.slice(1);
  vue = VUES.includes(v) ? v : "courses";
  VUES.forEach((n) => { $(`#view-${n}`).hidden = n !== vue; });
  $$(".tabs a").forEach((a) => a.classList.toggle("is-on", a.dataset.tab === vue));
  rendre();
}

function rendre() {
  ({ courses: rendreCourses, chrono: rendreChrono, resultats: rendreResultats, archives: rendreArchives, admin: rendreAdmin })[vue]();
  $("#liveDot").hidden = !state.courses.some((c) => calc.etatChrono(c).etat === "en-cours");
}

// ══════════════════════════════════════════════════════════════
// COURSES / PARTICIPANTS
// ══════════════════════════════════════════════════════════════
let courseSel = null;
let recherche = "";
// Filtres et tri de la liste des participants (remis à zéro quand on change de course)
let filtres = { statut: "", ecole: "", club: "", categorie: "" };
let tri = null; // { col, sens } ; null = école, nom, prénom
const SANS = "\u0000sans"; // valeur des options « (sans école) », « (sans catégorie) »

const FILTRES_STATUT = {
  incomplet: (i) => !i.bulletin,
  complet: (i) => i.bulletin,
  sansDossard: (i) => !i.dossard,
  aNumeroter: (i) => i.bulletin && !i.dossard,
};

function comparerParticipants(a, b) {
  const fr = (x, y) => String(x || "").localeCompare(String(y || ""), "fr", { numeric: true });
  if (!tri) return fr(a.ecole, b.ecole) || fr(a.nom, b.nom) || fr(a.prenom, b.prenom);
  const v = { dossard: () => compareDossard(a.dossard, b.dossard), annee: () => (a.annee || 0) - (b.annee || 0), bulletin: () => (a.bulletin - b.bulletin) }[tri.col]?.()
    ?? fr(a[tri.col], b[tri.col]);
  return (v || fr(a.nom, b.nom) || fr(a.prenom, b.prenom)) * (tri.sens === "desc" ? -1 : 1);
}

function optionsFiltre(select, valeurs, tous, sans, choisi) {
  const liste = [...new Set(valeurs.filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
  if (choisi && choisi !== SANS && !liste.includes(choisi)) liste.push(choisi);
  select.innerHTML = `<option value="">${tous}</option>` + liste.map((v) => `<option value="${esc(v)}"${v === choisi ? " selected" : ""}>${esc(v)}</option>`).join("") +
    (valeurs.some((v) => !v) ? `<option value="${SANS}"${choisi === SANS ? " selected" : ""}>${sans}</option>` : "");
  select.classList.toggle("is-actif", !!choisi);
}

function reinitialiserFiltres() {
  recherche = "";
  $("#rechercheParticipant").value = "";
  filtres = { statut: "", ecole: "", club: "", categorie: "" };
  tri = null;
}

function rendreCourses() {
  if (courseSel && !course(courseSel)) courseSel = null;
  const liste = coursesTriees();
  $("#listeCourses").innerHTML = liste.length ? liste.map((c) => {
    const etat = calc.etatChrono(c).etat;
    const meta = [fmtDate(c.date), c.heure, c.lieu].filter(Boolean).join(" · ");
    return `<li><button class="course-item${c.id === courseSel ? " is-on" : ""}" data-id="${c.id}">
      <span class="course-item__name">${esc(c.nom)}</span>
      <span class="course-item__meta">${esc(meta) || "&nbsp;"}</span>
      <span class="course-item__foot"><span>${calc.nbInscrits(c.id)} inscrit(s)</span><span class="chip chip--${etat}">${ETATS[etat]}</span></span>
    </button></li>`;
  }).join("") : `<li class="muted-li">Aucune course pour l'instant.</li>`;

  const c = course(courseSel);
  $("#videCourse").hidden = !!c;
  $("#detailCourse").hidden = !c;
  if (!c) return;

  $("#titreCourse").textContent = c.nom;
  const th = theme(c.themeId);
  $("#metaCourse").textContent = [fmtDate(c.date), c.heure && `départ ${c.heure}`, c.lieu, c.distance && `${String(c.distance).replace(".", ",")} km`, c.type, c.plageDossards && `dossards ${plageTexte(c.plageDossards)}`, th && `modèle « ${th.nom} »`].filter(Boolean).join(" · ");

  const tous = inscritsDe(c.id).sort(comparerParticipants);
  const eq = calc.equipesDe(c, tous);
  marquerEquipes($("#enteteParticipants").closest("table"), eq);
  if (!eq.ecole) filtres.ecole = "";
  if (!eq.club) filtres.club = "";

  $("#filtreStatut").value = filtres.statut;
  $("#filtreStatut").classList.toggle("is-actif", !!filtres.statut);
  optionsFiltre($("#filtreEcole"), tous.map((i) => i.ecole), "Toutes les écoles", "(sans école)", filtres.ecole);
  optionsFiltre($("#filtreClub"), tous.map((i) => i.club), "Tous les clubs", "(sans club)", filtres.club);
  $("#filtreEcole").hidden = !eq.ecole;
  $("#filtreClub").hidden = !eq.club || (!tous.some((i) => i.club) && !filtres.club); // inutile tant que personne n'a de club
  optionsFiltre($("#filtreCategorie"), tous.map((i) => i.categorie), "Toutes les catégories", "(sans catégorie)", filtres.categorie);
  const egal = (val, choisi) => !choisi || (choisi === SANS ? !val : val === choisi);
  const q = recherche.trim().toLowerCase();
  const vus = tous.filter((i) =>
    (!filtres.statut || FILTRES_STATUT[filtres.statut](i)) && egal(i.ecole, filtres.ecole) && egal(i.club, filtres.club) && egal(i.categorie, filtres.categorie) &&
    (!q || [i.dossard, i.nom, i.prenom, i.ecole, i.club, i.licence, i.categorie].some((v) => String(v ?? "").toLowerCase().includes(q))));
  const filtre = q || filtres.statut || filtres.ecole || filtres.club || filtres.categorie;
  $("#btnEffacerFiltres").hidden = !filtre;
  $$("#enteteParticipants th").forEach((th) => {
    if (tri && th.dataset.tri === tri.col) th.setAttribute("aria-sort", tri.sens === "desc" ? "descending" : "ascending");
    else th.removeAttribute("aria-sort");
  });

  const nbBulletins = tous.filter((i) => i.bulletin).length;
  $("#statsParticipants").textContent = `${tous.length} inscrit(s) · ${nbBulletins} bulletin(s) complet(s)` + (filtre ? ` · ${vus.length} affiché(s)` : "");
  $("#tableParticipants").innerHTML = vus.length ? vus.map((i) => `<tr data-id="${i.id}">
      <td><b>${esc(i.dossard) || '<span class="muted">—</span>'}</b></td><td>${esc(i.nom)}</td><td>${esc(i.prenom)}</td><td>${esc(i.sexe)}</td>
      <td>${esc(i.annee)}</td><td class="col-ecole">${esc(i.ecole)}</td><td class="col-club">${esc(i.club)}</td><td>${esc(i.licence)}</td><td>${esc(i.categorie)}</td><td>${esc(i.telephone)}</td>
      <td class="c"><input type="checkbox" class="toggle-bulletin" aria-label="Bulletin complet" ${i.bulletin ? "checked" : ""}></td></tr>`).join("")
    : `<tr><td colspan="11" class="muted c">${tous.length ? "Aucun participant ne correspond à ces filtres." : "Aucun participant : ajoutez-en ou importez un fichier Excel."}</td></tr>`;

  const vide = tous.length === 0;
  $("#btnDossards").disabled = vide;
}

$("#listeCourses").addEventListener("click", (e) => {
  const b = e.target.closest(".course-item");
  if (!b) return;
  if (b.dataset.id !== courseSel) reinitialiserFiltres();
  courseSel = b.dataset.id;
  rendreCourses();
});

$("#rechercheParticipant").addEventListener("input", (e) => { recherche = e.target.value; rendreCourses(); });
$("#filtreStatut").addEventListener("change", (e) => { filtres.statut = e.target.value; rendreCourses(); });
$("#filtreEcole").addEventListener("change", (e) => { filtres.ecole = e.target.value; rendreCourses(); });
$("#filtreClub").addEventListener("change", (e) => { filtres.club = e.target.value; rendreCourses(); });
$("#filtreCategorie").addEventListener("change", (e) => { filtres.categorie = e.target.value; rendreCourses(); });
$("#btnEffacerFiltres").addEventListener("click", () => { const t = tri; reinitialiserFiltres(); tri = t; rendreCourses(); });
// Clic sur une colonne : tri croissant, puis décroissant, puis retour à l'ordre par école
$("#enteteParticipants").addEventListener("click", (e) => {
  const col = e.target.closest("th[data-tri]")?.dataset.tri;
  if (!col) return;
  tri = tri?.col !== col ? { col, sens: "asc" } : tri.sens === "asc" ? { col, sens: "desc" } : null;
  rendreCourses();
});

function optionsThemes(select, idChoisi) {
  const themes = [...state.themes].sort((a, b) => (b.defaut - a.defaut) || a.nom.localeCompare(b.nom, "fr"));
  select.innerHTML = `<option value="">Aucun (mise en page par défaut)</option>` +
    themes.map((t) => `<option value="${t.id}"${t.id === idChoisi ? " selected" : ""}>${esc(t.nom)}</option>`).join("");
}

/** Plage de dossards de la course : [premier, dernier] (dernier null = sans limite), ou null si non définie. */
function lirePlage(de, a) {
  const d = parseInt(de, 10), f = parseInt(a, 10);
  if (!Number.isInteger(d) || d < 0) return null;
  if (!Number.isInteger(f)) return [d, null];
  return f < d ? [f, d] : [d, f];
}
const plageTexte = ([de, a]) => (a == null ? `à partir de ${de}` : `${de} à ${a}`);

async function editerCourse(c) {
  const f = $("#formCourse");
  $("#dlgCourseTitre").textContent = c ? "Modifier la course" : "Nouvelle course";
  f.nom.value = c?.nom || "";
  f.date.value = c ? c.date || "" : new Date().toISOString().slice(0, 10);
  f.heure.value = c?.heure || "";
  f.lieu.value = c?.lieu || "";
  f.distance.value = c?.distance != null ? String(c.distance).replace(".", ",") : "";
  f.dossardsDe.value = c?.plageDossards?.[0] ?? "";
  f.dossardsA.value = c?.plageDossards?.[1] ?? "";
  f.type.value = c?.type || "";
  optionsThemes($("#selectTheme"), c ? c.themeId : THEME_DEFAUT_ID);
  // Nouvelle course : catégories FFA par défaut ; course existante : son réglage (saisie libre si jamais réglé)
  const bareme = c ? c.categories || "libre" : "ffa";
  $("#selectBareme").innerHTML = Object.entries(calc.BAREMES).map(([cle, b]) => `<option value="${cle}"${cle === bareme ? " selected" : ""}>${b.nom}</option>`).join("");
  f.categoriesSexe.checked = !!c?.categoriesSexe;
  f.equipes.value = c ? calc.equipesDe(c, inscritsDe(c.id)).choix : "ecole";
  aideCategories();

  if (await ouvrirDialogue($("#dlgCourse")) !== "ok") return;
  const nom = f.nom.value.trim();
  if (!nom) return;
  const distance = parseFloat(f.distance.value.replace(",", "."));
  const valeurs = {
    nom, date: f.date.value || null, heure: f.heure.value || null, lieu: f.lieu.value.trim(),
    distance: Number.isFinite(distance) ? distance : null, type: f.type.value.trim(), themeId: f.themeId.value || null,
    plageDossards: lirePlage(f.dossardsDe.value, f.dossardsA.value),
    categories: f.categories.value, categoriesSexe: f.categoriesSexe.checked, equipes: f.equipes.value,
  };
  let cible = c;
  if (c) Object.assign(c, valeurs);
  else {
    cible = { id: uid(), ...valeurs, chrono: { etat: "attente", depart: null, fin: null } };
    state.courses.push(cible);
    courseSel = cible.id;
    reinitialiserFiltres();
  }
  // Barème, date (saison) ou séparation F/M ont pu changer : on remet les catégories à jour
  const recalculees = calc.appliquerCategories(cible.id);
  await store.sauver();
  rendre();
  toast((c ? "Course modifiée." : "Course créée.") + (recalculees ? ` ${recalculees} catégorie(s) recalculée(s).` : ""));
}

/** Rappel des années de naissance de chaque catégorie, pour la saison de la date saisie. */
function aideCategories() {
  const f = $("#formCourse");
  const brouillon = { categories: f.categories.value, date: f.date.value || null };
  const lignes = calc.tableCategories(brouillon);
  $("#champCategoriesSexe").hidden = !lignes.length;
  $("#aideCategories").hidden = !lignes.length;
  if (!lignes.length) return;
  $("#aideCategories summary").textContent = `Années de naissance — ${calc.libelleSaison(brouillon)}`;
  $("#aideCategories ul").innerHTML = lignes.map((l) => `<li>${esc(l.nom)}<span>${l.derniere ? `${l.a} et avant` : l.premiere ? `${l.de} et après` : l.de === l.a ? l.de : `${l.de}–${l.a}`}</span></li>`).join("");
}
$("#formCourse").addEventListener("input", (e) => { if (e.target.name === "categories" || e.target.name === "date") aideCategories(); });
$("#formCourse").addEventListener("change", (e) => { if (e.target.name === "categories" || e.target.name === "date") aideCategories(); });

$("#btnNouvelleCourse").addEventListener("click", () => editerCourse(null));
$("#btnModifierCourse").addEventListener("click", () => editerCourse(course(courseSel)));

async function supprimerCourse(id) {
  state.courses = state.courses.filter((c) => c.id !== id);
  state.inscrits = state.inscrits.filter((i) => i.courseId !== id);
  if (chronoSel === id) chronoSel = null;
  if (resultatsSel === id) resultatsSel = null;
  await store.sauver();
}

$("#btnSupprimerCourse").addEventListener("click", async () => {
  const c = course(courseSel);
  if (!c) return;
  const enCours = calc.etatChrono(c).etat === "en-cours";
  const ok = await confirmer("Supprimer la course", `Supprimer « ${c.nom} », ses ${calc.nbInscrits(c.id)} participant(s) et tous ses temps ?` + (enCours ? "\n\nAttention : le chronomètre de cette course tourne." : ""), { oui: "Supprimer", danger: true });
  if (!ok) return;
  await supprimerCourse(c.id);
  courseSel = null;
  rendre();
  toast("Course supprimée.");
});

// ── Dupliquer une course : autre course du même cross, ou édition suivante ───
$("#btnDupliquerCourse").addEventListener("click", () => {
  const c = course(courseSel);
  if (c) dupliquer(c, inscritsDe(c.id));
});

/** Copie une course et, au choix, ses participants : depuis la liste des courses ou depuis une archive. */
async function dupliquer(c, inscrits) {
  const f = $("#formDupliquer");
  const nb = inscrits.length;
  f.nom.value = `${c.nom} (copie)`;
  f.date.value = c.date || "";
  f.heure.value = c.heure || "";
  f.participants.checked = nb > 0;
  f.participants.disabled = nb === 0;
  f.dossards.checked = true;
  f.bulletins.checked = false;
  $("#dupliquerNb").textContent = `${nb} inscrit(s)`;
  const options = () => $("#dupliquerOptions").setAttribute("aria-disabled", String(!f.participants.checked));
  options();
  f.participants.onchange = options;
  f.nom.select();

  if (await ouvrirDialogue($("#dlgDupliquer")) !== "ok" || !f.nom.value.trim()) return;
  const copie = {
    ...structuredClone(c), id: uid(), nom: f.nom.value.trim(), date: f.date.value || null, heure: f.heure.value || null,
    chrono: { etat: "attente", depart: null, fin: null },
  };
  if (copie.themeId && !theme(copie.themeId)) copie.themeId = null; // thème supprimé depuis l'archivage
  state.courses.push(copie);
  let n = 0;
  if (f.participants.checked) {
    inscrits.forEach((i) => {
      state.inscrits.push({
        ...structuredClone(i), id: uid(), courseId: copie.id,
        dossard: f.dossards.checked ? i.dossard : null,
        bulletin: f.bulletins.checked ? i.bulletin : false,
        depart: null, arrivee: null, statut: null,
      });
      n++;
    });
  }
  // La date a pu changer de saison : catégories automatiques remises à jour (corrections manuelles gardées)
  const recalculees = calc.appliquerCategories(copie.id);
  courseSel = copie.id;
  reinitialiserFiltres();
  await store.sauver();
  if (vue !== "courses") location.hash = "#courses"; else rendre();
  toast(`Course « ${copie.nom} » créée` + (n ? ` avec ${n} participant(s)` : "") + "." + (recalculees ? ` ${recalculees} catégorie(s) recalculée(s).` : ""));
}

// ── Participants ─────────────────────────────────────────────
function dossardPris(courseId, dossard, saufId) {
  return inscritsDe(courseId).some((i) => i.id !== saufId && i.dossard && dossard && String(i.dossard).trim() === dossard);
}

function remplirListes(courseId) {
  const uniques = (cle) => [...new Set(state.inscrits.map((i) => i[cle]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  $("#listeEcoles").innerHTML = uniques("ecole").map((v) => `<option value="${esc(v)}">`).join("");
  $("#listeClubs").innerHTML = uniques("club").map((v) => `<option value="${esc(v)}">`).join("");
  $("#listeCategories").innerHTML = uniques("categorie").map((v) => `<option value="${esc(v)}">`).join("");
}

async function editerParticipant(i) {
  const c = course(courseSel);
  if (!c) return;
  const f = $("#formParticipant");
  marquerEquipes(f, calc.equipesDe(c, inscritsDe(c.id)));
  $("#dlgParticipantTitre").textContent = i ? `${nomComplet(i)}` : "Nouveau participant";
  $("#btnDesinscrire").hidden = !i;
  $("#erreurParticipant").textContent = "";
  remplirListes(c.id);
  f.dossard.value = i?.dossard || "";
  f.nom.value = i?.nom || "";
  f.prenom.value = i?.prenom || "";
  f.annee.value = i?.annee || "";
  f.sexe.value = i?.sexe === "M" ? "M" : "F";
  f.ecole.value = i?.ecole || "";
  f.club.value = i?.club || "";
  f.categorie.value = i?.categorie || "";
  f.telephone.value = i?.telephone || "";
  f.licence.value = i?.licence || "";
  f.bulletin.checked = !!i?.bulletin;
  f.categorie.dataset.manuel = i?.categorieManuelle ? "1" : "";
  categorieParticipant();

  for (;;) {
    const r = await ouvrirDialogue($("#dlgParticipant"));
    if (r === "supprimer" && i) {
      if (!await confirmer("Désinscrire", `Désinscrire ${nomComplet(i)} de cette course ?`, { oui: "Désinscrire", danger: true })) return;
      state.inscrits = state.inscrits.filter((x) => x.id !== i.id);
      await store.sauver();
      rendre();
      toast("Participant désinscrit.");
      return;
    }
    if (r !== "ok") return;

    const dossard = f.dossard.value.trim() || null;
    if (dossard && dossardPris(c.id, dossard, i?.id)) {
      $("#erreurParticipant").textContent = `Le dossard « ${dossard} » est déjà attribué dans cette course.`;
      continue; // on rouvre le formulaire, saisie conservée
    }
    const annee = parseInt(f.annee.value, 10);
    const valeurs = {
      dossard, nom: f.nom.value.trim(), prenom: f.prenom.value.trim(), annee: Number.isFinite(annee) ? annee : null,
      sexe: f.sexe.value, ecole: f.ecole.value.trim(), club: f.club.value.trim(), categorie: f.categorie.value.trim(), telephone: f.telephone.value.trim(), licence: f.licence.value.trim(), bulletin: f.bulletin.checked,
    };
    // Champ vidé : on reprend la catégorie calculée ; valeur différente du calcul : correction manuelle conservée
    const auto = calc.categorieAuto(c, valeurs.annee, valeurs.sexe);
    if (!valeurs.categorie) valeurs.categorie = auto || "";
    valeurs.categorieManuelle = !!auto && valeurs.categorie !== auto;
    if (i) Object.assign(i, valeurs);
    else state.inscrits.push({ id: uid(), courseId: c.id, ...valeurs, depart: null, arrivee: null, statut: null });
    await store.sauver();
    rendre();
    toast(i ? "Participant modifié." : "Participant ajouté.");
    return;
  }
}

/**
 * Course en catégories automatiques : la catégorie suit l'année de naissance et le sexe saisis,
 * sauf si on l'a corrigée à la main (redoublement, avance…). Vider le champ revient au calcul.
 */
function categorieParticipant() {
  const f = $("#formParticipant");
  const c = course(courseSel);
  const bareme = calc.BAREMES[c?.categories]?.tranches;
  const cat = calc.categorieAuto(c, parseInt(f.annee.value, 10), f.sexe.value);
  const manuel = f.categorie.dataset.manuel === "1" && f.categorie.value.trim() && f.categorie.value.trim() !== cat;
  if (cat && !manuel) f.categorie.value = cat;
  $("#indiceCategorie").textContent = !bareme ? "" : manuel ? "· corrigée à la main (videz pour recalculer)"
    : cat ? "· automatique, modifiable" : "· saisissez l'année pour la calculer";
}
$("#formParticipant").addEventListener("input", (e) => {
  if (e.target.name === "categorie") { e.target.dataset.manuel = e.target.value.trim() ? "1" : ""; categorieParticipant(); }
  if (e.target.name === "annee" || e.target.name === "sexe") categorieParticipant();
});
$("#formParticipant").addEventListener("change", (e) => { if (e.target.name === "sexe") categorieParticipant(); });

$("#btnNouveauParticipant").addEventListener("click", () => editerParticipant(null));

$("#tableParticipants").addEventListener("click", async (e) => {
  const tr = e.target.closest("tr[data-id]");
  if (!tr) return;
  const i = state.inscrits.find((x) => x.id === tr.dataset.id);
  if (!i) return;
  if (e.target.classList.contains("toggle-bulletin")) {
    i.bulletin = e.target.checked;
    await store.sauver();
    rendreCourses();
    return;
  }
  editerParticipant(i);
});

// Bouton « Excel » : une fenêtre en deux, importer à gauche, exporter à droite
$("#btnExcel").addEventListener("click", () => {
  const c = course(courseSel);
  if (!c) return;
  const nb = calc.nbInscrits(c.id);
  $("#dlgExcelTitre").textContent = `Excel — ${c.nom}`;
  $("#excelExportTexte").textContent = nb
    ? `Télécharge la liste des ${nb} participant(s) de la course : dossard, nom, prénom, sexe, année, école, club, licence, catégorie, téléphone, bulletin.`
    : "Aucun participant à exporter pour l'instant.";
  $("#btnExporterParticipants").disabled = !nb;
  $("#dlgExcel").showModal();
});
$("#btnFermerExcel").addEventListener("click", () => $("#dlgExcel").close());
$("#btnModeleExcel").addEventListener("click", () => {
  try { excel.telechargerModele(); } catch (err) { toast(err.message, "err"); }
});
$("#btnImporter").addEventListener("click", () => {
  $("#dlgExcel").close();
  $("#fichierImport").click();
});
$("#fichierImport").addEventListener("change", async (e) => {
  const fichier = e.target.files[0];
  e.target.value = "";
  const c = course(courseSel);
  if (!fichier || !c) return;

  let lignes;
  try { lignes = await excel.lireParticipants(fichier); }
  catch (err) { toast(`Impossible de lire le fichier : ${err.message}`, "err"); return; }
  if (!lignes.length) { toast("Aucune ligne trouvée dans le fichier.", "warn"); return; }

  // Doublons : une personne déjà inscrite (même nom et prénom, même année si les deux sont connues)
  // est complétée au lieu d'être recréée ; réimporter un fichier corrigé ne crée donc pas de doublons.
  const cle = (nom, prenom) => `${normaliser(nom)}|${normaliser(prenom)}`;
  const memePersonne = (i, l) => cle(i.nom, i.prenom) === cle(l.nom, l.prenom) && (!i.annee || !l.annee || i.annee === l.annee);
  let importes = 0, majs = 0, ignores = 0;
  const erreurs = [];
  lignes.forEach((l) => {
    // Nom, sexe et année de naissance obligatoires : une ligne incomplète est ignorée et signalée
    const qui = [l.prenom, l.nom].filter(Boolean).join(" ") || "sans nom";
    const manque = [
      !l.nom && "nom manquant",
      !l.sexe && (l.sexeLu ? `sexe « ${l.sexeLu} » non reconnu (F ou M)` : "sexe manquant"),
      !l.annee && (l.anneeLue ? `année « ${l.anneeLue} » invalide` : "année de naissance manquante"),
    ].filter(Boolean);
    if (manque.length) {
      erreurs.push(`Ligne ${l.ligne} (${qui}) : ${manque.join(", ")} — ignorée`);
      ignores++;
      return;
    }
    const dossard = l.dossard || null;
    const existant = inscritsDe(c.id).find((i) => memePersonne(i, l));
    if (existant) {
      // On ne remplit que ce que le fichier apporte ; un bulletin complet ne redevient pas incomplet
      if (l.prenom && !existant.prenom) existant.prenom = l.prenom;
      existant.sexe = l.sexe;
      existant.annee = l.annee;
      if (l.ecole) existant.ecole = l.ecole;
      if (l.club) existant.club = l.club;
      if (l.telephone) existant.telephone = l.telephone;
      if (l.licence) existant.licence = l.licence;
      if (l.bulletin) existant.bulletin = true;
      if (dossard && dossard !== String(existant.dossard ?? "")) {
        if (existant.dossard) erreurs.push(`${l.prenom} ${l.nom} : garde son dossard ${existant.dossard} (le fichier indique ${dossard})`);
        else if (dossardPris(c.id, dossard, existant.id)) erreurs.push(`${l.prenom} ${l.nom} : dossard ${dossard} déjà attribué à un autre participant`);
        else existant.dossard = dossard;
      }
      if (!existant.categorieManuelle) existant.categorie = calc.categorieAuto(c, existant.annee, existant.sexe) || l.categorie || existant.categorie;
      majs++;
      return;
    }
    if (dossard && dossardPris(c.id, dossard)) {
      erreurs.push(`Dossard ${dossard} (${l.prenom} ${l.nom}) déjà attribué : ligne ignorée`);
      ignores++;
      return;
    }
    state.inscrits.push({
      id: uid(), courseId: c.id, dossard, nom: l.nom, prenom: l.prenom, sexe: l.sexe, annee: l.annee,
      ecole: l.ecole, club: l.club, categorie: calc.categorieAuto(c, l.annee, l.sexe) || l.categorie, telephone: l.telephone, licence: l.licence, bulletin: l.bulletin,
      depart: null, arrivee: null, statut: null,
    });
    importes++;
  });
  await store.sauver();
  rendre();
  let msg = `${importes} participant(s) importé(s).`;
  if (majs) msg += ` ${majs} déjà inscrit(s), mis à jour.`;
  if (ignores) msg += ` ${ignores} ligne(s) ignorée(s).`;
  toast(msg, erreurs.length ? "warn" : "ok");
  if (erreurs.length) await confirmer("À vérifier après l'import", erreurs.join("\n"), { oui: "OK" });
});

$("#btnExporterParticipants").addEventListener("click", () => {
  const c = course(courseSel);
  if (!c) return;
  $("#dlgExcel").close();
  const liste = inscritsDe(c.id).sort((a, b) => compareDossard(a.dossard, b.dossard));
  try { excel.exporterParticipants(nomFichier("Participants_", c.nom, "xlsx"), liste); }
  catch (err) { toast(err.message, "err"); }
});

// Attribution en deux temps : réglages (plage de la course, ou premier numéro forcé), puis aperçu
let dossards = null; // { course, plage, aNumeroter, proposition }

$("#btnDossards").addEventListener("click", () => {
  const c = course(courseSel);
  if (!c) return;
  const tous = inscritsDe(c.id);
  const nb = tous.filter((i) => i.bulletin && !i.dossard).length;
  if (!nb) {
    toast(tous.some((i) => i.bulletin) ? "Tous les bulletins complets ont déjà un dossard." : "Aucun bulletin complet : aucun dossard à attribuer.", "warn");
    return;
  }
  const pris = calc.dossardsPris(c.id);
  dossards = { course: c, plage: c.plageDossards || null, aNumeroter: nb, proposition: null };
  const plage = dossards.plage;
  $("#dossardsResume").textContent = `${nb} participant(s) au bulletin complet à numéroter` +
    (pris.size ? ` · ${tous.filter((i) => i.dossard).length} dossard(s) déjà donné(s) : ils ne changent pas et leurs numéros sont sautés.` : ".");
  if (plage) {
    const libres = calc.libresDansPlage(c.id, plage);
    $("#dossardsPlageInfo").textContent = `Plage de dossards de la course : ${plageTexte(plage)}` +
      (libres != null ? ` · ${libres} numéro(s) libre(s) pour ${nb} participant(s).` : ".");
  } else {
    $("#dossardsPlageInfo").textContent = "Pas de plage de dossards pour cette course : elle se règle dans la fiche course (bouton « Modifier »).";
  }
  $("#dossardsForcerLigne").hidden = !plage;
  $("#dossardsForcer").checked = false;
  $("#dossardsDebut").value = pris.size ? Math.max(...pris) + 1 : 1;
  rendreForcer();
  etapeDossards(1);
  $("#dlgDossards").showModal();
});

/** Avec une plage, le premier numéro n'est demandé que si on force ; sans plage, il l'est toujours. */
function rendreForcer() {
  $("#dossardsDebutLigne").hidden = !!dossards.plage && !$("#dossardsForcer").checked;
}
$("#dossardsForcer").addEventListener("change", () => { rendreForcer(); $("#dossardsErreur").textContent = ""; });

function etapeDossards(n) {
  $("#dossardsReglages").hidden = n !== 1;
  $("#dossardsApercu").hidden = n !== 2;
  $("#btnDossardsApercu").hidden = n !== 1;
  $("#btnDossardsValider").hidden = n !== 2;
  $("#btnDossardsRetour").hidden = n !== 2;
  $("#dossardsErreur").textContent = "";
}

$("#btnDossardsApercu").addEventListener("click", () => {
  const { course: c, plage } = dossards;
  const force = !plage || $("#dossardsForcer").checked;
  const debut = force ? parseInt($("#dossardsDebut").value, 10) : plage[0];
  if (!Number.isInteger(debut) || debut < 0) { $("#dossardsErreur").textContent = "Indiquez un premier numéro valide."; return; }
  const r = calc.proposerDossards(c.id, debut, force ? null : plage[1]);
  if (r.manque) {
    $("#dossardsErreur").textContent = `La plage ${plageTexte(plage)} est trop petite : il manque ${r.manque} numéro(s). ` +
      "Agrandissez-la dans la fiche course, ou cochez « Forcer un autre premier numéro ».";
    return;
  }
  dossards.proposition = r.attributions;
  $("#tableApercu").innerHTML = r.attributions.map(({ inscrit: i, numero }) =>
    `<tr><td><b>${numero}</b></td><td>${esc(i.nom)}</td><td>${esc(i.prenom)}</td><td>${esc(i.ecole)}</td><td>${esc(i.categorie)}</td></tr>`).join("");
  const nums = r.attributions.map((l) => l.numero);
  $("#dossardsResume").textContent = `Aperçu : ${nums.length} dossard(s), de ${nums[0]} à ${nums[nums.length - 1]}` +
    (force && plage ? " (premier numéro forcé, hors plage de la course)" : "") + ". Rien n'est encore enregistré.";
  etapeDossards(2);
});

$("#btnDossardsRetour").addEventListener("click", () => etapeDossards(1));
$("#btnDossardsAnnuler").addEventListener("click", () => $("#dlgDossards").close());

$("#btnDossardsValider").addEventListener("click", async () => {
  const { proposition } = dossards;
  proposition.forEach(({ inscrit: i, numero }) => { i.dossard = String(numero); });
  await store.sauver();
  $("#dlgDossards").close();
  rendre();
  const nums = proposition.map((p) => p.numero).sort((a, b) => a - b);
  toast(`${nums.length} dossard(s) attribué(s), de ${nums[0]} à ${nums[nums.length - 1]}. Les dossards existants n'ont pas changé.`);
});

// ══════════════════════════════════════════════════════════════
// CHRONOMÈTRE
// ══════════════════════════════════════════════════════════════
let chronoSel = null;
try { chronoSel = localStorage.getItem(CLE_COURSE_CHRONO); } catch { /* stockage indisponible */ }
let fenetreEcran = null;

function choisirCourseChrono(id) {
  chronoSel = id || null;
  try { chronoSel ? localStorage.setItem(CLE_COURSE_CHRONO, chronoSel) : localStorage.removeItem(CLE_COURSE_CHRONO); } catch { /* idem */ }
  store.prevenir("selection");
}

function rendreChrono() {
  // Une course qui tourne reste affichée : on ne peut pas en changer tant qu'elle n'est pas arrêtée
  const enMarche = state.courses.find((c) => calc.etatChrono(c).etat === "en-cours");
  if (enMarche && chronoSel !== enMarche.id) choisirCourseChrono(enMarche.id);
  if (chronoSel && !course(chronoSel)) choisirCourseChrono(null);

  const c = course(chronoSel);
  const eqChrono = calc.equipesDe(c, c ? inscritsDe(c.id) : []);
  optionsCourses($("#chronoCourse"), chronoSel);
  const etat = calc.etatChrono(c).etat;
  $("#chronoCourse").disabled = !!enMarche;

  const s = c ? calc.situation(c.id) : null;
  $("#btnDepart").disabled = !c || etat !== "attente";
  $("#btnArret").disabled = etat !== "en-cours";
  $("#btnRaz").disabled = !c || etat === "attente";
  $("#btnAnnulerArrivee").disabled = !s?.arrives.length;
  $("#saisieDossard").disabled = etat !== "en-cours";
  $("#formArrivee button").disabled = etat !== "en-cours";

  const chip = $("#chronoEtat");
  chip.textContent = c ? ETATS[etat] : "Aucune course";
  chip.className = `chip chip--${etat}`;

  if (!c) {
    $("#chronoInfo").textContent = "Choisissez une course pour commencer.";
  } else if (etat === "attente") {
    $("#chronoInfo").textContent = `${s.avecBulletin.length} partant(s) prévu(s) sur ${s.tous.length} inscrit(s) (bulletin complet).` + (c.heure ? ` Départ prévu à ${c.heure}.` : "");
  } else if (etat === "en-cours") {
    $("#chronoInfo").textContent = `Départ donné à ${fmtHeure(c.chrono.depart)} · ${s.partants.length} partant(s)`;
  } else {
    $("#chronoInfo").textContent = "Course terminée — faites une remise à zéro pour recommencer.";
  }

  $("#dernierDossard").textContent = s?.arrives.length ? s.arrives[s.arrives.length - 1].dossard : "—";

  const lignes = s ? [...s.arrives.map((i, k) => ({ i, pos: k + 1 })), ...s.dnf.map((i) => ({ i, pos: null }))] : [];
  $("#nbClasses").textContent = s ? `${s.arrives.length} arrivé(s)${s.dnf.length ? ` · ${s.dnf.length} DNF` : ""}` : "";
  $("#tableArrivees").innerHTML = lignes.length ? lignes.map(({ i, pos }) => `<tr class="${pos == null ? "is-dnf" : pos <= 3 ? `podium podium--${pos}` : ""}">
      <td><b>${pos ?? "DNF"}</b></td><td><b>${esc(i.dossard)}</b></td><td>${esc(nomComplet(i))}</td><td>${esc(calc.equipeAffichee(i, eqChrono))}</td>
      <td>${fmtHeure(i.arrivee) || "-"}</td><td class="r mono"><b>${pos == null ? "DNF" : fmtDuree(calc.duree(i))}</b></td></tr>`).join("")
    : `<tr><td colspan="6" class="muted c">Les arrivées s'afficheront ici.</td></tr>`;
  const sc = $("#scrollClassement");
  sc.scrollTop = sc.scrollHeight;

  const attente = etat === "attente" && s ? s.avecBulletin.sort((a, b) => compareDossard(a.dossard, b.dossard)) : s?.enCours || [];
  $("#nbEnCours").textContent = s ? String(attente.length) : "";
  $("#listeEnCours").innerHTML = attente.map((i) => `<li><b>${esc(i.dossard) || "—"}</b><span>${esc(nomComplet(i))}</span><em>${esc(calc.equipeAffichee(i, eqChrono))}</em></li>`).join("")
    || `<li class="muted-li">${etat === "arretee" ? "Plus personne en course." : "Personne."}</li>`;

  tic();
}

function tic() {
  const c = course(chronoSel);
  $("#chronoAffichage").textContent = fmtDuree(calc.tempsCourse(c), true);
  $("#chronoAffichage").classList.toggle("is-running", calc.etatChrono(c).etat === "en-cours");
}
setInterval(() => { if (vue === "chrono") tic(); }, 100);

$("#chronoCourse").addEventListener("change", (e) => { choisirCourseChrono(e.target.value); rendreChrono(); });

$("#btnDepart").addEventListener("click", async () => {
  const c = course(chronoSel);
  if (!c) return;
  const nb = calc.situation(c.id).avecBulletin.length;
  if (!nb) { toast("Aucun participant n'a de bulletin complet : personne ne peut partir.", "warn"); return; }
  calc.demarrer(c.id);
  await store.sauver();
  rendre();
  $("#saisieDossard").focus();
  toast(`Départ donné : ${nb} partant(s).`);
});

$("#btnArret").addEventListener("click", async () => {
  const c = course(chronoSel);
  if (!c) return;
  const reste = calc.situation(c.id).enCours.length;
  const ok = await confirmer("Arrêter la course", "Arrêter le chronomètre ?" + (reste ? `\n\nLes ${reste} participant(s) encore en course seront classés DNF.` : "") + "\n\nPour relancer, il faudra faire une remise à zéro.", { oui: "Arrêter", danger: true });
  if (!ok) return;
  calc.arreter(c.id);
  await store.sauver();
  rendre();
});

$("#btnRaz").addEventListener("click", async () => {
  const c = course(chronoSel);
  if (!c) return;
  const ok = await confirmer("Remise à zéro", `Remettre à zéro « ${c.nom} » ?\n\nTous les temps enregistrés seront supprimés définitivement.`, { oui: "Remettre à zéro", danger: true });
  if (!ok) return;
  calc.reinitialiser(c.id);
  await store.sauver();
  $("#arriveeMessage").textContent = "";
  rendre();
});

// ── Bips d'arrivée : utiles avec une douchette, on regarde les coureurs et pas l'écran ─
// Réglage mémorisé sur ce poste ; sons générés à la volée (Web Audio), aucun fichier à charger.
// Pensés pour s'entendre dans le bruit d'une arrivée : ondes carrées riches en harmoniques, autour de 2,7 kHz
// (fréquence où l'oreille est la plus sensible, celle des buzzers), puis un limiteur qui pousse le niveau
// au maximum que la carte son peut sortir sans craquer.
const CLE_SON = "loopace-chrono-son";
const CLE_VOLUME = "loopace-chrono-volume";
let sonActif = true;
let volume = 70; // en %, courbe au carré pour suivre l'oreille
try {
  sonActif = localStorage.getItem(CLE_SON) !== "off";
  const v = parseInt(localStorage.getItem(CLE_VOLUME), 10);
  if (Number.isFinite(v)) volume = Math.min(100, Math.max(0, v));
} catch { /* stockage indisponible */ }
let audio = null, sortie = null;

function bip(notes) {
  if (!sonActif || volume === 0) return;
  try {
    if (!audio) {
      audio = new (window.AudioContext || window.webkitAudioContext)();
      const limiteur = audio.createDynamicsCompressor();
      limiteur.threshold.value = -3;
      limiteur.knee.value = 0;
      limiteur.ratio.value = 20;
      limiteur.attack.value = 0.001;
      limiteur.release.value = 0.05;
      sortie = audio.createGain();
      sortie.connect(limiteur).connect(audio.destination);
    }
    if (audio.state === "suspended") audio.resume();
    // Au-delà de 50 % le signal est volontairement saturé puis tenu par le limiteur : plus fort, sans craquement
    sortie.gain.value = 4 * (volume / 100) ** 2;
    let t = audio.currentTime + 0.01;
    notes.forEach(([freq, duree, type = "square"]) => {
      const osc = audio.createOscillator();
      const env = audio.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(1, t + 0.005);
      env.gain.setValueAtTime(1, t + duree - 0.03);
      env.gain.exponentialRampToValueAtTime(0.0001, t + duree);
      osc.connect(env).connect(sortie);
      osc.start(t);
      osc.stop(t + duree + 0.02);
      t += duree + 0.06;
    });
  } catch { /* pas de son disponible : on continue sans */ }
}
const BIP_OK = [[2700, 0.16]];
const BIP_ERREUR = [[440, 0.24, "sawtooth"], [330, 0.36, "sawtooth"]];
const BIP_FIN = [[1760, 0.14], [2350, 0.14], [2960, 0.34]];

// Réglages dans Administration → Options
function rendreOptionsSon() {
  $("#optSon").checked = sonActif;
  $("#optVolume").value = volume;
  $("#optVolume").disabled = !sonActif;
  $("#valeurVolume").textContent = volume ? `${volume} %` : "muet";
  $("#optVolume").style.setProperty("--rempli", `${volume}%`);
}
rendreOptionsSon();
$("#optSon").addEventListener("change", (e) => {
  sonActif = e.target.checked;
  try { localStorage.setItem(CLE_SON, sonActif ? "on" : "off"); } catch { /* stockage indisponible */ }
  rendreOptionsSon();
  bip(BIP_OK);
});
$("#optVolume").addEventListener("input", (e) => {
  volume = parseInt(e.target.value, 10);
  rendreOptionsSon();
});
// Bip d'essai et mémorisation une fois le curseur lâché (pas à chaque cran)
$("#optVolume").addEventListener("change", () => {
  try { localStorage.setItem(CLE_VOLUME, String(volume)); } catch { /* stockage indisponible */ }
  bip(BIP_OK);
});
$("#btnTesterSon").addEventListener("click", () => {
  if (!sonActif) { toast("Le bip est désactivé : cochez « Bip à chaque arrivée » pour l'entendre.", "warn"); return; }
  if (!volume) { toast("Le volume est à zéro : montez le curseur pour entendre le bip.", "warn"); return; }
  bip(BIP_OK);
  setTimeout(() => bip(BIP_ERREUR), 500);
  setTimeout(() => bip(BIP_FIN), 1300);
});

$("#formArrivee").addEventListener("submit", async (e) => {
  e.preventDefault();
  const champ = $("#saisieDossard");
  const dossard = champ.value.trim();
  champ.value = "";
  champ.focus();
  if (!dossard || !chronoSel) return;
  const r = calc.arrivee(chronoSel, dossard);
  const msg = $("#arriveeMessage");
  if (!r.ok) {
    msg.textContent = r.message;
    msg.className = "arrival__msg is-err";
    bip(BIP_ERREUR);
    return;
  }
  await store.sauver();
  msg.textContent = `✓ ${r.inscrit.dossard} — ${nomComplet(r.inscrit)} — ${fmtDuree(calc.duree(r.inscrit))}`;
  msg.className = "arrival__msg is-ok";
  rendre();
  bip(r.termine ? BIP_FIN : BIP_OK);
  if (r.termine) toast("Tous les participants sont arrivés : chronomètre arrêté automatiquement.");
});

$("#btnAnnulerArrivee").addEventListener("click", async () => {
  const c = course(chronoSel);
  if (!c) return;
  const s = calc.situation(c.id);
  const der = s.arrives[s.arrives.length - 1];
  if (!der) return;
  const reprise = calc.etatChrono(c).etat === "arretee";
  const ok = await confirmer("Annuler la dernière arrivée", `Annuler l'arrivée du dossard ${der.dossard} (${nomComplet(der)}) ?` + (reprise ? "\n\nLa course est terminée : elle reprendra et le chronomètre repartira." : ""), { oui: "Annuler l'arrivée" });
  if (!ok) return;
  calc.annulerDerniere(c.id);
  await store.sauver();
  rendre();
  $("#saisieDossard").focus();
});

$("#btnEcran").addEventListener("click", () => {
  if (fenetreEcran && !fenetreEcran.closed) { fenetreEcran.focus(); return; }
  fenetreEcran = window.open("ecran.html", "loopace-chrono-ecran", "popup,width=1280,height=760");
  if (!fenetreEcran) toast("Le navigateur a bloqué la fenêtre : autorisez les fenêtres pop-up pour ce site.", "warn");
});

// ══════════════════════════════════════════════════════════════
// RÉSULTATS
// ══════════════════════════════════════════════════════════════
let resultatsSel = null;
let segment = "individuel";

function rendreResultats() {
  if (resultatsSel && !course(resultatsSel)) resultatsSel = null;
  if (!resultatsSel && chronoSel && course(chronoSel)) resultatsSel = chronoSel;
  optionsCourses($("#resultatsCourse"), resultatsSel);
  const c = course(resultatsSel);
  const res = c ? calc.resultats(c.id) : null;
  const vide = !res || !res.individuel.length;
  ["#btnPdf", "#btnExcelResultats", "#btnArchiver"].forEach((s) => { $(s).disabled = vide; });
  $("#resultatsInfo").textContent = c ? (vide ? "Aucun temps pour cette course : donnez le départ dans l'onglet Chronomètre." : res.info) : "Choisissez une course.";

  const eq = res?.equipes || { ecole: true, club: true };
  ["#segIndividuel", "#segEcoles", "#segClubs"].forEach((s) => marquerEquipes($(s), eq));
  $('.seg__btn[data-seg="ecoles"]').hidden = !eq.ecole;
  $('.seg__btn[data-seg="clubs"]').hidden = !eq.club;
  if ((segment === "ecoles" && !eq.ecole) || (segment === "clubs" && !eq.club)) segment = "individuel";
  $$(".seg__btn[data-seg]").forEach((b) => b.classList.toggle("is-on", b.dataset.seg === segment));
  $("#segIndividuel").hidden = segment !== "individuel";
  $("#segEcoles").hidden = segment !== "ecoles";
  $("#segClubs").hidden = segment !== "clubs";

  $("#tableResultats").innerHTML = !vide ? res.individuel.map((l) => `<tr class="${l.dnf ? "is-dnf" : l.enCours ? "is-wait" : +l.position <= 3 ? `podium podium--${l.position}` : ""}">
      <td><b>${l.position}</b></td><td><b>${esc(l.dossard)}</b></td><td>${esc(l.nom)}</td><td>${esc(l.prenom)}</td><td class="col-ecole">${esc(l.ecole)}</td><td class="col-club">${esc(l.club)}</td>
      <td>${esc(l.categorie)}</td><td>${esc(l.sexe)}</td><td>${esc(l.naissance)}</td><td class="r mono"><b>${l.enCours ? "En course" : l.temps}</b></td></tr>`).join("")
    : `<tr><td colspan="10" class="muted c">Pas encore de résultats.</td></tr>`;

  $("#segEcoles").innerHTML = blocsEquipes(res, "ecoles", "#École", "rangEcole", "club")
    || `<p class="muted">Le classement par école apparaît dès les premières arrivées. Règle du modèle PDF de la course : ${res ? res.regle.txt : "3 meilleurs temps"} de chaque école.</p>`;
  $("#segClubs").innerHTML = blocsEquipes(res, "clubs", "#Club", "rangClub", "ecole")
    || `<p class="muted">Le classement par club apparaît quand des arrivants ont un club renseigné (fiche participant ou colonne « Club » de l'import). Même règle que les écoles : ${res ? res.regle.txt : "3 meilleurs temps"}.</p>`;
}

/** Masque les colonnes et champs École ou Club que la course n'utilise pas (réglage de la fiche course). */
function marquerEquipes(el, eq) {
  el.classList.toggle("sans-ecole", !eq.ecole);
  el.classList.toggle("sans-club", !eq.club);
}

/** Blocs d'un classement par équipe (écoles ou clubs) ; « autre » : la colonne de l'autre type d'équipe. */
function blocsEquipes(res, cle, rangTitre, champRang, autre) {
  const titreAutre = autre === "club" ? "Club" : "École";
  const colAutre = `col-${autre}`;
  return res?.[cle].length ? res[cle].map((g) => `<article class="ecole">
      <header class="ecole__head">
        <span class="ecole__rang${g.rang <= 3 ? ` ecole__rang--${g.rang}` : ""}">${g.rang}</span>
        <h3>${esc(g.ecole)}</h3>
        <span class="meta">${effectifEquipe(g).join(" · ")}${g.score != null ? ` · ${res.regle.txt} : <b>${g.scoreTxt}</b>` : ""}</span>
      </header>
      <div class="table-wrap"><table class="table table--compact table--nowrap">
        <thead><tr><th>${rangTitre}</th><th>#Gén.</th><th>Dossard</th><th>Nom</th><th>Prénom</th><th class="${colAutre}">${titreAutre}</th><th>Catégorie</th><th>Sexe</th><th class="r">Temps</th></tr></thead>
        <tbody>${g.participants.map((l) => `<tr class="${l.dnf || l.absent ? "is-dnf" : l.enCours ? "is-wait" : l[champRang] <= 3 ? `podium podium--${l[champRang]}` : ""}">
          <td><b>${l[champRang] ?? (l.dnf ? "DNF" : "-")}</b></td><td>${l.position}</td><td>${esc(l.dossard)}</td><td>${esc(l.nom)}</td><td>${esc(l.prenom)}</td>
          <td class="${colAutre}">${esc(l[autre])}</td><td>${esc(l.categorie)}</td><td>${esc(l.sexe)}</td><td class="r mono"><b>${l.enCours ? "En course" : l.temps}</b></td></tr>`).join("")}</tbody>
      </table></div>
    </article>`).join("") : "";
}

/** Effectif d'une école ou d'un club : tous les inscrits, dont arrivés, DNF, en course, non partants. */
function effectifEquipe(g) {
  return [`${g.nbInscrits} inscrit(s)`, `${g.nbFinishers} classé(s)`, g.nbDnf && `${g.nbDnf} DNF`,
    g.nbEnCours && `${g.nbEnCours} en course`, g.nbAbsents && `${g.nbAbsents} non partant(s)`].filter(Boolean);
}

$("#resultatsCourse").addEventListener("change", (e) => { resultatsSel = e.target.value || null; rendreResultats(); });
$$(".seg__btn[data-seg]").forEach((b) => b.addEventListener("click", () => { segment = b.dataset.seg; rendreResultats(); }));

function pdfCourse(c) {
  return genererPdf({ course: c, theme: theme(c.themeId), res: calc.resultats(c.id) });
}

$("#btnPdf").addEventListener("click", () => {
  const c = course(resultatsSel);
  if (!c) return;
  try { telecharger(pdfCourse(c), nomFichier("Resultats_", c.nom, "pdf")); }
  catch (err) { toast(`Erreur lors de la génération du PDF : ${err.message}`, "err"); }
});

$("#btnExcelResultats").addEventListener("click", () => {
  const c = course(resultatsSel);
  if (!c) return;
  try { excel.exporterResultats(nomFichier("Resultats_", c.nom, "xlsx"), calc.resultats(c.id)); }
  catch (err) { toast(err.message, "err"); }
});

$("#btnArchiver").addEventListener("click", async () => {
  const c = course(resultatsSel);
  if (!c) return;
  const ok = await confirmer("Archiver la course", `Archiver « ${c.nom} » ?\n\nLa course quitte la liste des courses. Ses résultats (PDF), ses participants et ses temps sont conservés dans l'onglet Archives, d'où elle pourra être dupliquée en nouvelle course.`, { oui: "Archiver" });
  if (!ok) return;
  try {
    const blob = pdfCourse(c);
    // Copie complète de la course : pour revoir, refaire le PDF ou l'Excel, et dupliquer en nouvelle course
    const donnees = { course: structuredClone(c), inscrits: structuredClone(inscritsDe(c.id)), theme: structuredClone(theme(c.themeId)) };
    const id = uid();
    await store.archives.ajouter({ id, nom: c.nom, fichier: nomFichier("", c.nom, "pdf"), date: Date.now(), taille: blob.size, blob, donnees });
    archiveSel = id;
    await supprimerCourse(c.id);
    if (courseSel === c.id) courseSel = null;
    rendre();
    toast("Course archivée : retrouvez-la dans l'onglet Archives.");
  } catch (err) {
    toast(`Erreur lors de l'archivage : ${err.message}`, "err");
  }
});

// ══════════════════════════════════════════════════════════════
// ARCHIVES
// ══════════════════════════════════════════════════════════════
const taille = (o) => (o < 1024 * 1024 ? `${Math.max(1, Math.round(o / 1024))} Ko` : `${(o / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`);
let cacheArchives = [];
let archiveSel = null;
let urlPdfArchive = null;
let rechercheArchives = "";
const anneesOuvertes = new Set();

/** Année d'une archive : celle de la date de course, sinon celle du jour d'archivage. */
const anneeArchive = (a) => (a.donnees?.course?.date || new Date(a.date).toISOString()).slice(0, 4);

/**
 * Liste rangée par année (la plus récente en haut, repliable), puis par date de course.
 * La recherche porte sur le nom, le lieu, le type et la date, et déplie tout.
 */
function rendreListeArchives() {
  $("#nbArchives").textContent = cacheArchives.length ? String(cacheArchives.length) : "";
  $("#nbArchives").hidden = !cacheArchives.length;
  if (!cacheArchives.length) { $("#listeArchives").innerHTML = `<p class="muted-li">Aucune archive pour l'instant.</p>`; return; }

  const q = normaliser(rechercheArchives);
  const fiches = cacheArchives.map((a) => {
    const c = a.donnees?.course;
    const annee = anneeArchive(a);
    const texte = normaliser([a.nom, c?.lieu, c?.type, c && fmtDate(c.date), annee].filter(Boolean).join(" "));
    return { a, c, annee, dateCourse: c?.date || "", visible: !q || q.split(" ").every((mot) => texte.includes(mot)) };
  }).filter((x) => x.visible);
  if (!fiches.length) { $("#listeArchives").innerHTML = `<p class="muted-li">Aucune archive ne correspond à « ${esc(rechercheArchives)} ».</p>`; return; }

  const annees = new Map();
  fiches.sort((x, y) => y.annee.localeCompare(x.annee) || y.dateCourse.localeCompare(x.dateCourse) || y.a.date - x.a.date)
    .forEach((x) => { if (!annees.has(x.annee)) annees.set(x.annee, []); annees.get(x.annee).push(x); });
  // Par défaut : l'année la plus récente et celle de l'archive affichée sont ouvertes
  if (!anneesOuvertes.size) {
    anneesOuvertes.add([...annees.keys()][0]);
    const sel = cacheArchives.find((a) => a.id === archiveSel);
    if (sel) anneesOuvertes.add(anneeArchive(sel));
  }
  const marquer = (txt) => {
    if (!q) return esc(txt);
    const brut = String(txt);
    const k = normaliser(brut).indexOf(q.split(" ")[0]);
    return k < 0 ? esc(brut) : esc(brut.slice(0, k)) + `<mark>${esc(brut.slice(k, k + q.split(" ")[0].length))}</mark>` + esc(brut.slice(k + q.split(" ")[0].length));
  };
  $("#listeArchives").innerHTML = [...annees.entries()].map(([annee, liste]) => `
    <details class="saison" data-annee="${annee}"${q || anneesOuvertes.has(annee) ? " open" : ""}>
      <summary>${annee}<span>${liste.length}</span></summary>
      <ul>${liste.map(({ a, c }) => {
        const res = a.donnees ? calc.resultatsDe(c, a.donnees.inscrits, a.donnees.theme) : null;
        const meta = c ? [fmtDate(c.date), c.lieu].filter(Boolean).join(" · ") : "Ancienne archive (PDF seul)";
        return `<li><button class="archive-item${a.id === archiveSel ? " is-on" : ""}" data-id="${a.id}">
          <b>${marquer(a.nom)}</b><small>${esc(meta) || "&nbsp;"}</small><em>${res ? `${res.nbClasses} cl.` : "PDF"}</em>
        </button></li>`;
      }).join("")}</ul>
    </details>`).join("");
}

async function rendreArchives() {
  cacheArchives = await store.archives.lister();
  if (archiveSel && !cacheArchives.some((a) => a.id === archiveSel)) archiveSel = null;
  // Par défaut : la course la plus récente (date de course, sinon d'archivage)
  const dateRef = (a) => a.donnees?.course?.date || new Date(a.date).toISOString().slice(0, 10);
  if (!archiveSel && cacheArchives.length) archiveSel = [...cacheArchives].sort((x, y) => dateRef(y).localeCompare(dateRef(x)))[0].id;

  rendreListeArchives();

  const a = cacheArchives.find((x) => x.id === archiveSel);
  $("#videArchive").hidden = !!a;
  $("#detailArchive").hidden = !a;
  $("#videArchiveTexte").textContent = cacheArchives.length ? "Choisissez une archive pour revoir ses résultats."
    : "« Archiver la course », dans l'onglet Résultats, range ici une course terminée avec ses résultats.";
  if (!a) { afficherPdfArchive(null); return; }

  const d = a.donnees;
  const c = d?.course;
  $("#titreArchive").textContent = a.nom;
  $("#metaArchive").textContent = [c && fmtDate(c.date), c?.heure && `départ ${c.heure}`, c?.lieu, c?.distance && `${String(c.distance).replace(".", ",")} km`, c?.type,
    `archivée le ${new Date(a.date).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}`, `PDF ${taille(a.taille)}`].filter(Boolean).join(" · ");
  // Les anciennes archives n'ont que le PDF : pas de résumé, de duplication ni de nouvel export
  ["#btnDupliquerArchive", "#btnExcelArchive"].forEach((b) => { $(b).hidden = !d; });
  $("#barreThemeArchive").hidden = !d;

  if (d) {
    const res = calc.resultatsDe(c, d.inscrits, d.theme);
    const partants = d.inscrits.filter((i) => i.depart != null).length;
    const nbDnf = res.individuel.filter((l) => l.dnf).length;
    const podium = res.individuel.filter((l) => !l.dnf && !l.enCours).slice(0, 3);
    const ecole = res.ecoles.find((g) => g.somme != null && g.ecole !== "(sans école)") || res.clubs.find((g) => g.somme != null && g.ecole !== "(sans club)");
    $("#resumeArchive").innerHTML = `
      <div class="resume__tuile"><small>Partants</small><b>${partants}</b></div>
      <div class="resume__tuile"><small>Classés</small><b>${res.nbClasses}</b></div>
      <div class="resume__tuile"><small>DNF</small><b>${nbDnf}</b></div>
      <div class="resume__tuile resume__tuile--large"><small>Podium</small>${podium.length ? `<ol class="resume__podium">${podium.map((l) =>
        `<li><em>${l.position}</em><span>${esc(`${l.prenom} ${l.nom}`.trim())}${l.ecole || l.club ? ` <small class="muted">· ${esc(l.ecole || l.club)}</small>` : ""}</span><b>${l.temps}</b></li>`).join("")}</ol>` : `<p class="meta">Aucun classé.</p>`}</div>
      <div class="resume__tuile resume__tuile--large"><small>Première école / club</small>${ecole ? `<p class="resume__ecole"><b>${esc(ecole.ecole)}</b><span class="muted">${res.regle.txt} : ${ecole.scoreTxt}</span></p>` : `<p class="meta">Aucune école complète (${res.regle.nb} classés).</p>`}</div>`;
    const themes = [...state.themes].sort((x, y) => (y.defaut - x.defaut) || x.nom.localeCompare(y.nom, "fr"));
    $("#themeArchive").innerHTML = `<option value="">${d.theme ? `Modèle d'origine (« ${esc(d.theme.nom)} »)` : "Modèle d'origine (par défaut)"}</option>` +
      themes.map((t) => `<option value="${t.id}">${esc(t.nom)}</option>`).join("");
  } else {
    $("#resumeArchive").innerHTML = `<p class="meta">Ancienne archive : seul le PDF des résultats a été conservé (les données de la course n'étaient pas encore archivées).</p>`;
  }
  afficherPdfArchive(a);
}

/** PDF affiché dans la page (visionneuse du navigateur) au lieu d'un nouvel onglet. */
function afficherPdfArchive(a) {
  if (urlPdfArchive) URL.revokeObjectURL(urlPdfArchive);
  urlPdfArchive = a ? URL.createObjectURL(a.blob) : null;
  const cadre = $("#pdfArchive");
  if (urlPdfArchive) cadre.src = `${urlPdfArchive}#view=FitH`; else cadre.removeAttribute("src");
}

const archiveCourante = () => cacheArchives.find((x) => x.id === archiveSel);

$("#rechercheArchives").addEventListener("input", (e) => { rechercheArchives = e.target.value; rendreListeArchives(); });
// Mémorise les années ouvertes ou repliées à la main (hors recherche, où tout est déplié)
$("#listeArchives").addEventListener("toggle", (e) => {
  const annee = e.target.dataset?.annee;
  if (!annee || rechercheArchives) return;
  if (e.target.open) anneesOuvertes.add(annee); else anneesOuvertes.delete(annee);
}, true);

$("#listeArchives").addEventListener("click", (e) => {
  const b = e.target.closest(".archive-item");
  if (!b || b.dataset.id === archiveSel) return;
  archiveSel = b.dataset.id;
  rendreArchives();
});

$("#btnPdfArchive").addEventListener("click", () => { const a = archiveCourante(); if (a) telecharger(a.blob, a.fichier); });

$("#btnExcelArchive").addEventListener("click", () => {
  const a = archiveCourante();
  if (!a?.donnees) return;
  try { excel.exporterResultats(nomFichier("Resultats_", a.nom, "xlsx"), calc.resultatsDe(a.donnees.course, a.donnees.inscrits, a.donnees.theme)); }
  catch (err) { toast(err.message, "err"); }
});

$("#btnRefairePdf").addEventListener("click", async () => {
  const a = archiveCourante();
  if (!a?.donnees) return;
  const choix = $("#themeArchive").value;
  const t = choix ? theme(choix) : a.donnees.theme;
  try {
    const blob = genererPdf({ course: a.donnees.course, theme: t, res: calc.resultatsDe(a.donnees.course, a.donnees.inscrits, t) });
    await store.archives.ajouter({ ...a, blob, taille: blob.size });
    await rendreArchives();
    toast(`PDF refait${choix ? ` avec le modèle « ${t.nom} »` : " avec le modèle d'origine"}.`);
  } catch (err) {
    toast(`Erreur lors de la génération du PDF : ${err.message}`, "err");
  }
});

$("#btnDupliquerArchive").addEventListener("click", () => {
  const a = archiveCourante();
  if (a?.donnees) dupliquer(a.donnees.course, a.donnees.inscrits);
});

$("#btnSupprimerArchive").addEventListener("click", async () => {
  const a = archiveCourante();
  if (!a || !await confirmer("Supprimer l'archive", `Supprimer définitivement l'archive « ${a.nom} » (PDF et données) ?`, { oui: "Supprimer", danger: true })) return;
  await store.archives.supprimer(a.id);
  archiveSel = null;
  rendreArchives();
});

// ══════════════════════════════════════════════════════════════
// ADMINISTRATION
// ══════════════════════════════════════════════════════════════
/** Résumé du contenu d'un modèle PDF, pour sa carte : « Général + écoles · 7 colonnes · portrait ». */
function resumeModele(t) {
  const noms = { general: "Général", sexe: "sexe", categorie: "catégories", ecole: "écoles", club: "clubs", podiums: "podiums" };
  const classements = sectionsDe(t).map((cle) => noms[cle]).join(" + ") || "Aucun classement";
  const cols = Array.isArray(t.colonnes) ? t.colonnes : COLONNES_DEFAUT;
  const nbCol = cols.length + (cols.includes("temps") ? 1 : 2); // « # » et le temps toujours là
  return `${classements.charAt(0).toUpperCase()}${classements.slice(1)} · ${nbCol} colonnes · ${t.paysage ? "paysage" : "portrait"}`;
}

function rendreAdmin() {
  const themes = [...state.themes].sort((a, b) => (b.defaut - a.defaut) || a.nom.localeCompare(b.nom, "fr"));
  $("#grilleThemes").innerHTML = themes.map((t) => {
    const nb = state.courses.filter((c) => c.themeId === t.id).length;
    return `<button class="theme-card" data-id="${t.id}" ${t.defaut ? 'aria-disabled="true"' : ""}>
      <span class="theme-card__band" style="background:${esc(t.couleur)}">${t.logo ? `<img src="${t.logo}" alt="">` : ""}</span>
      <span class="theme-card__body"><b>${esc(t.nom)}</b><small>${esc(resumeModele(t))}</small><small>${t.defaut ? "Modèle par défaut (non modifiable) · " : ""}${nb} course(s)</small></span>
    </button>`;
  }).join("");
  if (!baremeModifie) chargerBareme();
}

// ── Mise à jour des catégories automatiques ──────────────────
// On édite en années de naissance pour la saison en cours (c'est ce que donnent les règlements),
// et on enregistre en âges, valables quelle que soit la saison de la course.
let baremeCle = "ffa";
let baremeLignes = [];   // [{ nom, de, a }] : années de naissance, « de » vide = et avant, « a » vide = et après
let baremeModifie = false;

const refBareme = () => calc.anneeSaison(null, $("#admTypeSaison").value === "civile");

function chargerBareme() {
  const sel = $("#admBareme");
  sel.innerHTML = Object.entries(calc.BAREMES).filter(([, b]) => b.tranches)
    .map(([cle, b]) => `<option value="${cle}"${cle === baremeCle ? " selected" : ""}>${b.nom.replace("Automatique — ", "")}</option>`).join("");
  const b = calc.bareme(baremeCle);
  $("#admTypeSaison").value = b.civile ? "civile" : "scolaire";
  const ref = refBareme();
  baremeLignes = b.tranches.map(([de, a, nom]) => ({ nom, de: a >= 150 ? "" : ref - a, a: de === 0 ? "" : ref - de }));
  baremeModifie = false;
  rendreBareme();
}

function rendreBareme() {
  const ref = refBareme();
  const civile = $("#admTypeSaison").value === "civile";
  const perso = state.baremes?.[baremeCle];
  $("#admSaisonRef").textContent = `Années de naissance, saison ${civile ? ref : `${ref - 1}-${ref}`} (case vide = « et avant » / « et après »).`;
  // Carte : état enregistré ; fenêtre d'édition : même état, ou « modifications non enregistrées »
  const version = calc.versionBaremes();
  const etat = perso ? `Modifié à la main le ${new Date(perso.modifie).toLocaleDateString("fr-FR")}`
    : version ? `Barème officiel à jour (version du ${fmtDate(version)})` : "Barème intégré";
  $("#admEtatBareme").textContent = etat;
  $("#admEtatBareme").className = `chip${perso ? " chip--arretee" : ""}`;
  $("#admEtatEdition").textContent = baremeModifie ? "Modifications non enregistrées" : etat;
  $("#admEtatEdition").className = `chip${baremeModifie ? " chip--en-cours" : perso ? " chip--arretee" : ""}`;
  $("#dlgBaremeTitre").textContent = `Modifier le barème ${calc.BAREMES[baremeCle].nom.replace("Automatique — ", "")}`;
  $("#btnRetablirBareme").disabled = !perso && !baremeModifie;
  $("#admErreurBareme").textContent = "";
  $("#admTranches").innerHTML = baremeLignes.map((l, k) => `<tr data-k="${k}">
      <td><input class="input" data-champ="nom" value="${esc(l.nom)}" maxlength="60" aria-label="Nom de la catégorie"></td>
      <td><input class="input" type="number" data-champ="de" value="${l.de}" placeholder="et avant" aria-label="Née à partir de"></td>
      <td><input class="input" type="number" data-champ="a" value="${l.a}" placeholder="et après" aria-label="Née jusqu'à"></td>
      <td class="r"><button type="button" class="btn btn--ghost btn--sm btn--danger" data-suppr aria-label="Supprimer la catégorie"><svg class="ico"><use href="#i-trash"/></svg></button></td>
    </tr>`).join("");
}

function marquerBaremeModifie() {
  baremeModifie = true;
  const chip = $("#admEtatEdition");
  chip.textContent = "Modifications non enregistrées";
  chip.className = "chip chip--en-cours";
  $("#btnRetablirBareme").disabled = false;
}

$("#admBareme").addEventListener("change", (e) => {
  baremeCle = e.target.value;
  chargerBareme();
});

// L'édition se fait dans une fenêtre, pour ne pas bousculer les autres cartes de l'Administration
$("#btnModifierBareme").addEventListener("click", () => {
  chargerBareme();
  $("#dlgBareme").showModal();
});
function fermerBareme() {
  $("#dlgBareme").close();
  chargerBareme(); // abandonne les modifications non enregistrées
}
$("#btnFermerBareme").addEventListener("click", fermerBareme);
$("#dlgBareme").addEventListener("cancel", (e) => { e.preventDefault(); fermerBareme(); });
$("#admTypeSaison").addEventListener("change", () => { baremeModifie = true; rendreBareme(); });
$("#admTranches").addEventListener("input", (e) => {
  const champ = e.target.dataset.champ;
  if (!champ) return;
  const l = baremeLignes[+e.target.closest("tr").dataset.k];
  l[champ] = champ === "nom" ? e.target.value : e.target.value === "" ? "" : parseInt(e.target.value, 10);
  marquerBaremeModifie();
});
$("#admTranches").addEventListener("click", (e) => {
  if (!e.target.closest("[data-suppr]")) return;
  baremeLignes.splice(+e.target.closest("tr").dataset.k, 1);
  baremeModifie = true;
  rendreBareme();
});
$("#btnAjouterTranche").addEventListener("click", () => {
  baremeLignes.push({ nom: "", de: "", a: "" });
  baremeModifie = true;
  rendreBareme();
  $("#admTranches tr:last-child input").focus();
});

$("#btnEnregistrerBareme").addEventListener("click", async () => {
  const ref = refBareme();
  const erreur = (m) => { $("#admErreurBareme").textContent = m; };
  const tranches = [];
  for (const l of baremeLignes) {
    const nom = String(l.nom).trim();
    if (!nom) return erreur("Chaque catégorie doit avoir un nom.");
    if (l.de === "" && l.a === "") return erreur(`« ${nom} » : indiquez au moins une année de naissance.`);
    if ([l.de, l.a].some((v) => v !== "" && !(Number.isInteger(v) && v > 1900 && v <= ref))) return erreur(`« ${nom} » : année de naissance invalide.`);
    if (l.de !== "" && l.a !== "" && l.de > l.a) return erreur(`« ${nom} » : l'année « de » doit être avant l'année « à ».`);
    tranches.push([l.a === "" ? 0 : ref - l.a, l.de === "" ? 150 : ref - l.de, nom]);
  }
  if (!tranches.length) return erreur("Le barème doit contenir au moins une catégorie.");
  tranches.sort((x, y) => x[0] - y[0]);
  for (let k = 1; k < tranches.length; k++) {
    if (tranches[k][0] <= tranches[k - 1][1]) return erreur(`« ${tranches[k - 1][2]} » et « ${tranches[k][2]} » se chevauchent : une même année ne peut être que dans une catégorie.`);
  }
  state.baremes ??= {};
  state.baremes[baremeCle] = { tranches, civile: $("#admTypeSaison").value === "civile", modifie: Date.now() };
  const r = calc.recalculerBareme(baremeCle);
  await store.sauver();
  fermerBareme();
  toast(`Barème ${calc.BAREMES[baremeCle].nom.replace("Automatique — ", "")} enregistré.` +
    (r.courses ? ` ${r.courses} course(s) recalculée(s), ${r.modifiees} catégorie(s) changée(s).` : ""));
});

$("#btnRetablirBareme").addEventListener("click", async () => {
  if (!state.baremes?.[baremeCle]) { chargerBareme(); return; } // seulement des modifications non enregistrées : on les annule
  if (!await confirmer("Revenir au barème officiel", "Abandonner la modification manuelle et revenir au barème officiel, mis à jour automatiquement ? Les courses qui l'utilisent seront recalculées.", { oui: "Revenir au barème officiel" })) return;
  delete state.baremes[baremeCle];
  const r = calc.recalculerBareme(baremeCle);
  await store.sauver();
  fermerBareme();
  toast("Barème officiel rétabli : il suivra de nouveau les mises à jour automatiques." + (r.modifiees ? ` ${r.modifiees} catégorie(s) changée(s).` : ""));
});

let logoEnCours = null;

// ── Éditeur de modèle PDF : on glisse les classements et les colonnes sur la page ─
// L'ordre des blocs sur la page est celui du PDF. Souris, doigt (Pointer Events) ou clavier.
const edition = { colonnes: [], sections: [], podiumsSansCumul: false };
const DEFS = { colonnes: COLONNES_PDF, sections: SECTIONS_PDF };
// Colonnes retirées par chaque classement (comme dans le PDF)
const SANS_SECTION = { sexe: ["sexe", "rangSexe"], categorie: ["categorie", "rangCategorie"], ecole: ["ecole"], club: ["club"] };
const TITRES_SECTION = { general: "Classement général", sexe: "Classement par sexe", categorie: "Classement par catégorie",
  ecole: "Classement par école", club: "Classement par club", podiums: "Podiums" };
const EN_GROUPES = ["sexe", "categorie", "ecole", "club", "podiums"];

function colonnesSection(cle) {
  if (cle === "podiums") {
    const a = (k) => edition.colonnes.includes(k);
    return [...(a("nomPrenom") ? ["dossard", "nomPrenom"] : ["dossard", "nom", "prenom"]), ...(["ecole", "club"].filter(a).length ? ["ecole", "club"].filter(a) : ["ecole"]), "temps"];
  }
  return edition.colonnes.filter((c) => !(SANS_SECTION[cle] || []).includes(c));
}
const titreCol = (cle) => COLONNES_PDF.find((c) => c.cle === cle)?.titre || cle;

function puce(c, surPage) {
  return `<span class="puce" data-type="colonnes" data-cle="${c.cle}" tabindex="0" role="listitem" title="${esc(c.aide || c.titre)}"${c.fixe ? " data-fixe" : ""}>${esc(c.titre)}${
    surPage && !c.fixe ? `<button type="button" class="puce__x" data-retirer aria-label="Retirer ${esc(c.titre)}">×</button>` : ""}</span>`;
}

function bloc(s, couleur) {
  const groupes = EN_GROUPES.includes(s.cle);
  const cols = ["#", ...colonnesSection(s.cle).map(titreCol)].join("  ·  ");
  return `<div class="bloc" data-type="sections" data-cle="${s.cle}" tabindex="0" role="listitem">
      <div class="bloc__tete" style="color:${couleur}"><span class="bloc__poignee" aria-hidden="true">⋮⋮</span>${esc(TITRES_SECTION[s.cle])}<small>${esc(s.aide)}</small>
        <button type="button" class="bloc__x" data-retirer aria-label="Retirer ${esc(TITRES_SECTION[s.cle])}">×</button></div>
      ${s.cle === "podiums" ? `<span class="bloc__saut">Nouvelle page</span>
        <label class="bloc__option"><input type="checkbox" name="podiumsSansCumul"${edition.podiumsSansCumul ? " checked" : ""}>
          Pas de cumul : un coureur sur le podium scratch laisse sa place au suivant sur le podium de sa catégorie</label>` : ""}
      ${groupes ? `<span class="bloc__bande" style="background:${couleur}"></span>` : ""}
      <span class="bloc__cols">${esc(cols)}</span>
      <span class="bloc__ligne bloc__ligne--1"></span><span class="bloc__ligne bloc__ligne--2"></span><span class="bloc__ligne bloc__ligne--3"></span>
    </div>`;
}

/** Affiche la page (blocs dans l'ordre) et les réserves (ce qui n'est pas sur la page, dans l'ordre proposé). */
function rendreConstructeur(focus = null) {
  const couleur = couleurModele();
  $("#pageColonnes").innerHTML = edition.colonnes.map((cle) => COLONNES_PDF.find((c) => c.cle === cle)).filter(Boolean).map((c) => puce(c, true)).join("");
  $("#reserveColonnes").innerHTML = COLONNES_PDF.filter((c) => !edition.colonnes.includes(c.cle)).map((c) => puce(c, false)).join("");
  $("#pageSections").innerHTML = edition.sections.map((cle) => SECTIONS_PDF.find((x) => x.cle === cle)).filter(Boolean).map((x) => bloc(x, couleur)).join("");
  $("#reserveSections").innerHTML = SECTIONS_PDF.filter((x) => !edition.sections.includes(x.cle))
    .map((x) => `<div class="dispo" data-type="sections" data-cle="${x.cle}" tabindex="0" role="listitem">${esc(TITRES_SECTION[x.cle])}<small>${esc(x.aide)}</small></div>`).join("");
  const equipes = edition.sections.includes("ecole") || edition.sections.includes("club");
  $("#regleEcoles").setAttribute("aria-disabled", String(!equipes));
  if (focus) $(`#formTheme [data-type="${focus.type}"][data-cle="${focus.cle}"]`)?.focus();
}

function ajouter(type, cle, index = null) {
  const liste = edition[type].filter((k) => k !== cle);
  // Une colonne ajoutée sans place précise se met avant le temps
  const pos = index ?? (type === "colonnes" && liste.includes("temps") ? liste.indexOf("temps") : liste.length);
  liste.splice(pos, 0, cle);
  edition[type] = liste;
}
function retirer(type, cle) {
  if (DEFS[type].find((d) => d.cle === cle)?.fixe) return;
  edition[type] = edition[type].filter((k) => k !== cle);
}

// Clic : « + » d'une réserve ajoute, « × » retire (sauf juste après un glisser)
let clicIgnore = false;
$("#formTheme").addEventListener("click", (e) => {
  if (clicIgnore) { clicIgnore = false; return; }
  const el = e.target.closest("[data-type]");
  if (!el) return;
  const { type, cle } = el.dataset;
  if (e.target.closest("[data-retirer]")) { retirer(type, cle); rendreConstructeur(); return; }
  if (el.closest("[data-reserve]")) { ajouter(type, cle); rendreConstructeur({ type, cle }); }
});

// Clavier : flèches pour déplacer sur la page, Suppr pour retirer, Entrée pour ajouter depuis une réserve
$("#formTheme").addEventListener("keydown", (e) => {
  const el = e.target.closest?.("[data-type]");
  if (!el || e.target !== el) return;
  const { type, cle } = el.dataset;
  const surPage = !el.closest("[data-reserve]");
  if (!surPage && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); ajouter(type, cle); rendreConstructeur({ type, cle }); return; }
  if (!surPage) return;
  const i = edition[type].indexOf(cle);
  if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(e.key)) {
    e.preventDefault();
    const j = i + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1);
    if (j < 0 || j >= edition[type].length) return;
    ajouter(type, cle, j);
    rendreConstructeur({ type, cle });
  } else if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    retirer(type, cle);
    rendreConstructeur();
  }
});

// Glisser-déposer (souris et tactile) : l'élément suit le pointeur, sa place sur la page se met à jour en direct
let glisse = null;
// Case « pas de cumul » du bloc Podiums : lue dès « input », avant que le formulaire ne redessine la page
["input", "change"].forEach((type) => $("#pageSections").addEventListener(type, (e) => {
  if (e.target.name === "podiumsSansCumul") edition.podiumsSansCumul = e.target.checked;
}));

$("#formTheme").addEventListener("pointerdown", (e) => {
  const el = e.target.closest("[data-type]");
  if (!el || e.button !== 0 || e.target.closest("button, label, input")) return;
  glisse = { el, type: el.dataset.type, x0: e.clientX, y0: e.clientY, id: e.pointerId, actif: false };
});

function zoneSous(x, y, type) {
  const sous = document.elementFromPoint(x, y);
  return sous?.closest(`[data-zone="${type}"]`) || null;
}

/** Place l'élément dans la zone de la page, à l'endroit du pointeur. */
function placer(zone, el, x, y) {
  const autres = [...zone.children].filter((c) => c !== el && c.dataset.type);
  const ligne = zone.dataset.sens === "ligne";
  const avant = autres.find((c) => {
    const r = c.getBoundingClientRect();
    return ligne ? y < r.top || (y <= r.bottom && x < r.left + r.width / 2) : y < r.top + r.height / 2;
  });
  if (avant) { if (el.nextElementSibling !== avant) zone.insertBefore(el, avant); }
  else if (zone.lastElementChild !== el) zone.appendChild(el);
}

document.addEventListener("pointermove", (e) => {
  const g = glisse;
  if (!g || e.pointerId !== g.id) return;
  if (!g.actif) {
    if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < 6) return;
    // Départ : un fantôme suit le pointeur ; l'original reste en place, estompé
    const r = g.el.getBoundingClientRect();
    g.actif = true;
    g.depuisReserve = !!g.el.closest("[data-reserve]");
    g.origine = { parent: g.el.parentNode, suivant: g.el.nextSibling };
    g.dx = e.clientX - r.left; g.dy = e.clientY - r.top;
    g.vol = g.el.cloneNode(true);
    g.vol.classList.add("vol");
    g.vol.style.width = `${r.width}px`;
    $("#dlgTheme").appendChild(g.vol);
    if (g.depuisReserve) {
      // Depuis la réserve : l'élément à placer devient une puce / un bloc de page
      const def = DEFS[g.type].find((d) => d.cle === g.el.dataset.cle);
      const tmp = document.createElement("div");
      tmp.innerHTML = g.type === "colonnes" ? puce(def, true) : bloc(def, couleurModele());
      g.place = tmp.firstElementChild;
    } else g.place = g.el;
    g.place.classList.add("is-glisse");
  }
  e.preventDefault();
  g.vol.style.transform = `translate(${e.clientX - g.dx}px, ${e.clientY - g.dy}px)`;
  const zone = zoneSous(e.clientX, e.clientY, g.type);
  const page = zone && !zone.hasAttribute("data-reserve") ? zone : null;
  const reserve = zone?.hasAttribute("data-reserve") && !g.place.hasAttribute("data-fixe") ? zone : null;
  $$("#formTheme .is-cible").forEach((z) => z.classList.remove("is-cible"));
  if (page) { page.classList.add("is-cible"); placer(page, g.place, e.clientX, e.clientY); }
  else {
    if (reserve && !g.depuisReserve) reserve.classList.add("is-cible");
    // Hors de la page : l'élément reprend sa place d'origine (ou quitte la page s'il venait de la réserve)
    if (g.depuisReserve) g.place.remove();
    else if (g.place.parentNode !== g.origine.parent || g.place.nextSibling !== g.origine.suivant) g.origine.parent.insertBefore(g.place, g.origine.suivant);
  }
  g.cible = page ? "page" : reserve ? "reserve" : null;
  // Défilement automatique près des bords : la colonne sous le pointeur (grand écran) ou la fenêtre
  const sous = document.elementFromPoint(e.clientX, e.clientY)?.closest(".modele__outils, .modele__page");
  const sc = sous && sous.scrollHeight > sous.clientHeight ? sous : $("#dlgTheme");
  const rd = sc.getBoundingClientRect();
  if (e.clientY > rd.bottom - 40) sc.scrollTop += 12;
  else if (e.clientY < rd.top + 40) sc.scrollTop -= 12;
}, { passive: false });

function finGlisse(e) {
  const g = glisse;
  if (!g || e.pointerId !== g.id) return;
  glisse = null;
  if (!g.actif) return;
  clicIgnore = true;
  setTimeout(() => { clicIgnore = false; }, 0);
  g.vol.remove();
  $$("#formTheme .is-cible").forEach((z) => z.classList.remove("is-cible"));
  const cle = g.el.dataset.cle;
  if (g.cible === "reserve" && !g.depuisReserve) retirer(g.type, cle);
  else if (g.cible === "page" && e.type === "pointerup") edition[g.type] = [...$(`#formTheme [data-zone="${g.type}"]:not([data-reserve])`).children].map((c) => c.dataset.cle);
  rendreConstructeur({ type: g.type, cle });
}
document.addEventListener("pointerup", finGlisse);
document.addEventListener("pointercancel", finGlisse);

function remplirContenu(m) {
  const f = $("#formTheme");
  const colonnes = Array.isArray(m.colonnes) ? m.colonnes : COLONNES_DEFAUT;
  edition.colonnes = colonnes.includes("temps") ? [...colonnes] : [...colonnes, "temps"]; // anciens modèles : temps en dernier
  edition.sections = sectionsDe(m);
  edition.podiumsSansCumul = !!m.podiumsSansCumul;
  // Nouveau modèle : 5 premiers aux places ; modèle existant sans réglage : 3 meilleurs temps (comme avant)
  f.ecoleNb.value = m.ecoleNb ?? (m.nom ? 3 : 5);
  f.ecoleMode.value = m.ecoleMode ?? (m.nom ? "temps" : "places");
  f.paysage.value = m.paysage ? "1" : "";
}

function ongletModele(nom) {
  $$("#formTheme [data-onglet]").forEach((b) => b.classList.toggle("is-on", b.dataset.onglet === nom));
  $$("#formTheme [data-panneau]").forEach((p) => { p.hidden = p.dataset.panneau !== nom; });
}
$$("#formTheme [data-onglet]").forEach((b) => b.addEventListener("click", () => ongletModele(b.dataset.onglet)));

const couleurModele = () => {
  const v = $("#formTheme").couleur.value;
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : "#15291F";
};

/** En-tête de la page (apparence) puis blocs (contenu). */
function apercuTheme() {
  const f = $("#formTheme");
  const couleur = couleurModele();
  $("#apercuMarque").style.color = couleur;
  $("#apercuTrait").style.background = couleur;
  $("#apercuTitre").textContent = f.titre.value.trim() || "Nom de la course";
  $("#apercuTitre").style.fontSize = `${Math.min(30, Math.max(11, (+f.tailleTitre.value || 16) * 1.15))}px`;
  $("#apercuSous").textContent = f.sousTitre.value.trim();
  $("#apercuPied").textContent = `${f.piedPage.value.trim() || "Loopace Chrono"} — Page 1 / 1`;
  const img = $("#apercuLogo");
  img.hidden = !logoEnCours;
  if (logoEnCours) { img.src = logoEnCours; img.style.width = img.style.height = `${Math.min(90, Math.max(18, (+f.tailleLogo.value || 60) * 0.7))}px`; }
  $("#btnLogoRetirer").hidden = !logoEnCours;
  $("#apercuPage").classList.toggle("is-paysage", !!f.paysage.value);
  $("#champEcoleNb").hidden = f.ecoleMode.value === "nombre"; // la plus représentée : tous les inscrits comptent
  rendreConstructeur();
}

async function editerTheme(t) {
  const f = $("#formTheme");
  $("#dlgThemeTitre").textContent = t ? `Modèle « ${t.nom} »` : "Nouveau modèle PDF";
  $("#btnSupprimerTheme").hidden = !t;
  $("#btnDupliquerTheme").hidden = !t;
  $("#erreurModele").textContent = "";
  f.nom.value = t?.nom || "";
  f.couleur.value = t?.couleur || "#15291F";
  f.couleurPicker.value = /^#[0-9a-f]{6}$/i.test(f.couleur.value) ? f.couleur.value : "#15291F";
  f.titre.value = t?.titre || "";
  f.sousTitre.value = t?.sousTitre || "";
  f.piedPage.value = t?.piedPage || "";
  f.tailleLogo.value = t?.tailleLogo ?? 60;
  f.tailleTitre.value = t?.tailleTitre ?? 16;
  remplirContenu(t || {});
  logoEnCours = t?.logo || null;
  ongletModele("contenu");
  apercuTheme();

  for (;;) {
    const r = await ouvrirDialogue($("#dlgTheme"));
    if (r === "dupliquer" && t) {
      // Copie du modèle tel qu'il est enregistré, ouverte aussitôt pour la modifier
      await dupliquerModele(t);
      return;
    }
    if (r === "supprimer" && t) {
      const nb = state.courses.filter((c) => c.themeId === t.id).length;
      if (!await confirmer("Supprimer le modèle", `Supprimer le modèle « ${t.nom} » ?` + (nb ? `\n\n${nb} course(s) l'utilisent : elles reprendront la mise en page par défaut.` : ""), { oui: "Supprimer", danger: true })) return;
      state.themes = state.themes.filter((x) => x.id !== t.id);
      state.courses.forEach((c) => { if (c.themeId === t.id) c.themeId = null; });
      await store.sauver();
      rendre();
      return;
    }
    if (r !== "ok" || !f.nom.value.trim()) return;
    if (!edition.sections.length) {
      $("#erreurModele").textContent = "Glissez au moins un classement sur la page.";
      ongletModele("contenu");
      continue; // on rouvre, saisie conservée
    }
    break;
  }
  const valeurs = {
    nom: f.nom.value.trim(),
    couleur: /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(f.couleur.value) ? f.couleur.value : "#15291F",
    logo: logoEnCours, titre: f.titre.value.trim(), sousTitre: f.sousTitre.value.trim(), piedPage: f.piedPage.value.trim(),
    // Ordre des classements ; les cases d'origine restent renseignées pour les anciennes versions
    sections: [...edition.sections],
    classementGeneral: edition.sections.includes("general"),
    classementSexe: edition.sections.includes("sexe"),
    classementCategorie: edition.sections.includes("categorie"),
    afficherEcoles: edition.sections.includes("ecole"),
    afficherClubs: edition.sections.includes("club"),
    ecoleNb: Math.min(10, Math.max(1, parseInt(f.ecoleNb.value, 10) || 3)),
    ecoleMode: ["places", "temps", "nombre"].includes(f.ecoleMode.value) ? f.ecoleMode.value : "temps",
    podiums: edition.sections.includes("podiums"),
    podiumsSansCumul: edition.podiumsSansCumul,
    colonnes: [...edition.colonnes],
    paysage: !!f.paysage.value,
    tailleLogo: Math.min(200, Math.max(20, parseInt(f.tailleLogo.value, 10) || 60)),
    tailleTitre: Math.min(48, Math.max(8, parseInt(f.tailleTitre.value, 10) || 16)),
  };
  if (t) Object.assign(t, valeurs);
  else state.themes.push({ id: uid(), defaut: false, ...valeurs });
  await store.sauver();
  rendre();
  toast(t ? "Modèle modifié." : "Modèle créé.");
}

$("#btnNouveauTheme").addEventListener("click", () => editerTheme(null));

/** Copie un modèle (« Nom (copie) ») et ouvre la copie dans l'éditeur. */
async function dupliquerModele(t) {
  const noms = new Set(state.themes.map((x) => x.nom));
  const base = t.nom.replace(/ \(copie(?: \d+)?\)$/, ""); // copie d'une copie : « Nom (copie 2) »
  let nom = `${base} (copie)`;
  for (let k = 2; noms.has(nom); k++) nom = `${base} (copie ${k})`;
  const copie = { ...structuredClone(t), id: uid(), defaut: false, nom };
  state.themes.push(copie);
  await store.sauver();
  rendre();
  toast(`Modèle « ${nom} » créé.`);
  editerTheme(copie);
}
$("#grilleThemes").addEventListener("click", async (e) => {
  const b = e.target.closest(".theme-card");
  if (!b) return;
  const t = theme(b.dataset.id);
  if (t?.defaut) {
    if (await confirmer("Modèle par défaut", "Le modèle par défaut n'est pas modifiable.\n\nLe dupliquer pour en faire un modèle à vous ?", { oui: "Dupliquer" })) dupliquerModele(t);
    return;
  }
  editerTheme(t);
});

$("#formTheme").addEventListener("input", (e) => {
  const f = e.currentTarget;
  if (e.target.name === "couleurPicker") f.couleur.value = f.couleurPicker.value.toUpperCase();
  if (e.target.name === "couleur" && /^#[0-9a-f]{6}$/i.test(f.couleur.value)) f.couleurPicker.value = f.couleur.value;
  apercuTheme();
});
$("#formTheme").addEventListener("change", () => apercuTheme());

$("#btnLogo").addEventListener("click", () => $("#fichierLogo").click());
$("#btnLogoRetirer").addEventListener("click", () => { logoEnCours = null; apercuTheme(); });

/** Le logo est redimensionné (600 px max) et converti en PNG : léger à stocker, toujours lisible par le PDF. */
$("#fichierLogo").addEventListener("change", (e) => {
  const fichier = e.target.files[0];
  e.target.value = "";
  if (!fichier) return;
  const img = new Image();
  const url = URL.createObjectURL(fichier);
  img.onload = () => {
    const r = Math.min(1, 600 / Math.max(img.width, img.height));
    const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(img.width * r), height: Math.round(img.height * r) });
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    logoEnCours = canvas.toDataURL("image/png");
    URL.revokeObjectURL(url);
    apercuTheme();
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast("Image illisible.", "err"); };
  img.src = url;
});

$("#btnModele").addEventListener("click", () => {
  try { excel.telechargerModele(); } catch (err) { toast(err.message, "err"); }
});

// La sauvegarde contient tout, archives comprises (leur PDF y est encodé en texte)
const blobEnTexte = (blob) => new Promise((resolve, reject) => {
  const lecteur = new FileReader();
  lecteur.onload = () => resolve(lecteur.result);
  lecteur.onerror = () => reject(lecteur.error);
  lecteur.readAsDataURL(blob);
});
const texteEnBlob = (texte) => fetch(texte).then((r) => r.blob());

$("#btnSauvegarde").addEventListener("click", async () => {
  const archives = await Promise.all((await store.archives.lister()).map(async ({ blob, ...a }) => ({ ...a, pdf: await blobEnTexte(blob) })));
  const blob = new Blob([JSON.stringify({ application: "loopace-chrono", exporte: new Date().toISOString(), ...state, archives }, null, 1)], { type: "application/json" });
  telecharger(blob, nomFichier("Sauvegarde_", "Loopace_Chrono", "json"));
  toast(`Sauvegarde exportée : ${state.courses.length} course(s), ${archives.length} archive(s).`);
});

$("#btnRestaurer").addEventListener("click", () => $("#fichierRestaurer").click());
$("#fichierRestaurer").addEventListener("change", async (e) => {
  const fichier = e.target.files[0];
  e.target.value = "";
  if (!fichier) return;
  let data;
  try {
    data = JSON.parse(await fichier.text());
    if (data.application !== "loopace-chrono" || !Array.isArray(data.courses) || !Array.isArray(data.inscrits)) throw new Error();
  } catch { toast("Ce fichier n'est pas une sauvegarde Loopace Chrono.", "err"); return; }
  const archives = Array.isArray(data.archives) ? data.archives : [];
  const ok = await confirmer("Restaurer une sauvegarde", `Remplacer les courses et réglages actuels par la sauvegarde (${data.courses.length} course(s), ${data.inscrits.length} participant(s), ${archives.length} archive(s)) ?\n\nLes archives de la sauvegarde sont ajoutées à celles déjà présentes.`, { oui: "Restaurer", danger: true });
  if (!ok) return;
  await store.remplacer({ version: 1, courses: data.courses, inscrits: data.inscrits, themes: data.themes || [], baremes: data.baremes || {} });
  for (const { pdf, ...a } of archives) {
    if (a.id && pdf) await store.archives.ajouter({ ...a, blob: await texteEnBlob(pdf) });
  }
  baremeModifie = false;
  courseSel = chronoSel = resultatsSel = null;
  rendre();
  toast("Sauvegarde restaurée.");
});

$("#btnDemo").addEventListener("click", async () => {
  const id = uid();
  state.courses.push({ id, nom: "Cross de démonstration", date: new Date().toISOString().slice(0, 10), heure: "10:00", lieu: "Stade municipal", distance: 2.4, type: "Cross", themeId: THEME_DEFAUT_ID, categories: "unss", categoriesSexe: true, chrono: { etat: "attente", depart: null, fin: null } });
  const ecoles = ["Collège Vauban", "Lycée Jean Moulin", "Collège Jules Ferry", "AS Loopace"];
  const prenoms = ["Marie", "Thomas", "Léa", "Hugo", "Chloé", "Lucas", "Emma", "Nathan", "Inès", "Louis", "Jade", "Gabriel", "Lina", "Arthur", "Zoé", "Jules"];
  const noms = ["Dupont", "Martin", "Bernard", "Petit", "Durand", "Moreau", "Laurent", "Simon", "Michel", "Lefebvre", "Garcia", "Roux", "Fournier", "Girard", "Bonnet", "Mercier"];
  prenoms.forEach((p, k) => state.inscrits.push({
    id: uid(), courseId: id, dossard: String(101 + k), nom: noms[k], prenom: p, sexe: k % 2 ? "M" : "F", annee: 2010 + (k % 4),
    ecole: ecoles[k % ecoles.length], categorie: "", telephone: "", bulletin: k !== 7, depart: null, arrivee: null, statut: null,
  }));
  calc.appliquerCategories(id);
  await store.sauver();
  courseSel = id;
  reinitialiserFiltres();
  location.hash = "#courses";
  rendre();
  toast("Course de démonstration créée (16 participants).");
});

// ── Thème clair / sombre, partagé avec les autres sites Loopace ─
$("#themeToggle").addEventListener("click", () => {
  const clair = document.documentElement.dataset.theme !== "light";
  if (clair) document.documentElement.dataset.theme = "light"; else delete document.documentElement.dataset.theme;
  try { localStorage.setItem("loopace-theme", clair ? "light" : "dark"); } catch { /* stockage indisponible */ }
});

// ── Installation en application (Chrome / Edge sur PC) ───────
// Le navigateur propose l'installation quand le site est servi en http(s) avec son manifeste et son service worker.
let invitationInstall = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  invitationInstall = e;
  $("#btnInstaller").hidden = false;
});
$("#btnInstaller").addEventListener("click", async () => {
  if (!invitationInstall) return;
  invitationInstall.prompt();
  await invitationInstall.userChoice;
  invitationInstall = null;
  $("#btnInstaller").hidden = true;
});
window.addEventListener("appinstalled", () => {
  $("#btnInstaller").hidden = true;
  toast("Loopace Chrono est installé : lancez-le depuis le menu Démarrer ou le bureau.");
});

// ── Démarrage ────────────────────────────────────────────────
// Raccourci : depuis n'importe où dans l'onglet Chronomètre, taper un chiffre va dans la saisie du dossard
document.addEventListener("keydown", (e) => {
  if (vue !== "chrono" || e.ctrlKey || e.metaKey || e.altKey || document.querySelector("dialog[open]")) return;
  const champ = $("#saisieDossard");
  if (/^[0-9]$/.test(e.key) && document.activeElement !== champ && !champ.disabled && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName)) champ.focus();
});

window.addEventListener("beforeunload", (e) => {
  if (state.courses.some((c) => calc.etatChrono(c).etat === "en-cours")) e.preventDefault();
});

try {
  await store.init();
} catch (err) {
  document.querySelector(".main").innerHTML = `<div class="card"><h2>Stockage indisponible</h2><p class="meta">Ce navigateur bloque l'enregistrement local (navigation privée ?). Loopace Chrono ne peut pas fonctionner sans.</p></div>`;
  throw err;
}
store.onExterne((quoi) => { if (quoi !== "selection") rendre(); });

/**
 * Mise à jour automatique des barèmes de catégories : le site publie baremes.json ; à chaque lancement
 * (avec du réseau, sinon depuis le cache hors ligne) on le charge, et si sa version est nouvelle, les courses
 * pas encore parties sont recalculées. Les barèmes modifiés à la main dans Administration restent prioritaires.
 */
async function majBaremes() {
  let data;
  try {
    const r = await fetch("baremes.json", { cache: "no-cache" });
    if (!r.ok) return;
    data = await r.json();
    if (!data?.version || typeof data.baremes !== "object") return;
  } catch { return; } // hors ligne sans cache : barèmes intégrés
  calc.definirBaremesOfficiels(data);
  if (state.baremesVersion !== data.version) {
    const premiere = state.baremesVersion == null;
    let modifiees = 0;
    Object.keys(data.baremes).filter((cle) => !state.baremes?.[cle])
      .forEach((cle) => { modifiees += calc.recalculerBareme(cle, true).modifiees; });
    state.baremesVersion = data.version;
    await store.sauver();
    if (!premiere || modifiees) toast(`Catégories mises à jour automatiquement (barèmes du ${fmtDate(data.version)})` + (modifiees ? ` : ${modifiees} catégorie(s) recalculée(s) dans les courses à venir.` : "."));
  }
  if (!baremeModifie) chargerBareme();
  rendre();
}
window.addEventListener("hashchange", naviguer);
naviguer();
majBaremes();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
