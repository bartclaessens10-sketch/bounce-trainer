# Bounce trainersapp v2 (per groep)

Winter 2026-2027. Trainers tikken per les door wie ze gaf. Jan ziet het overzicht.

- `index.html`: de app (GitHub Pages: `/bounce-trainer/v2/`). Zet de web-app-URL in `API_URL`.
- `Code.gs`: Google Apps Script, gekoppeld aan de Sheet "Bounce Trainers Winter 2026-2027".
- `test/`: lokaal testen zonder Google.
  - `node v2/test/logica.test.js`: de serverregels
  - `node v2/test/server.js`: de app op http://localhost:8790, met de echte Code.gs tegen een nagebootste Sheet
  - `node v2/test/vul-demo.js`: realistische testdata
  - `node v2/test/schermafbeeldingen.js <map>`: schermafbeeldingen op 390 px (Chrome)

Spec, handover en handleidingen: Barts map `Make Fun/20_trainersapp/v2-per-groep/`.
v1 (zomer 2026) staat ernaast in de hoofdmap en blijft ongewijzigd.
