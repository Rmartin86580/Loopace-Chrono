// Loopace Chrono — interface : onglets Courses, Chronomètre, Résultats, Archives, Administration.

import * as store from "./store.js";
import { state, uid, course, inscritsDe, theme, coursesTriees, THEME_DEFAUT_ID } from "./store.js";
import * as calc from "./calc.js";
import { fmtDuree, fmtHeure, fmtDate, nomComplet, compareDossard } from "./calc.js";
import * as excel from "./excel.js";
import { genererPdf, nomFichier } from "./pdf.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
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
  $("#metaCourse").textContent = [fmtDate(c.date), c.heure && `départ ${c.heure}`, c.lieu, c.distance && `${String(c.distance).replace(".", ",")} km`, c.type, th && `thème « ${th.nom} »`].filter(Boolean).join(" · ");

  const tous = inscritsDe(c.id).sort((a, b) =>
    (a.ecole || "").localeCompare(b.ecole || "", "fr") || (a.nom || "").localeCompare(b.nom || "", "fr") || (a.prenom || "").localeCompare(b.prenom || "", "fr"));
  const q = recherche.trim().toLowerCase();
  const vus = q ? tous.filter((i) => [i.dossard, i.nom, i.prenom, i.ecole, i.categorie].some((v) => String(v ?? "").toLowerCase().includes(q))) : tous;

  const nbBulletins = tous.filter((i) => i.bulletin).length;
  $("#statsParticipants").textContent = `${tous.length} inscrit(s) · ${nbBulletins} bulletin(s) complet(s)` + (q ? ` · ${vus.length} affiché(s)` : "");
  $("#tableParticipants").innerHTML = vus.length ? vus.map((i) => `<tr data-id="${i.id}">
      <td><b>${esc(i.dossard) || '<span class="muted">—</span>'}</b></td><td>${esc(i.nom)}</td><td>${esc(i.prenom)}</td><td>${esc(i.sexe)}</td>
      <td>${esc(i.annee)}</td><td>${esc(i.ecole)}</td><td>${esc(i.categorie)}</td><td>${esc(i.telephone)}</td>
      <td class="c"><input type="checkbox" class="toggle-bulletin" aria-label="Bulletin complet" ${i.bulletin ? "checked" : ""}></td></tr>`).join("")
    : `<tr><td colspan="9" class="muted c">${tous.length ? "Aucun résultat pour cette recherche." : "Aucun participant : ajoutez-en ou importez un fichier Excel."}</td></tr>`;

  const vide = tous.length === 0;
  $("#btnExporterParticipants").disabled = vide;
  $("#btnDossards").disabled = vide;
}

$("#listeCourses").addEventListener("click", (e) => {
  const b = e.target.closest(".course-item");
  if (!b) return;
  courseSel = b.dataset.id;
  recherche = "";
  $("#rechercheParticipant").value = "";
  rendreCourses();
});

$("#rechercheParticipant").addEventListener("input", (e) => { recherche = e.target.value; rendreCourses(); });

function optionsThemes(select, idChoisi) {
  const themes = [...state.themes].sort((a, b) => (b.defaut - a.defaut) || a.nom.localeCompare(b.nom, "fr"));
  select.innerHTML = `<option value="">Aucun (mise en page par défaut)</option>` +
    themes.map((t) => `<option value="${t.id}"${t.id === idChoisi ? " selected" : ""}>${esc(t.nom)}</option>`).join("");
}

async function editerCourse(c) {
  const f = $("#formCourse");
  $("#dlgCourseTitre").textContent = c ? "Modifier la course" : "Nouvelle course";
  f.nom.value = c?.nom || "";
  f.date.value = c ? c.date || "" : new Date().toISOString().slice(0, 10);
  f.heure.value = c?.heure || "";
  f.lieu.value = c?.lieu || "";
  f.distance.value = c?.distance != null ? String(c.distance).replace(".", ",") : "";
  f.type.value = c?.type || "";
  optionsThemes($("#selectTheme"), c ? c.themeId : THEME_DEFAUT_ID);
  // Nouvelle course : catégories FFA par défaut ; course existante : son réglage (saisie libre si jamais réglé)
  const bareme = c ? c.categories || "libre" : "ffa";
  $("#selectBareme").innerHTML = Object.entries(calc.BAREMES).map(([cle, b]) => `<option value="${cle}"${cle === bareme ? " selected" : ""}>${b.nom}</option>`).join("");
  f.categoriesSexe.checked = !!c?.categoriesSexe;
  aideCategories();

  if (await ouvrirDialogue($("#dlgCourse")) !== "ok") return;
  const nom = f.nom.value.trim();
  if (!nom) return;
  const distance = parseFloat(f.distance.value.replace(",", "."));
  const valeurs = {
    nom, date: f.date.value || null, heure: f.heure.value || null, lieu: f.lieu.value.trim(),
    distance: Number.isFinite(distance) ? distance : null, type: f.type.value.trim(), themeId: f.themeId.value || null,
    categories: f.categories.value, categoriesSexe: f.categoriesSexe.checked,
  };
  let cible = c;
  if (c) Object.assign(c, valeurs);
  else {
    cible = { id: uid(), ...valeurs, chrono: { etat: "attente", depart: null, fin: null } };
    state.courses.push(cible);
    courseSel = cible.id;
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
$("#btnDupliquerCourse").addEventListener("click", async () => {
  const c = course(courseSel);
  if (!c) return;
  const f = $("#formDupliquer");
  const nb = calc.nbInscrits(c.id);
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
  state.courses.push(copie);
  let n = 0;
  if (f.participants.checked) {
    inscritsDe(c.id).forEach((i) => {
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
  recherche = "";
  $("#rechercheParticipant").value = "";
  await store.sauver();
  rendre();
  toast(`Course « ${copie.nom} » créée` + (n ? ` avec ${n} participant(s)` : "") + "." + (recalculees ? ` ${recalculees} catégorie(s) recalculée(s).` : ""));
});

// ── Participants ─────────────────────────────────────────────
function dossardPris(courseId, dossard, saufId) {
  return inscritsDe(courseId).some((i) => i.id !== saufId && i.dossard && dossard && String(i.dossard).trim() === dossard);
}

function remplirListes(courseId) {
  const uniques = (cle) => [...new Set(state.inscrits.map((i) => i[cle]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  $("#listeEcoles").innerHTML = uniques("ecole").map((v) => `<option value="${esc(v)}">`).join("");
  $("#listeCategories").innerHTML = uniques("categorie").map((v) => `<option value="${esc(v)}">`).join("");
}

async function editerParticipant(i) {
  const c = course(courseSel);
  if (!c) return;
  const f = $("#formParticipant");
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
  f.categorie.value = i?.categorie || "";
  f.telephone.value = i?.telephone || "";
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
      sexe: f.sexe.value, ecole: f.ecole.value.trim(), categorie: f.categorie.value.trim(), telephone: f.telephone.value.trim(), bulletin: f.bulletin.checked,
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

$("#btnImporter").addEventListener("click", () => $("#fichierImport").click());
$("#fichierImport").addEventListener("change", async (e) => {
  const fichier = e.target.files[0];
  e.target.value = "";
  const c = course(courseSel);
  if (!fichier || !c) return;

  let lignes;
  try { lignes = await excel.lireParticipants(fichier); }
  catch (err) { toast(`Impossible de lire le fichier : ${err.message}`, "err"); return; }
  if (!lignes.length) { toast("Aucune ligne trouvée dans le fichier.", "warn"); return; }

  let importes = 0, ignores = 0;
  const erreurs = [];
  lignes.forEach((l) => {
    if (!l.nom) { ignores++; return; }
    const dossard = l.dossard || null;
    if (dossard && dossardPris(c.id, dossard)) {
      erreurs.push(`Dossard ${dossard} (${l.prenom} ${l.nom}) déjà attribué`);
      ignores++;
      return;
    }
    const categorie = calc.categorieAuto(c, l.annee, l.sexe) || l.categorie;
    state.inscrits.push({ id: uid(), courseId: c.id, ...l, categorie, dossard, depart: null, arrivee: null, statut: null });
    importes++;
  });
  await store.sauver();
  rendre();
  let msg = `${importes} participant(s) importé(s).`;
  if (ignores) msg += ` ${ignores} ligne(s) ignorée(s).`;
  toast(msg, erreurs.length ? "warn" : "ok");
  if (erreurs.length) await confirmer("Lignes ignorées", erreurs.join("\n"), { oui: "OK" });
});

$("#btnExporterParticipants").addEventListener("click", () => {
  const c = course(courseSel);
  if (!c) return;
  const liste = inscritsDe(c.id).sort((a, b) => compareDossard(a.dossard, b.dossard));
  try { excel.exporterParticipants(nomFichier("Participants_", c.nom, "xlsx"), liste); }
  catch (err) { toast(err.message, "err"); }
});

$("#btnDossards").addEventListener("click", async () => {
  const c = course(courseSel);
  if (!c) return;
  // Seuls les bulletins complets encore sans dossard sont numérotés : les dossards déjà donnés ne bougent pas
  const tous = inscritsDe(c.id);
  const aNumeroter = tous.filter((i) => i.bulletin && !i.dossard).sort((a, b) =>
    (a.ecole || "").localeCompare(b.ecole || "", "fr") || (a.nom || "").localeCompare(b.nom || "", "fr") || (a.prenom || "").localeCompare(b.prenom || "", "fr"));
  if (!aNumeroter.length) {
    toast(tous.some((i) => i.bulletin) ? "Tous les bulletins complets ont déjà un dossard." : "Aucun bulletin complet : aucun dossard à attribuer.", "warn");
    return;
  }
  // Numéros déjà pris dans la course (comparés en nombre : « 007 » occupe le 7), et première proposition à la suite
  const pris = new Set(tous.filter((i) => i.dossard && /^\d+$/.test(String(i.dossard).trim())).map((i) => Number(i.dossard)));
  const dlg = $("#dlgDossards");
  dlg.querySelector("[name=debut]").value = pris.size ? Math.max(...pris) + 1 : 1;
  $("#dossardsResume").textContent = `${aNumeroter.length} participant(s) à numéroter` +
    (tous.length - aNumeroter.length ? ` · ${tous.filter((i) => i.dossard).length} dossard(s) déjà donné(s), conservé(s)` : "") + ".";
  if (await ouvrirDialogue(dlg) !== "ok") return;
  let n = parseInt(dlg.querySelector("[name=debut]").value, 10);
  if (!Number.isFinite(n)) return;
  const numeros = [];
  aNumeroter.forEach((i) => {
    while (pris.has(n)) n++; // on saute les numéros déjà attribués
    i.dossard = String(n);
    pris.add(n);
    numeros.push(n);
  });
  await store.sauver();
  rendre();
  const sautes = numeros[numeros.length - 1] - numeros[0] + 1 - numeros.length;
  toast(`${numeros.length} dossard(s) attribué(s), de ${numeros[0]} à ${numeros[numeros.length - 1]}` +
    (sautes ? ` (${sautes} numéro(s) déjà pris sauté(s))` : "") + ". Les dossards existants n'ont pas changé.");
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
      <td><b>${pos ?? "DNF"}</b></td><td><b>${esc(i.dossard)}</b></td><td>${esc(nomComplet(i))}</td><td>${esc(i.ecole)}</td>
      <td>${fmtHeure(i.arrivee) || "-"}</td><td class="r mono"><b>${pos == null ? "DNF" : fmtDuree(calc.duree(i))}</b></td></tr>`).join("")
    : `<tr><td colspan="6" class="muted c">Les arrivées s'afficheront ici.</td></tr>`;
  const sc = $("#scrollClassement");
  sc.scrollTop = sc.scrollHeight;

  const attente = etat === "attente" && s ? s.avecBulletin.sort((a, b) => compareDossard(a.dossard, b.dossard)) : s?.enCours || [];
  $("#nbEnCours").textContent = s ? String(attente.length) : "";
  $("#listeEnCours").innerHTML = attente.map((i) => `<li><b>${esc(i.dossard) || "—"}</b><span>${esc(nomComplet(i))}</span><em>${esc(i.ecole)}</em></li>`).join("")
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

  $$(".seg__btn").forEach((b) => b.classList.toggle("is-on", b.dataset.seg === segment));
  $("#segIndividuel").hidden = segment !== "individuel";
  $("#segEcoles").hidden = segment !== "ecoles";

  $("#tableResultats").innerHTML = !vide ? res.individuel.map((l) => `<tr class="${l.dnf ? "is-dnf" : l.enCours ? "is-wait" : +l.position <= 3 ? `podium podium--${l.position}` : ""}">
      <td><b>${l.position}</b></td><td><b>${esc(l.dossard)}</b></td><td>${esc(l.nom)}</td><td>${esc(l.prenom)}</td><td>${esc(l.ecole)}</td>
      <td>${esc(l.categorie)}</td><td>${esc(l.sexe)}</td><td>${esc(l.naissance)}</td><td class="r mono"><b>${l.enCours ? "En course" : l.temps}</b></td></tr>`).join("")
    : `<tr><td colspan="9" class="muted c">Pas encore de résultats.</td></tr>`;

  $("#segEcoles").innerHTML = res?.ecoles.length ? res.ecoles.map((g) => `<article class="ecole">
      <header class="ecole__head">
        <span class="ecole__rang${g.rang <= 3 ? ` ecole__rang--${g.rang}` : ""}">${g.rang}</span>
        <h3>${esc(g.ecole)}</h3>
        <span class="meta">${g.nbFinishers} classé(s)${g.nbDnf ? ` · ${g.nbDnf} DNF` : ""} · top 3 : <b>${g.sommeTxt}</b></span>
      </header>
      <div class="table-wrap"><table class="table table--compact table--nowrap">
        <thead><tr><th>#École</th><th>#Gén.</th><th>Dossard</th><th>Nom</th><th>Prénom</th><th>Catégorie</th><th>Sexe</th><th class="r">Temps</th></tr></thead>
        <tbody>${g.participants.map((l) => `<tr class="${l.dnf ? "is-dnf" : l.rangEcole <= 3 ? `podium podium--${l.rangEcole}` : ""}">
          <td><b>${l.dnf ? "DNF" : l.rangEcole}</b></td><td>${l.position}</td><td>${esc(l.dossard)}</td><td>${esc(l.nom)}</td><td>${esc(l.prenom)}</td>
          <td>${esc(l.categorie)}</td><td>${esc(l.sexe)}</td><td class="r mono"><b>${l.temps}</b></td></tr>`).join("")}</tbody>
      </table></div>
    </article>`).join("") : `<p class="muted">Le classement par école apparaît dès les premières arrivées. Une école est classée à la somme des temps de ses 3 premiers.</p>`;
}

$("#resultatsCourse").addEventListener("change", (e) => { resultatsSel = e.target.value || null; rendreResultats(); });
$$(".seg__btn").forEach((b) => b.addEventListener("click", () => { segment = b.dataset.seg; rendreResultats(); }));

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
  const ok = await confirmer("Archiver la course", `Archiver et supprimer « ${c.nom} » ?\n\nLe PDF des résultats est conservé dans l'onglet Archives, puis la course et ses participants sont supprimés définitivement.`, { oui: "Archiver", danger: true });
  if (!ok) return;
  try {
    const blob = pdfCourse(c);
    await store.archives.ajouter({ id: uid(), nom: c.nom, fichier: nomFichier("", c.nom, "pdf"), date: Date.now(), taille: blob.size, blob });
    await supprimerCourse(c.id);
    if (courseSel === c.id) courseSel = null;
    rendre();
    toast("Course archivée : retrouvez le PDF dans l'onglet Archives.");
  } catch (err) {
    toast(`Erreur lors de l'archivage : ${err.message}`, "err");
  }
});

// ══════════════════════════════════════════════════════════════
// ARCHIVES
// ══════════════════════════════════════════════════════════════
const taille = (o) => (o < 1024 * 1024 ? `${Math.max(1, Math.round(o / 1024))} Ko` : `${(o / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`);
let cacheArchives = [];

async function rendreArchives() {
  cacheArchives = await store.archives.lister();
  $("#tableArchives").innerHTML = cacheArchives.length ? cacheArchives.map((a) => `<tr data-id="${a.id}">
      <td><b>${esc(a.nom)}</b><br><small class="muted">${esc(a.fichier)}</small></td>
      <td>${new Date(a.date).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</td><td>${taille(a.taille)}</td>
      <td class="r"><span class="actions actions--end">
        <button class="btn btn--ghost btn--sm" data-act="ouvrir"><svg class="ico"><use href="#i-open"/></svg>Ouvrir</button>
        <button class="btn btn--ghost btn--sm" data-act="dl"><svg class="ico"><use href="#i-download"/></svg>Télécharger</button>
        <button class="btn btn--ghost btn--sm btn--danger" data-act="suppr" aria-label="Supprimer"><svg class="ico"><use href="#i-trash"/></svg></button>
      </span></td></tr>`).join("")
    : `<tr><td colspan="4" class="muted c">Aucune archive. « Archiver la course » dans l'onglet Résultats enregistre ici son PDF.</td></tr>`;
}

$("#tableArchives").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const a = cacheArchives.find((x) => x.id === b.closest("tr").dataset.id);
  if (!a) return;
  if (b.dataset.act === "ouvrir") {
    const url = URL.createObjectURL(a.blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } else if (b.dataset.act === "dl") {
    telecharger(a.blob, a.fichier);
  } else if (await confirmer("Supprimer l'archive", `Supprimer définitivement l'archive « ${a.nom} » ?`, { oui: "Supprimer", danger: true })) {
    await store.archives.supprimer(a.id);
    rendreArchives();
  }
});

// ══════════════════════════════════════════════════════════════
// ADMINISTRATION
// ══════════════════════════════════════════════════════════════
function rendreAdmin() {
  const themes = [...state.themes].sort((a, b) => (b.defaut - a.defaut) || a.nom.localeCompare(b.nom, "fr"));
  $("#grilleThemes").innerHTML = themes.map((t) => {
    const nb = state.courses.filter((c) => c.themeId === t.id).length;
    return `<button class="theme-card" data-id="${t.id}" ${t.defaut ? 'aria-disabled="true"' : ""}>
      <span class="theme-card__band" style="background:${esc(t.couleur)}">${t.logo ? `<img src="${t.logo}" alt="">` : ""}</span>
      <span class="theme-card__body"><b>${esc(t.nom)}</b><small>${t.defaut ? "Thème par défaut (non modifiable)" : esc(t.titre || "Sans titre")}</small><small>${nb} course(s)</small></span>
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
  $("#admSaisonRef").textContent = `Années de naissance pour la saison ${civile ? ref : `${ref - 1}-${ref}`}. Laissez « Nés de » vide pour « et avant », « à » vide pour « et après ».`;
  const chip = $("#admEtatBareme");
  const version = calc.versionBaremes();
  chip.textContent = baremeModifie ? "Modifications non enregistrées"
    : perso ? `Modifié à la main le ${new Date(perso.modifie).toLocaleDateString("fr-FR")}`
    : version ? `Barème officiel à jour (version du ${fmtDate(version)})` : "Barème intégré";
  chip.className = `chip${baremeModifie ? " chip--en-cours" : perso ? " chip--arretee" : ""}`;
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
  const chip = $("#admEtatBareme");
  chip.textContent = "Modifications non enregistrées";
  chip.className = "chip chip--en-cours";
  $("#btnRetablirBareme").disabled = false;
}

$("#admBareme").addEventListener("change", async (e) => {
  if (baremeModifie && !await confirmer("Changer de barème", "Les modifications non enregistrées de ce barème seront perdues.", { oui: "Continuer" })) {
    e.target.value = baremeCle;
    return;
  }
  baremeCle = e.target.value;
  chargerBareme();
});
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
  chargerBareme();
  toast(`Barème ${calc.BAREMES[baremeCle].nom.replace("Automatique — ", "")} enregistré.` +
    (r.courses ? ` ${r.courses} course(s) recalculée(s), ${r.modifiees} catégorie(s) changée(s).` : ""));
});

$("#btnRetablirBareme").addEventListener("click", async () => {
  if (!state.baremes?.[baremeCle]) { chargerBareme(); return; } // seulement des modifications non enregistrées
  if (!await confirmer("Revenir au barème officiel", "Abandonner la modification manuelle et revenir au barème officiel, mis à jour automatiquement ? Les courses qui l'utilisent seront recalculées.", { oui: "Revenir au barème officiel" })) return;
  delete state.baremes[baremeCle];
  const r = calc.recalculerBareme(baremeCle);
  await store.sauver();
  chargerBareme();
  toast("Barème officiel rétabli : il suivra de nouveau les mises à jour automatiques." + (r.modifiees ? ` ${r.modifiees} catégorie(s) changée(s).` : ""));
});

let logoEnCours = null;

function apercuTheme() {
  const f = $("#formTheme");
  const couleur = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(f.couleur.value) ? f.couleur.value : "#15291F";
  $("#apercuMarque").style.color = couleur;
  $("#apercuSection").style.color = couleur;
  $("#apercuTrait").style.background = couleur;
  $("#apercuTitre").textContent = f.titre.value.trim() || "Nom de la course";
  $("#apercuTitre").style.fontSize = `${Math.min(26, Math.max(10, +f.tailleTitre.value || 16))}px`;
  $("#apercuSous").textContent = f.sousTitre.value.trim();
  const img = $("#apercuLogo");
  img.hidden = !logoEnCours;
  if (logoEnCours) { img.src = logoEnCours; img.style.width = img.style.height = `${Math.min(80, Math.max(16, (+f.tailleLogo.value || 60) * 0.6))}px`; }
  $("#btnLogoRetirer").hidden = !logoEnCours;
}

async function editerTheme(t) {
  const f = $("#formTheme");
  $("#dlgThemeTitre").textContent = t ? `Thème « ${t.nom} »` : "Nouveau thème PDF";
  $("#btnSupprimerTheme").hidden = !t;
  f.nom.value = t?.nom || "";
  f.couleur.value = t?.couleur || "#15291F";
  f.couleurPicker.value = /^#[0-9a-f]{6}$/i.test(f.couleur.value) ? f.couleur.value : "#15291F";
  f.titre.value = t?.titre || "";
  f.sousTitre.value = t?.sousTitre || "";
  f.piedPage.value = t?.piedPage || "";
  f.tailleLogo.value = t?.tailleLogo ?? 60;
  f.tailleTitre.value = t?.tailleTitre ?? 16;
  f.afficherEcoles.checked = t ? t.afficherEcoles !== false : true;
  logoEnCours = t?.logo || null;
  apercuTheme();

  const r = await ouvrirDialogue($("#dlgTheme"));
  if (r === "supprimer" && t) {
    const nb = state.courses.filter((c) => c.themeId === t.id).length;
    if (!await confirmer("Supprimer le thème", `Supprimer le thème « ${t.nom} » ?` + (nb ? `\n\n${nb} course(s) l'utilisent : elles reprendront la mise en page par défaut.` : ""), { oui: "Supprimer", danger: true })) return;
    state.themes = state.themes.filter((x) => x.id !== t.id);
    state.courses.forEach((c) => { if (c.themeId === t.id) c.themeId = null; });
    await store.sauver();
    rendre();
    return;
  }
  if (r !== "ok" || !f.nom.value.trim()) return;
  const valeurs = {
    nom: f.nom.value.trim(),
    couleur: /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(f.couleur.value) ? f.couleur.value : "#15291F",
    logo: logoEnCours, titre: f.titre.value.trim(), sousTitre: f.sousTitre.value.trim(), piedPage: f.piedPage.value.trim(),
    afficherEcoles: f.afficherEcoles.checked,
    tailleLogo: Math.min(200, Math.max(20, parseInt(f.tailleLogo.value, 10) || 60)),
    tailleTitre: Math.min(48, Math.max(8, parseInt(f.tailleTitre.value, 10) || 16)),
  };
  if (t) Object.assign(t, valeurs);
  else state.themes.push({ id: uid(), defaut: false, ...valeurs });
  await store.sauver();
  rendre();
  toast(t ? "Thème modifié." : "Thème créé.");
}

$("#btnNouveauTheme").addEventListener("click", () => editerTheme(null));
$("#grilleThemes").addEventListener("click", (e) => {
  const b = e.target.closest(".theme-card");
  if (!b) return;
  const t = theme(b.dataset.id);
  if (t?.defaut) { toast("Le thème par défaut n'est pas modifiable : créez un nouveau thème.", "warn"); return; }
  editerTheme(t);
});

$("#formTheme").addEventListener("input", (e) => {
  const f = e.currentTarget;
  if (e.target.name === "couleurPicker") f.couleur.value = f.couleurPicker.value.toUpperCase();
  if (e.target.name === "couleur" && /^#[0-9a-f]{6}$/i.test(f.couleur.value)) f.couleurPicker.value = f.couleur.value;
  apercuTheme();
});

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

$("#btnSauvegarde").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ application: "loopace-chrono", exporte: new Date().toISOString(), ...state }, null, 1)], { type: "application/json" });
  telecharger(blob, nomFichier("Sauvegarde_", "Loopace_Chrono", "json"));
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
  const ok = await confirmer("Restaurer une sauvegarde", `Remplacer toutes les données actuelles par la sauvegarde (${data.courses.length} course(s), ${data.inscrits.length} participant(s)) ?\n\nLes archives PDF ne sont pas touchées.`, { oui: "Restaurer", danger: true });
  if (!ok) return;
  await store.remplacer({ version: 1, courses: data.courses, inscrits: data.inscrits, themes: data.themes || [], baremes: data.baremes || {} });
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
