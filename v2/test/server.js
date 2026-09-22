// Lokale testserver: serveert index.html en draait de echte Code.gs tegen een nagebootste Sheet.
// Starten: node v2/test/server.js   ->  http://localhost:8790
// Testhulpjes (enkel lokaal):
//   /__zet?testdatum=2026-10-15   doen alsof het die dag is
//   /__run?f=testSeintjes         een functie uit Code.gs draaien
//   /__mails                      verstuurde mails bekijken
//   /__sheet?tab=Registraties     een tabblad bekijken
const http = require('http');
const fs = require('fs');
const path = require('path');
const { maakOmgeving } = require('./gas-shim');

const PORT = Number(process.env.PORT || 8790);
const { ctx, ss, mails, zetInstelling } = maakOmgeving();
ctx.setup();
zetInstelling('testdatum', process.env.TESTDATUM || '2026-10-15');

const json = (res, o) => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o, null, 1)); };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api') {
    if (req.method === 'GET') {
      const out = ctx.doGet({ parameter: Object.fromEntries(url.searchParams) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(out.tekst);
    }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const out = ctx.doPost({ postData: { contents: body } });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(out.tekst);
    });
    return;
  }
  if (url.pathname === '/__zet') {
    url.searchParams.forEach((v, k) => zetInstelling(k, v));
    return json(res, { ok: true });
  }
  if (url.pathname === '/__run') {
    mails.length = 0;
    ctx[url.searchParams.get('f')]();
    return json(res, mails);
  }
  if (url.pathname === '/__mails') return json(res, mails);
  if (url.pathname === '/__sheet') return json(res, ss.getSheetByName(url.searchParams.get('tab')).d);
  const bestand = path.join(__dirname, '..', 'index.html');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (url.pathname === '/__als') {
    // Voor schermafbeeldingen: /__als?ik=Tom&shot=start|blad|ander|niet|mijn|wie
    const ik = url.searchParams.get('ik') || 'Tom';
    const shot = url.searchParams.get('shot') || 'start';
    const acties = {
      wie: "S.ik=null;render();",
      start: "",
      blad: "S.dag='2026-10-14';render();openBlad(groep('WO-1700-T2'),'2026-10-14');",
      ander: "S.dag='2026-10-14';render();openBlad(groep('WO-1700-T2'),'2026-10-14','ander');",
      niet: "S.dag='2026-10-14';render();openBlad(groep('WO-1700-T2'),'2026-10-14','niet');document.querySelector('input[value=\"regen of weer\"]').checked=true;",
      dag: "S.dag='2026-10-14';render();document.querySelector('.week').scrollIntoView();window.scrollBy(0,-70);",
      mijn: "S.tab='mijn';render();"
    };
    let html = fs.readFileSync(bestand, 'utf8');
    html = html.replace('<script>', '<script>try{localStorage.clear();localStorage.setItem("bt2_ik",' + JSON.stringify(JSON.stringify(ik)) + ')}catch(e){}</script><script>');
    html = html.replace('</body>', '<script>setTimeout(function(){' + (acties[shot] || '') + '},700)</script></body>');
    return res.end(html);
  }
  fs.createReadStream(bestand).pipe(res);
}).listen(PORT, () => console.log('Bounce trainersapp v2 test op http://localhost:' + PORT));
