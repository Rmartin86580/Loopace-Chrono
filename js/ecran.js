// Écran public : grand chronomètre et classement en direct de la course choisie dans l'onglet Chronomètre.
// Lecture seule ; il se met à jour quand l'application principale enregistre (BroadcastChannel).

import * as store from "./store.js?v=18";
import { course } from "./store.js?v=18";
import * as calc from "./calc.js?v=18";
import { fmtDuree, nomComplet, compareDossard } from "./calc.js?v=18";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ETATS = { "attente": "En attente", "en-cours": "En course", "arretee": "Terminée" };

let courseId = null;
let nbLignes = -1;

function lireSelection() {
  try { courseId = localStorage.getItem("loopace-chrono-course"); } catch { courseId = null; }
}

function rendre() {
  const c = course(courseId);
  const etat = calc.etatChrono(c).etat;
  $("#ecranCourse").textContent = c ? c.nom : "Aucune course sélectionnée";
  $("#ecranLieu").textContent = c ? [c.lieu, c.distance && `${String(c.distance).replace(".", ",")} km`].filter(Boolean).join(" · ") : "Choisissez une course dans l'onglet Chronomètre.";
  const chip = $("#ecranEtat");
  chip.textContent = ETATS[etat];
  chip.className = `chip chip--${etat}`;

  const s = c ? calc.situation(c.id) : { arrives: [], dnf: [], enCours: [], avecBulletin: [] };
  const eq = calc.equipesDe(c, s.tous || []);
  const attente = etat === "attente" ? s.avecBulletin.sort((a, b) => compareDossard(a.dossard, b.dossard)) : s.enCours;
  $("#ecranEnCours").textContent = attente.length;
  $("#ecranClasses").textContent = s.arrives.length;

  const lignes = [...s.arrives.map((i, k) => ({ i, pos: k + 1 })), ...s.dnf.map((i) => ({ i, pos: null }))];
  $("#ecranClassement").innerHTML = lignes.map(({ i, pos }) => `<tr class="${pos == null ? "is-dnf" : pos <= 3 ? `podium podium--${pos}` : ""}">
      <td><b>${pos ?? "DNF"}</b></td><td><b>${esc(i.dossard)}</b></td><td>${esc(nomComplet(i))}</td><td>${esc(calc.equipeAffichee(i, eq))}</td>
      <td class="r mono"><b>${pos == null ? "DNF" : fmtDuree(calc.duree(i))}</b></td></tr>`).join("");
  $("#ecranListeEnCours").innerHTML = attente.map((i) => `<li><b>${esc(i.dossard) || "—"}</b> ${esc(nomComplet(i))}</li>`).join("");

  // Nouvelle arrivée : on montre le bas du classement ; course terminée : défilement automatique
  if (lignes.length !== nbLignes) { nbLignes = lignes.length; if (etat !== "arretee") $("#ecranScroll").scrollTop = 1e9; }
  defilement(etat === "arretee");
  tic();
}

function tic() {
  const c = course(courseId);
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
window.addEventListener("storage", (e) => { if (e.key === "loopace-chrono-course") { lireSelection(); rendre(); } });
setInterval(tic, 250);
rendre();
