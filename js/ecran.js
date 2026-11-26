// Écran public : grand chronomètre et classement en direct de la course choisie dans l'onglet Chronomètre.
// Lecture seule ; il se met à jour quand l'application principale enregistre (BroadcastChannel).

import * as store from "./store.js?v=30";
import { state, course, evenement, coursesDe, nomCourse } from "./store.js?v=30";
import * as calc from "./calc.js?v=30";
import { fmtDuree, nomComplet, compareDossard } from "./calc.js?v=30";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ETATS = { "attente": "En attente", "en-cours": "En course", "arretee": "Terminée" };

const CLE_COURSE = `${store.BASE}-course`;
let courseId = null;
let nbLignes = -1;

function lireSelection() {
  try { courseId = localStorage.getItem(CLE_COURSE); } catch { courseId = null; }
}

function rendre() {
  // Plusieurs courses lancées en même temps : une colonne par course
  // Dans l'ordre du programme (heure de départ prévue), pas dans l'ordre des départs réels
  const lancees = calc.coursesEnCours().sort((a, b) => (a.heure || "99").localeCompare(b.heure || "99") || a.nom.localeCompare(b.nom, "fr", { numeric: true }));
  const multi = lancees.length >= 2;
  $("#ecranMulti").hidden = !multi;
  const c = course(courseId);
  const by = !multi && calc.estBackyard(c);
  $("#ecranBackyard").hidden = !by;
  document.querySelector(".screen__clock").hidden = multi || by;
  document.querySelector(".screen__body").hidden = multi || by;
  if (multi) { defilement(false); rendreMulti(lancees); tic(); return; }
  if (by) { defilement(false); rendreBackyard(c); tic(); return; }

  const etat = calc.etatChrono(c).etat;
  $("#ecranCourse").textContent = c ? nomCourse(c) : "Aucune course sélectionnée";
  $("#ecranLieu").textContent = c ? [c.lieu, c.distance && `${String(c.distance).replace(".", ",")} km`].filter(Boolean).join(" · ") : "Choisissez une course dans l'onglet Chronomètre.";
  const chip = $("#ecranEtat");
  chip.textContent = ETATS[etat];
  chip.className = `chip chip--${etat}`;

  const s = c ? calc.situation(c.id) : { arrives: [], dnf: [], dsq: [], enCours: [], avecBulletin: [] };
  const eq = calc.equipesDe(c, s.tous || []);
  const attente = etat === "attente" ? s.avecBulletin.sort((a, b) => compareDossard(a.dossard, b.dossard)) : s.enCours;
  $("#ecranEnCours").textContent = attente.length;
  $("#ecranClasses").textContent = s.arrives.length;

  const lignes = [...s.arrives.map((i, k) => ({ i, pos: k + 1 })), ...s.dnf.map((i) => ({ i, pos: null })), ...s.dsq.map((i) => ({ i, pos: null }))];
  $("#ecranClassement").innerHTML = lignes.map(({ i, pos }) => `<tr class="${pos == null ? "is-dnf" : pos <= 3 ? `podium podium--${pos}` : ""}">
      <td><b>${pos ?? i.statut}</b></td><td><b>${esc(i.dossard)}</b></td><td>${esc(nomComplet(i))}</td><td>${esc(calc.equipeAffichee(i, eq))}</td>
      <td class="r mono"><b>${pos == null ? i.statut : fmtDuree(calc.tempsOfficiel(i))}</b></td></tr>`).join("");
  // Course d'un événement terminée : à droite, le programme de l'événement à la place des coureurs en course
  const ev = etat === "arretee" && evenement(c?.evenementId);
  $("#ecranAsideTitre").textContent = ev ? "Programme" : "En course";
  $("#ecranListeEnCours").innerHTML = ev ? programme(ev)
    : attente.map((i) => `<li><b>${esc(i.dossard) || "—"}</b> ${esc(nomComplet(i))}</li>`).join("");

  // Nouvelle arrivée : on montre le bas du classement ; course terminée : défilement automatique
  if (lignes.length !== nbLignes) { nbLignes = lignes.length; if (etat !== "arretee") $("#ecranScroll").scrollTop = 1e9; }
  defilement(etat === "arretee");
  tic();
}

/** Programme d'un événement : heure, course, état, et le vainqueur des courses terminées. */
function programme(ev) {
  return coursesDe(ev.id).map((x) => {
    const etat = calc.etatChrono(x).etat;
    const premier = etat === "arretee" ? calc.situation(x.id).arrives[0] : null;
    const detail = premier ? `1er : ${nomComplet(premier)} · ${fmtDuree(calc.tempsOfficiel(premier))}` : ETATS[etat];
    return `<li><b>${esc(x.heure || "")}</b> ${esc(x.nom)}<br><small>${esc(detail)}</small></li>`;
  }).join("");
}

// ── Backyard ──────────────────────────────────────────────────
const fmtRebours = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`;
};
const tuileEtat = (i, L, avant) => (avant ? "run" : i.statut ? "out" : i.passages?.[L - 1] != null ? "in" : "run");
let boucleAffichee = null;

function rendreBackyard(c) {
  const etat = calc.etatChrono(c).etat;
  const s = calc.situationBackyard(c);
  const avant = etat === "attente";
  boucleAffichee = s.boucle;
  $("#ecranCourse").textContent = nomCourse(c);
  $("#ecranLieu").textContent = ["Backyard", c.lieu, c.distance && `boucle de ${String(c.distance).replace(".", ",")} km`, `une boucle toutes les ${c.backyard?.minutes || 60} min`].filter(Boolean).join(" · ");
  const tous = avant ? calc.situation(c.id).avecBulletin.sort((a, b) => compareDossard(a.dossard, b.dossard)) : [...s.actifs, ...s.elimines.sort((a, b) => compareDossard(a.dossard, b.dossard))];
  $("#ebMur").innerHTML = tous.map((i) => `<span class="eb--${tuileEtat(i, s.boucle, avant)}" title="${esc(nomComplet(i))}">${esc(i.dossard) || "—"}</span>`).join("");
  const gs = calc.gagnantsDe(c).map((id) => state.inscrits.find((i) => i.id === id)).filter(Boolean);
  const g = gs.length === 1 ? gs[0] : null;
  $("#ebActifs").textContent = etat === "arretee" && g ? `${g.dossard} ${nomComplet(g)}` : String(avant ? tous.length : s.actifs.length);
  $("#ebActifsTxt").textContent = avant ? "coureurs au départ" : etat === "arretee" ? (g ? `gagne avec ${calc.nbBoucles(g)} boucles` : "— course terminée") : "encore en course";
  // Boucles terminées par les meilleurs : celles d'avant la boucle en cours (course finie : le record)
  const fait = etat === "en-cours" ? s.boucle - 1 : Math.max(0, ...s.partants.map(calc.nbBoucles));
  const km = Number(c.distance) > 0 ? ` · ${(fait * c.distance).toFixed(1).replace(".", ",")} km` : "";
  $("#ebKm").textContent = !avant && fait ? `${fait} boucle${fait > 1 ? "s" : ""} terminée${fait > 1 ? "s" : ""}${km}` : "";
  $("#ebDerniers").textContent = s.elimines.length ? `Derniers éliminés : ${s.elimines.slice(0, 4).map((i) => `${i.dossard} ${nomComplet(i)} (boucle ${i.elimine?.boucle ?? "?"}, ${i.elimine?.motif || "éliminé"})`).join(" · ")}` : "";
}

function ticBackyard(c) {
  const etat = calc.etatChrono(c).etat;
  const e = calc.etatBackyard(c);
  if (etat === "en-cours" && e.boucle !== boucleAffichee) { rendre(); return; }
  const max = calc.maxBoucles(c);
  $("#ebBoucle").textContent = etat === "attente" ? "Avant le départ" : `Boucle ${e.boucle}${max ? ` / ${max}` : ""}`;
  $("#ebTitre").textContent = etat === "en-cours" ? (max && e.boucle >= max ? "Dernière boucle : fin dans" : "Prochain départ dans") : etat === "attente" ? "Une boucle toutes les" : "Durée de la course";
  const el = $("#ebRebours");
  el.textContent = etat === "en-cours" ? fmtRebours(e.restant) : etat === "attente" ? fmtRebours(e.periode) : fmtDuree(calc.tempsCourse(c));
  el.classList.toggle("is-alerte", etat === "en-cours" && e.restant <= 60000);
}

// ── Vue à plusieurs courses ───────────────────────────────────
const PAR_PAGE = 3;
const DUREE_PAGE = 15000;
let pageMulti = -1;

function rendreMulti(lancees) {
  const evs = [...new Set(lancees.map((c) => c.evenementId || ""))];
  const ev = evs.length === 1 ? evenement(evs[0]) : null;
  $("#ecranCourse").textContent = ev ? ev.nom : "Courses en cours";
  $("#ecranLieu").textContent = [ev?.lieu, `${lancees.length} courses en même temps`].filter(Boolean).join(" · ");
  const pages = Math.ceil(lancees.length / PAR_PAGE);
  pageMulti = Math.floor(Date.now() / DUREE_PAGE) % pages;
  const montrees = lancees.slice(pageMulti * PAR_PAGE, (pageMulti + 1) * PAR_PAGE);
  $("#ecranMulti").style.setProperty("--nb", montrees.length);
  $("#ecranMulti").innerHTML = montrees.map((c) => {
    if (calc.estBackyard(c)) {
      const b = calc.situationBackyard(c);
      const mur = [...b.actifs, ...b.elimines].map((i) => `<span class="eb--${tuileEtat(i, b.boucle, false)}">${esc(i.dossard)}</span>`).join("");
      return `<article class="multi__col">
        <h2>${esc(ev ? c.nom : nomCourse(c))}</h2>
        <div class="multi__time" data-chrono="${c.id}">00:00</div>
        <p class="multi__counts"><span>Boucle <b>${b.boucle}</b></span><span>En course : <b>${b.actifs.length}</b></span><span>Rentrés : <b>${b.rentres.length}</b></span></p>
        <div class="multi__liste"><div class="multi__mur">${mur}</div></div>
      </article>`;
    }
    const s = calc.situation(c.id);
    const eq = calc.equipesDe(c, s.tous || []);
    const ligne = (i, pos) => `<tr class="${pos <= 3 ? `podium podium--${pos}` : ""}"><td><b>${pos}</b></td><td>${esc(i.dossard)}</td><td>${esc(nomComplet(i))}</td>
      <td class="muted">${esc(calc.equipeAffichee(i, eq))}</td><td class="r mono"><b>${fmtDuree(calc.tempsOfficiel(i))}</b></td></tr>`;
    const podium = s.arrives.slice(0, 3).map((i, k) => ligne(i, k + 1)).join("");
    // Dernières arrivées, la plus récente en haut (hors podium, déjà affiché)
    const derniers = s.arrives.map((i, k) => ({ i, pos: k + 1 })).slice(3).slice(-8).reverse().map(({ i, pos }) => ligne(i, pos)).join("");
    return `<article class="multi__col">
      <h2>${esc(ev ? c.nom : nomCourse(c))}</h2>
      <div class="multi__time" data-chrono="${c.id}">00:00:00</div>
      <p class="multi__counts"><span>En course : <b>${s.enCours.length}</b></span><span>Classés : <b>${s.arrives.length}</b></span></p>
      <div class="multi__liste">
        ${podium ? `<h3>Podium</h3><table class="table table--nowrap"><tbody>${podium}</tbody></table>` : `<p class="muted c">Pas encore d'arrivée.</p>`}
        ${derniers ? `<h3>Dernières arrivées</h3><table class="table table--nowrap"><tbody>${derniers}</tbody></table>` : ""}
      </div>
    </article>`;
  }).join("") + (pages > 1 ? `<p class="multi__page">Courses ${pageMulti * PAR_PAGE + 1} à ${Math.min(lancees.length, (pageMulti + 1) * PAR_PAGE)} sur ${lancees.length}</p>` : "");
}

function tic() {
  document.querySelectorAll("[data-chrono]").forEach((el) => {
    const x = course(el.dataset.chrono);
    el.textContent = calc.estBackyard(x) ? fmtRebours(calc.etatBackyard(x).restant) : fmtDuree(calc.tempsCourse(x));
  });
  // Plus de 3 courses : on change de page toutes les 15 s
  const lancees = calc.coursesEnCours();
  if (lancees.length > PAR_PAGE && Math.floor(Date.now() / DUREE_PAGE) % Math.ceil(lancees.length / PAR_PAGE) !== pageMulti) rendre();
  const c = course(courseId);
  if (!$("#ecranBackyard").hidden && calc.estBackyard(c)) ticBackyard(c);
  const el = $("#ecranChrono");
  el.textContent = fmtDuree(calc.tempsCourse(c));
  el.classList.toggle("is-running", calc.etatChrono(c).etat === "en-cours");
}

// ── Défilement aller-retour, avec 5 s de pause en haut et en bas ─
let defile = false, sens = 1, pauseJusqua = 0, raf = null;
function defilement(actif) {
  if (actif === defile) return;
  defile = actif;
  cancelAnimationFrame(raf);
  if (!actif) return;
  sens = 1;
  pauseJusqua = performance.now() + 5000;
  const zone = $("#ecranScroll");
  const pas = (t) => {
    if (!defile) return;
    const max = zone.scrollHeight - zone.clientHeight;
    if (max > 0 && t >= pauseJusqua) {
      zone.scrollTop += sens * 1.5;
      if ((sens > 0 && zone.scrollTop >= max - 1) || (sens < 0 && zone.scrollTop <= 0)) { sens = -sens; pauseJusqua = t + 5000; }
    }
    raf = requestAnimationFrame(pas);
  };
  raf = requestAnimationFrame(pas);
}

$("#btnPleinEcran").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
});
document.addEventListener("fullscreenchange", () => { $("#btnPleinEcran").textContent = document.fullscreenElement ? "Quitter le plein écran" : "Plein écran"; });

await store.init();
lireSelection();
store.onExterne((quoi) => { if (quoi === "selection") lireSelection(); rendre(); });
window.addEventListener("storage", (e) => { if (e.key === CLE_COURSE) { lireSelection(); rendre(); } });
setInterval(tic, 250);
rendre();

// L'écran public reste allumé tant qu'il est affiché (télé, vidéoprojecteur)
let verrou = null;
async function garderAllume() {
  if (verrou || document.visibilityState !== "visible" || !navigator.wakeLock) return;
  try {
    verrou = await navigator.wakeLock.request("screen");
    verrou.addEventListener("release", () => { verrou = null; });
  } catch { /* refusé : l'écran suivra les réglages de veille du PC */ }
}
document.addEventListener("visibilitychange", garderAllume);
garderAllume();
