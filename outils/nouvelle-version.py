"""Nouvelle version de Loopace Chrono : à lancer avant chaque mise en ligne.

Ajoute ou augmente le numéro « ?v=N » de tous les fichiers de code et de style (et le nom du cache
hors ligne). Le navigateur est ainsi obligé de charger la nouvelle version de chaque fichier, au lieu
de mélanger d'anciens fichiers gardés en cache avec les nouveaux.

    python outils/nouvelle-version.py
"""
import pathlib
import re

RACINE = pathlib.Path(__file__).resolve().parent.parent
FICHIERS = ["index.html", "ecran.html", "sw.js", *[f"js/{p.name}" for p in (RACINE / "js").glob("*.js")]]
CIBLES = r"((?:styles|ecran)\.css|(?:app|ecran|store|calc|excel|pdf)\.js)"

textes = {f: (RACINE / f).read_text(encoding="utf-8") for f in FICHIERS}
actuelle = max([int(v) for t in textes.values() for v in re.findall(r"\?v=(\d+)", t)] or [0])
nouvelle = actuelle + 1

for f, t in textes.items():
    t2 = re.sub(CIBLES + r"(\?v=\d+)?(?=[\"'])", lambda m: f"{m.group(1)}?v={nouvelle}", t)
    t2 = re.sub(r"loopace-chrono-v\d+", f"loopace-chrono-v{nouvelle}", t2)
    if t2 != t:
        (RACINE / f).write_text(t2, encoding="utf-8")
        print(f"  {f}")
print(f"Version {nouvelle}")
