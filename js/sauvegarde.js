// Sauvegarde automatique dans un dossier du PC (Chrome et Edge) : le dossier est choisi une fois,
// ensuite l'application y écrit toute seule. Rien n'est envoyé en ligne.
// « Loopace_Chrono_derniere.json » est réécrit quelques secondes après chaque modification ; le sous-dossier
// « Historique » garde des copies datées (départ, fin de course, archivage, et une par jour d'utilisation).
// Les fichiers ont le format de « Exporter une sauvegarde » : le bouton « Restaurer » les relit.

import * as store from "./store.js?v=26";
import { state } from "./store.js?v=26";

// La version de test a ses propres fichiers : même dans le même dossier, elle ne touche pas à ceux de la stable
const PREFIXE = store.TEST ? "Loopace_Chrono_TEST_" : "Loopace_Chrono_";
export const DERNIERE = `${PREFIXE}derniere.json`;
const HISTORIQUE = "Historique";
const GARDER = 30;     // copies datées conservées
const DELAI = 3000;    // une écriture au plus toutes les 3 s pendant une course
const CLE = "dossierSauvegarde";

export const possible = typeof window.showDirectoryPicker === "function";

let dossier = null;
let minuteur = null;
let copieDemandee = false;
let file = Promise.resolve();
const etat = { statut: possible ? "aucun" : "impossible", heure: null, erreur: "" }; // impossible | aucun | ok | pause | erreur
const abonnes = new Set();

export const lireEtat = () => ({ ...etat, nom: dossier?.name || "" });
export function onEtat(fn) { abonnes.add(fn); }
function changer(maj) {
  Object.assign(etat, maj);
  abonnes.forEach((fn) => fn(lireEtat()));
}

// ── Contenu : tout l'état, archives comprises (leur PDF encodé en texte) ─
const blobEnTexte = (blob) => new Promise((resolve, reject) => {
  const lecteur = new FileReader();
  lecteur.onload = () => resolve(lecteur.result);
  lecteur.onerror = () => reject(lecteur.error);
  lecteur.readAsDataURL(blob);
});
const pdfEnTexte = new Map(); // une archive ne change plus : son PDF n'est encodé qu'une fois

export async function contenu() {
  const archives = await Promise.all((await store.archives.lister()).map(async ({ blob, ...a }) => {
    if (!pdfEnTexte.has(a.id)) pdfEnTexte.set(a.id, await blobEnTexte(blob));
    return { ...a, pdf: pdfEnTexte.get(a.id) };
  }));
  return { application: "loopace-chrono", exporte: new Date().toISOString(), ...state, archives };
}

/** Lit le texte d'une sauvegarde ; erreur si ce n'en est pas une. */
export function lire(texte) {
  const data = JSON.parse(texte);
  if (data?.application !== "loopace-chrono" || !Array.isArray(data.courses) || !Array.isArray(data.inscrits)) throw new Error("Ce fichier n'est pas une sauvegarde Loopace Chrono.");
  return data;
}

// ── Dossier ───────────────────────────────────────────────────
export async function init() {
  if (!possible) return;
  store.onSauve(() => planifier());
  dossier = (await store.reglages.lire(CLE).catch(() => null)) || null;
  if (dossier) await verifier(false);
}

/** Vérifie (ou demande, sur un clic) le droit d'écrire dans le dossier. */
async function verifier(demander) {
  const opts = { mode: "readwrite" };
  try {
    let droit = await dossier.queryPermission(opts);
    if (droit !== "granted" && demander) droit = await dossier.requestPermission(opts);
    if (droit === "granted") {
      changer({ statut: "ok", erreur: "" });
      planifier();
      return true;
    }
  } catch { /* dossier introuvable : traité comme une pause */ }
  changer({ statut: "pause" });
  return false;
}

/** Après une pause (le navigateur redemande l'accord au lancement) : à appeler sur un clic. */
export const autoriser = () => (dossier ? verifier(true) : Promise.resolve(false));

/** Choix du dossier, sur un clic. Renvoie le dossier et la sauvegarde qu'il contient déjà, s'il y en a une. */
export async function choisir() {
  const rep = await window.showDirectoryPicker({ id: store.BASE, mode: "readwrite", startIn: "documents" });
  let texte = null;
  let existante = null;
  try {
    texte = await (await (await rep.getFileHandle(DERNIERE)).getFile()).text();
    existante = lire(texte);
  } catch { texte = null; } // dossier neuf
  return { rep, existante, texte };
}

/**
 * Active la sauvegarde dans ce dossier. « remplacee » : texte de la sauvegarde qui s'y trouvait et qui va être
 * écrasée par les données de ce poste ; elle est d'abord rangée dans l'historique.
 */
export async function activer(rep, remplacee = null) {
  if (remplacee) {
    const hist = await rep.getDirectoryHandle(HISTORIQUE, { create: true });
    await ecrireFichier(hist, `${PREFIXE}${horodatage(new Date())}_remplacee.json`, remplacee);
  }
  dossier = rep;
  await store.reglages.ecrire(CLE, rep);
  changer({ statut: "ok", heure: null, erreur: "" });
  copie();
}

export async function desactiver() {
  clearTimeout(minuteur);
  minuteur = null;
  dossier = null;
  await store.reglages.effacer(CLE);
  changer({ statut: "aucun", heure: null, erreur: "" });
}

// ── Écriture ──────────────────────────────────────────────────
/** Écrit quelques secondes après une modification ; « copie » : tout de suite, avec une copie datée. */
export function planifier(avecCopie = false) {
  if (!dossier || etat.statut === "pause") return;
  if (avecCopie) copieDemandee = true;
  if (minuteur && !avecCopie) return;
  clearTimeout(minuteur);
  minuteur = setTimeout(() => {
    minuteur = null;
    file = file.then(ecrire);
  }, avecCopie ? 0 : DELAI);
}
export const copie = () => planifier(true);

const p2 = (n) => String(n).padStart(2, "0");
const horodatage = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}h${p2(d.getMinutes())}m${p2(d.getSeconds())}`;

// createWritable écrit dans un fichier temporaire, remplacé d'un coup à la fermeture : jamais de fichier à moitié écrit
async function ecrireFichier(rep, nom, texte) {
  const f = await rep.getFileHandle(nom, { create: true });
  const w = await f.createWritable();
  await w.write(texte);
  await w.close();
}

async function ecrire() {
  if (!dossier) return;
  const avecCopie = copieDemandee;
  copieDemandee = false;
  try {
    const texte = JSON.stringify(await contenu());
    await ecrireFichier(dossier, DERNIERE, texte);

    const hist = await dossier.getDirectoryHandle(HISTORIQUE, { create: true });
    const noms = [];
    for await (const [nom, h] of hist.entries()) {
      if (h.kind === "file" && nom.startsWith(PREFIXE) && /^\d{4}-/.test(nom.slice(PREFIXE.length)) && nom.endsWith(".json")) noms.push(nom);
    }
    const nom = `${PREFIXE}${horodatage(new Date())}.json`;
    if (avecCopie || !noms.some((n) => n.startsWith(nom.slice(0, PREFIXE.length + 10)))) { // copie du jour
      await ecrireFichier(hist, nom, texte);
      noms.push(nom);
    }
    noms.sort(); // les noms datés se trient du plus ancien au plus récent
    for (const ancien of noms.slice(0, Math.max(0, noms.length - GARDER))) await hist.removeEntry(ancien).catch(() => {});
    changer({ statut: "ok", heure: Date.now(), erreur: "" });
  } catch (err) {
    copieDemandee ||= avecCopie;
    if (err?.name === "NotAllowedError" || err?.name === "SecurityError") changer({ statut: "pause" });
    else changer({ statut: "erreur", erreur: err?.message || String(err) }); // clé USB retirée, dossier supprimé…
  }
}

// En quittant ou en cachant la page, on n'attend pas les 3 s
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden" || !minuteur) return;
  clearTimeout(minuteur);
  minuteur = null;
  file = file.then(ecrire);
});
