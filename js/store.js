// Données de Loopace Chrono : tout reste dans le navigateur (IndexedDB), rien n'est envoyé en ligne.
// L'état complet est un seul objet en mémoire, réécrit à chaque modification ;
// les PDF archivés sont rangés à part. Les autres onglets (et l'écran public) sont prévenus par BroadcastChannel.

const DB_NAME = "loopace-chrono";
const DB_VERSION = 1;
const CANAL = "loopace-chrono";

export const THEME_DEFAUT_ID = "defaut";

function themeDefaut() {
  return {
    id: THEME_DEFAUT_ID, defaut: true, nom: "Défaut", couleur: "#15291F", logo: null,
    titre: "", sousTitre: "", piedPage: "", afficherEcoles: true, tailleLogo: 60, tailleTitre: 16,
  };
}

function etatVide() {
  return { version: 1, courses: [], inscrits: [], themes: [themeDefaut()] };
}

let db = null;
export let state = etatVide();
const canal = "BroadcastChannel" in window ? new BroadcastChannel(CANAL) : null;
const abonnes = new Set();

function ouvrir() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
      if (!d.objectStoreNames.contains("archives")) d.createObjectStore("archives", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function requete(store, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const r = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(r && "result" in r ? r.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}

async function lireEtat() {
  const lu = await requete("kv", "readonly", (s) => s.get("etat"));
  const e = lu || etatVide();
  if (!e.themes.some((t) => t.defaut)) e.themes.unshift(themeDefaut());
  return e;
}

export async function init() {
  db = await ouvrir();
  state = await lireEtat();
  if (canal) {
    canal.onmessage = async (ev) => {
      if (ev.data?.type !== "maj") return;
      state = await lireEtat();
      abonnes.forEach((fn) => fn(ev.data.quoi));
    };
  }
}

/** Appelé quand un autre onglet a modifié les données. */
export function onExterne(fn) { abonnes.add(fn); }

export function prevenir(quoi = "etat") { canal?.postMessage({ type: "maj", quoi }); }

/** Enregistre l'état courant et prévient les autres onglets. */
export async function sauver() {
  await requete("kv", "readwrite", (s) => s.put(state, "etat"));
  prevenir("etat");
}

export async function remplacer(nouvelEtat) {
  state = nouvelEtat;
  if (!state.themes?.some((t) => t.defaut)) state.themes = [themeDefaut(), ...(state.themes || [])];
  await sauver();
}

// ── Archives PDF ──────────────────────────────────────────────
export const archives = {
  lister: () => requete("archives", "readonly", (s) => s.getAll())
    .then((l) => l.sort((a, b) => b.date - a.date)),
  ajouter: (a) => requete("archives", "readwrite", (s) => s.put(a)).then(() => prevenir("archives")),
  supprimer: (id) => requete("archives", "readwrite", (s) => s.delete(id)).then(() => prevenir("archives")),
};

// ── Accès pratiques ───────────────────────────────────────────
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const course = (id) => state.courses.find((c) => c.id === id) || null;
export const inscritsDe = (courseId) => state.inscrits.filter((i) => i.courseId === courseId);
export const theme = (id) => state.themes.find((t) => t.id === id) || null;

export function coursesTriees() {
  return [...state.courses].sort((a, b) =>
    (a.date || "9999").localeCompare(b.date || "9999") || (a.heure || "").localeCompare(b.heure || "") || a.nom.localeCompare(b.nom));
}
