// Service worker : garde l'application et ses bibliothèques en cache pour chronométrer sans réseau.
// Fichiers du site : réseau d'abord (mises à jour), cache si hors ligne. Bibliothèques CDN (versions figées) : cache d'abord.

const CACHE = "loopace-chrono-v14";
const FICHIERS = [
  "./", "index.html", "ecran.html", "styles.css?v=14", "ecran.css?v=14",
  "js/app.js?v=14", "js/ecran.js?v=14", "js/store.js?v=14", "js/calc.js?v=14", "js/excel.js?v=14", "js/pdf.js?v=14",
  "manifest.webmanifest", "baremes.json",
  "assets/loopace-logo-clair.png", "assets/loopace-logo-sombre.png",
  "assets/chrono-app-32.png", "assets/chrono-app-180.png", "assets/chrono-app-192.png", "assets/chrono-app-512.png", "assets/chrono-app-maskable-512.png",
  "assets/chrono-logo-sombre.png", "assets/chrono-logo-clair.png",
  "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
  "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js",
  "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(FICHIERS.map((f) => c.add(f).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((cles) => Promise.all(cles.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const cdn = url.hostname === "cdn.jsdelivr.net";
  const polices = url.hostname.endsWith("fonts.googleapis.com") || url.hostname.endsWith("fonts.gstatic.com");
  if (url.origin !== location.origin && !cdn && !polices) return;

  const enCache = (rep) => {
    if (rep.ok || rep.type === "opaque") { const copie = rep.clone(); caches.open(CACHE).then((c) => c.put(req, copie)); }
    return rep;
  };

  if (cdn || polices) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then(enCache)));
  } else {
    // « no-cache » : toujours revérifier auprès du serveur, sinon le cache HTTP peut servir un module périmé
    e.respondWith(fetch(req, { cache: "no-cache" }).then(enCache).catch(() => caches.match(req, { ignoreSearch: false }).then((r) => r || caches.match("index.html"))));
  }
});
