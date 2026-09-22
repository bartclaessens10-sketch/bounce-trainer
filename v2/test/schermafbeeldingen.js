// Maakt schermafbeeldingen (390 px breed, zoals een gsm) voor de handleidingen.
// Vereist: server.js loopt, demo-data geladen (vul-demo.js), Chrome geïnstalleerd.
// Draaien: node v2/test/schermafbeeldingen.js <uitmap>
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const UIT = process.argv[2] || path.join(__dirname, 'beelden');
const BASIS = 'http://localhost:8790';
const POORT = 9333;
const wacht = ms => new Promise(r => setTimeout(r, ms));

const OPNAMES = [
  ['1-wie-ben-je', 'Tom', 'wie', null],
  ['2-startscherm', 'Tom', 'start', null],
  ['3-dag', 'Tom', 'dag', null],
  ['4-les-invullen', 'Tom', 'blad', null],
  ['5-iemand-anders', 'Tom', 'ander', null],
  ['6-ging-niet-door', 'Tom', 'niet', null],
  ['7-mijn-lessen', 'Tom', 'mijn', null],
  ['8-overzicht-jan', 'Jan', 'start', "localStorage.removeItem('bt2_wachtrij');S.pin='1234';S.tab='jan';render();"],
  ['9-overzicht-jan-tellingen', 'Jan', 'start', "S.pin='1234';S.tab='jan';render();[...document.querySelectorAll('h2')].find(x=>x.textContent.startsWith('Gegeven')).scrollIntoView();window.scrollBy(0,-80);"]
];

(async () => {
  fs.mkdirSync(UIT, { recursive: true });
  const profiel = fs.mkdtempSync(path.join(os.tmpdir(), 'bt2-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=' + POORT, '--user-data-dir=' + profiel, 'about:blank'], { stdio: 'ignore' });
  let doel;
  for (let i = 0; i < 40 && !doel; i++) {
    await wacht(250);
    try { doel = (await (await fetch('http://127.0.0.1:' + POORT + '/json')).json()).find(t => t.type === 'page'); } catch (e) {}
  }
  const ws = new WebSocket(doel.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0;
  const wachtend = {};
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && wachtend[m.id]) { wachtend[m.id](m); delete wachtend[m.id]; } });
  const cdp = (method, params) => new Promise(r => { const i = ++id; wachtend[i] = r; ws.send(JSON.stringify({ id: i, method, params: params || {} })); });

  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  for (const [naam, ik, shot, extra] of OPNAMES) {
    await cdp('Page.navigate', { url: BASIS + '/__als?ik=' + ik + '&shot=' + shot });
    await wacht(1800);
    if (extra) { await cdp('Runtime.evaluate', { expression: extra }); await wacht(400); }
    const res = await cdp('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(UIT, naam + '.png'), Buffer.from(res.result.data, 'base64'));
    console.log('ok ' + naam);
  }
  ws.close();
  chrome.kill();
})();
