// Vult de lokale testserver met een realistische toestand (testdatum do 15/10/2026).
// Draaien terwijl server.js loopt: node v2/test/vul-demo.js
const API = 'http://localhost:' + (process.env.PORT || 8790) + '/api';
const post = b => fetch(API, { method: 'POST', body: JSON.stringify(b) }).then(r => r.json());

(async () => {
  const d = await (await fetch(API + '?actie=data')).json();
  let n = 0;
  for (const g of d.groepen) {
    for (const iso of g.lessen) {
      if (iso >= '2026-10-12') continue;
      if ((g.id === 'WO-1500-T2' && iso === '2026-10-07') || (g.id === 'DI-1700-T1' && iso === '2026-10-06')) continue;
      const t = g.trainers[0] || 'Jan';
      await post({ actie: 'registreer', verzoek_id: 'demo' + n++, datum: iso, groep_id: g.id, status: 'gegeven', gegeven_door: t, ingevuld_door: t });
    }
  }
  const extra = [
    { datum: '2026-10-14', groep_id: 'WO-1500-T2', status: 'gegeven', gegeven_door: 'Tom', ingevuld_door: 'Tom' },
    { datum: '2026-10-14', groep_id: 'WO-1400-T2', status: 'gegeven', gegeven_door: 'Jan', opmerking: 'Tom ziek', ingevuld_door: 'Tom' },
    { datum: '2026-10-14', groep_id: 'WO-1600-T2', status: 'niet_doorgegaan', reden: 'regen of weer', ingevuld_door: 'Tom' },
    { datum: '2026-10-14', groep_id: 'WO-1400-T1', status: 'gegeven', gegeven_door: 'Steffi', ingevuld_door: 'Steffi' },
    { datum: '2026-10-14', groep_id: 'WO-1500-T1', status: 'gegeven', gegeven_door: 'Mat', ingevuld_door: 'Mat' }
  ];
  for (const e of extra) {
    const r = await post(Object.assign({ actie: 'registreer', verzoek_id: 'demo' + n++ }, e));
    if (!r.ok) console.log(e.groep_id, r.fout);
  }
  console.log(n + ' registraties ingevuld.');
})();
