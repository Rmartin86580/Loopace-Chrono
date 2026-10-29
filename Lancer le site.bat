@echo off
rem Lance Loopace Chrono en local puis l'ouvre dans le navigateur.
rem Ferme cette fenetre pour arreter le serveur.
cd /d "%~dp0"
start "" http://localhost:5520
python -m http.server 5520
