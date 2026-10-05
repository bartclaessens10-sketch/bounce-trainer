// Test van de serverregels in Code.gs.  Draaien: node v2/test/logica.test.js
const assert = require('assert');
const { maakOmgeving } = require('./gas-shim');

const { ctx, ss, mails, zetInstelling } = maakOmgeving();
ctx.setup();
zetInstelling('testdatum', '2026-10-15'); // donderdag in week 3

const get = () => JSON.parse(ctx.doGet({ parameter: { actie: 'data' } }).tekst);
const post = b => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(b) } }).tekst);
let n = 0;
const ok = (naam, fn) => { fn(); n++; console.log('ok  ' + naam); };

const d = get();
ok('31 blokjes, 10 trainers (planning Jan 28/9)', () => {
  assert.strictEqual(d.groepen.length, 32);
  assert.strictEqual(d.trainers.length, 10);
  assert.ok(d.trainers.includes('Thibaud') && d.trainers.includes('Mathieu') && d.trainers.includes('Matt'));
  // zondag hoort er nu bij, woensdag 14u en 18u niet meer
  assert.ok(d.groepen.some(g => g.dag === 'zo' && g.start === '11:00'));
  assert.ok(!d.groepen.some(g => g.start === '14:00'));
  assert.ok(!d.groepen.some(g => g.dag === 'wo' && g.start === '18:00'));
  // vrijdag 16u is gesplitst: elk zijn eigen blokje
  const vr = d.groepen.filter(g => g.dag === 'vr' && g.start === '16:00');
  assert.deepStrictEqual(vr.map(g => g.trainers.join()).sort(), ['Jebbe', 'Matt']);
});
ok('20 lesweken per groep, vakanties eruit', () => {
  d.groepen.forEach(g => assert.strictEqual(g.lessen.length, 20, g.id));
  const wo = d.groepen.find(g => g.id === 'WO-1500-T2');
  assert.strictEqual(wo.lessen[0], '2026-09-30');
  assert.strictEqual(wo.lessen[2], '2026-10-14');
  assert.ok(!wo.lessen.includes('2026-10-28'));
  assert.ok(wo.lessen.includes('2026-11-11')); // Wapenstilstand: wel les
  assert.ok(!wo.lessen.includes('2026-12-23'));
  assert.strictEqual(wo.lessen[19], '2027-03-10');
  const za = d.groepen.find(g => g.id === 'ZA-1000-T2');
  assert.strictEqual(za.lessen[0], '2026-10-03');
  const zo = d.groepen.find(g => g.id === 'ZO-1100-T1');
  assert.strictEqual(zo.lessen[0], '2026-10-04');
  assert.ok(!zo.lessen.includes('2026-11-01')); // het weekend op het einde van de herfstvakantie
  assert.ok(zo.lessen.includes('2026-10-25')); // het weekend ervoor telt wel mee
});
ok('duo-trainer en de les van 1,5 uur', () => {
  assert.deepStrictEqual(d.groepen.find(g => g.id === 'WO-1500-T1').trainers, ['Matt']);
  assert.deepStrictEqual(d.groepen.find(g => g.id === 'WO-1500-T1-2').trainers, ['Steffi']);
  assert.strictEqual(d.groepen.find(g => g.id === 'MA-1600-T1T2').duur, 90);
  assert.strictEqual(d.groepen.find(g => g.id === 'DI-1800-T1').trainers[0], 'Jan');
});

ok('les gegeven', () => {
  const r = post({ actie: 'registreer', verzoek_id: 'a1', datum: '2026-10-14', groep_id: 'WO-1500-T2', status: 'gegeven', gegeven_door: 'Tom', ingevuld_door: 'Tom' });
  assert.ok(r.ok, r.fout);
  assert.strictEqual(r.registratie.gegeven_door, 'Tom');
});
ok('dezelfde tik opnieuw (wachtrij) wordt niet dubbel geschreven', () => {
  const voor = ss.getSheetByName('Registraties').getLastRow();
  const r = post({ actie: 'registreer', verzoek_id: 'a1', datum: '2026-10-14', groep_id: 'WO-1500-T2', status: 'gegeven', gegeven_door: 'Tom', ingevuld_door: 'Tom' });
  assert.ok(r.ok && r.dubbel);
  assert.strictEqual(ss.getSheetByName('Registraties').getLastRow(), voor);
});
ok('toekomst: niet als gegeven', () => {
  const r = post({ actie: 'registreer', verzoek_id: 'a2', datum: '2026-10-21', groep_id: 'WO-1500-T2', status: 'gegeven', gegeven_door: 'Tom', ingevuld_door: 'Tom' });
  assert.ok(!r.ok);
});
ok('toekomst: wel "ging niet door"', () => {
  const r = post({ actie: 'registreer', verzoek_id: 'a3', datum: '2026-10-21', groep_id: 'WO-1500-T2', status: 'niet_doorgegaan', reden: 'regen of weer', ingevuld_door: 'Tom' });
  assert.ok(r.ok, r.fout);
});
ok('"andere" zonder tekst geweigerd, met tekst ok', () => {
  assert.ok(!post({ actie: 'registreer', verzoek_id: 'a4', datum: '2026-10-13', groep_id: 'DI-1800-T1', status: 'niet_doorgegaan', reden: 'andere', ingevuld_door: 'Jan' }).ok);
  const r = post({ actie: 'registreer', verzoek_id: 'a5', datum: '2026-10-13', groep_id: 'DI-1800-T1', status: 'niet_doorgegaan', reden: 'andere', reden_tekst: 'stroompanne', ingevuld_door: 'Jan' });
  assert.ok(r.ok, r.fout);
  assert.strictEqual(r.registratie.reden, 'andere: stroompanne');
});
ok('geen les op een vakantiedag of verkeerde dag', () => {
  assert.ok(!post({ actie: 'registreer', verzoek_id: 'a6', datum: '2026-10-28', groep_id: 'WO-1500-T2', status: 'niet_doorgegaan', reden: 'regen of weer', ingevuld_door: 'Tom' }).ok);
  assert.ok(!post({ actie: 'registreer', verzoek_id: 'a7', datum: '2026-10-13', groep_id: 'WO-1500-T2', status: 'gegeven', gegeven_door: 'Tom', ingevuld_door: 'Tom' }).ok);
});
ok('een andere trainer kan een ingevulde les niet wijzigen', () => {
  const r = post({ actie: 'registreer', verzoek_id: 'a8', datum: '2026-10-14', groep_id: 'WO-1500-T2', status: 'gegeven', gegeven_door: 'Amir', ingevuld_door: 'Amir' });
  assert.ok(!r.ok);
  assert.match(r.fout, /Tom/);
});
ok('wie invulde, kan corrigeren; de laatste rij telt', () => {
  const r = post({ actie: 'registreer', verzoek_id: 'a9', datum: '2026-10-14', groep_id: 'WO-1500-T2', status: 'gegeven', gegeven_door: 'Jan', ingevuld_door: 'Tom' });
  assert.ok(r.ok, r.fout);
  const reg = get().registraties.filter(x => x.datum === '2026-10-14' && x.groep_id === 'WO-1500-T2');
  assert.strictEqual(reg.length, 1);
  assert.strictEqual(reg[0].gegeven_door, 'Jan');
  const rijen = ss.getSheetByName('Registraties').d.filter(x => x[2] === 'WO-1500-T2' && x[1] instanceof Date && x[1].getDate() === 14);
  assert.deepStrictEqual(rijen.map(x => x[8]), ['nee', 'ja']);
});
ok('na 7 dagen: trainer niet, Jan met pincode wel', () => {
  const sh = ss.getSheetByName('Registraties');
  sh.d.forEach(x => { if (x[2] === 'WO-1500-T2') x[0] = new Date(Date.now() - 8 * 86400000); });
  assert.ok(!post({ actie: 'registreer', verzoek_id: 'b1', datum: '2026-10-14', groep_id: 'WO-1500-T2', status: 'gegeven', gegeven_door: 'Tom', ingevuld_door: 'Tom' }).ok);
  assert.ok(!post({ actie: 'registreer', verzoek_id: 'b2', datum: '2026-10-14', groep_id: 'WO-1500-T2', status: 'gegeven', gegeven_door: 'Tom', ingevuld_door: 'Jan', pin: '9999' }).ok);
  const r = post({ actie: 'registreer', verzoek_id: 'b3', datum: '2026-10-14', groep_id: 'WO-1500-T2', status: 'gegeven', gegeven_door: 'Tom', ingevuld_door: 'Jan', pin: '1234' });
  assert.ok(r.ok, r.fout);
  assert.strictEqual(r.registratie.ingevuld_door, 'Jan (beheer)');
});
ok('een les weer leeg maken (wissen)', () => {
  const r0 = post({ actie: 'registreer', verzoek_id: 'w1', datum: '2026-10-12', groep_id: 'MA-1900-T1', status: 'gegeven', gegeven_door: 'Thibaud', ingevuld_door: 'Thibaud' });
  assert.ok(r0.ok, r0.fout);
  // een andere trainer mag niet wissen
  assert.ok(!post({ actie: 'registreer', verzoek_id: 'w2', datum: '2026-10-12', groep_id: 'MA-1900-T1', status: 'gewist', ingevuld_door: 'Tom' }).ok);
  const r = post({ actie: 'registreer', verzoek_id: 'w3', datum: '2026-10-12', groep_id: 'MA-1900-T1', status: 'gewist', ingevuld_door: 'Thibaud' });
  assert.ok(r.ok, r.fout);
  assert.ok(r.gewist);
  // de les staat weer open, maar het spoor blijft in de Sheet
  assert.ok(!get().registraties.some(x => x.datum === '2026-10-12' && x.groep_id === 'MA-1900-T1'));
  const rijen = ss.getSheetByName('Registraties').d.filter(x => x[2] === 'MA-1900-T1');
  assert.deepStrictEqual(rijen.map(x => x[3]), ['gegeven', 'gewist']);
  // wissen van een lege les kan niet
  assert.ok(!post({ actie: 'registreer', verzoek_id: 'w4', datum: '2026-10-12', groep_id: 'MA-1900-T1', status: 'gewist', ingevuld_door: 'Thibaud' }).ok);
});
ok('een groep die korter loopt (vanaf en tot)', () => {
  const sh = ss.getSheetByName('Groepen');
  const rij = sh.d.find(r => r[0] === 'WO-1600-T1');
  rij[9] = new Date(2026, 8, 30, 12);  // vanaf wo 30/9
  rij[10] = new Date(2026, 11, 9, 12); // tot en met wo 9/12
  const g = get().groepen.find(x => x.id === 'WO-1600-T1');
  assert.strictEqual(g.lessen.length, 10); // tien weken, herfstvakantie valt ertussenuit
  assert.strictEqual(g.lessen[0], '2026-09-30');
  assert.strictEqual(g.lessen[9], '2026-12-09');
  assert.ok(!g.lessen.includes('2026-10-28')); // vakantie
  // buiten de periode kan je niets registreren
  assert.ok(!post({ actie: 'registreer', verzoek_id: 'k1', datum: '2026-12-16', groep_id: 'WO-1600-T1', status: 'gegeven', gegeven_door: 'Matt', ingevuld_door: 'Matt' }).ok);
  // de andere groepen blijven op twintig
  assert.strictEqual(get().groepen.find(x => x.id === 'WO-1600-T2').lessen.length, 20);
  rij[9] = ''; rij[10] = '';
});
ok('een hele dag in één oproep registreren', () => {
  const dag = '2026-10-12'; // maandag
  const d2 = get();
  const maandag = d2.groepen.filter(g => g.actief !== false && g.lessen.includes(dag));
  assert.ok(maandag.length >= 3);
  const items = maandag.map((g, i) => ({ verzoek_id: 'bulk' + i, datum: dag, groep_id: g.id, status: 'gegeven', gegeven_door: g.trainers[0] }));
  const r = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ actie: 'registreerVeel', items: items, ingevuld_door: 'Jan', pin: '1234' }) } }).tekst);
  assert.ok(r.ok);
  assert.strictEqual(r.resultaten.length, items.length);
  assert.ok(r.resultaten.every(x => x.ok), JSON.stringify(r.resultaten.filter(x => !x.ok)));
  const na = get().registraties.filter(x => x.datum === dag);
  assert.strictEqual(na.length, items.length);
  assert.strictEqual(na[0].ingevuld_door, 'Jan (beheer)');
});
ok('pincode', () => {
  assert.ok(post({ actie: 'pin', pin: '1234' }).ok);
  assert.ok(!post({ actie: 'pin', pin: '0000' }).ok);
});
ok('ochtendmail: enkel naar Jan, met de trainer erbij', () => {
  // gisteren (14/10) staan er lessen open, want alleen WO-1500-T2 is ingevuld
  const m = ctx.bouwOchtendMailJan_('2026-10-15');
  assert.strictEqual(m.aan, 'janclaessens@makefun.be');
  assert.strictEqual(m.bcc, 'bart@test');
  assert.match(m.onderwerp, /lessen van Wo 14\/10 nog niet ingevuld/);
  assert.match(m.tekst, /15:00 Elin Van Haegenbergh · T3 · Jan/);
  const gisterenBlok = m.tekst.split('Ouder dan')[0];
  assert.ok(!gisterenBlok.includes('Antoine Claessens')); // die les van 14/10 is wel ingevuld
  assert.match(m.tekst, /Ouder dan Wo 14\/10/);

  mails.length = 0;
  ctx.dagelijksSeintje(); // testdatum staat: testmodus, dus niets versturen
  assert.strictEqual(mails.length, 0);
  zetInstelling('testdatum', '');
  const echteDatum = ctx.vandaagIso_;
  ctx.vandaagIso_ = () => '2026-10-15';
  ctx.dagelijksSeintje();
  ctx.vandaagIso_ = echteDatum;
  zetInstelling('testdatum', '2026-10-15');
  assert.deepStrictEqual(mails.map(m2 => m2.to), ['janclaessens@makefun.be']); // geen trainersmails meer
});
ok('geen ochtendmail als alles ingevuld is', () => {
  const leeg = maakOmgeving();
  leeg.ctx.setup();
  leeg.zetInstelling('testdatum', '2026-09-29');
  // 28/9 volledig invullen
  const d0 = JSON.parse(leeg.ctx.doGet({ parameter: { actie: 'data' } }).tekst);
  let n = 0;
  d0.groepen.filter(g => g.lessen.includes('2026-09-28')).forEach(g => {
    const t2 = g.trainers[0] || 'Jan';
    leeg.ctx.doPost({ postData: { contents: JSON.stringify({ actie: 'registreer', verzoek_id: 'v' + (n++), datum: '2026-09-28', groep_id: g.id, status: 'gegeven', gegeven_door: t2, ingevuld_door: t2 }) } });
  });
  assert.strictEqual(leeg.ctx.bouwOchtendMailJan_('2026-09-29'), null);
});
ok('maandagmail aan Jan met bcc', () => {
  zetInstelling('testdatum', '');
  const echteDatum = ctx.vandaagIso_;
  ctx.vandaagIso_ = () => '2026-10-19';
  mails.length = 0;
  ctx.maandagMail();
  ctx.vandaagIso_ = echteDatum;
  assert.strictEqual(mails.length, 1);
  assert.strictEqual(mails[0].to, 'janclaessens@makefun.be');
  assert.strictEqual(mails[0].bcc, 'bart@test');
  assert.match(mails[0].body, /GING NIET DOOR \(1\)/);
  assert.match(mails[0].body, /stroompanne/);
});
ok('geen seintjes voor de reeks begint', () => {
  zetInstelling('testdatum', '2026-09-22');
  mails.length = 0;
  ctx.dagelijksSeintje();
  ctx.maandagMail();
  assert.strictEqual(mails.length, 0);
});
ok('werkPlanningBij: hernoemt, voegt toe en zet oude groepen stop', () => {
  const sh = ss.getSheetByName('Trainers');
  sh.d.forEach(r => { if (r[0] === 'Thibaud') { r[0] = 'Thibaut'; r[1] = 'thibaut@test'; r[4] = 'nee'; } });
  const groepen = ss.getSheetByName('Groepen');
  groepen.d.push(['OUD-0900-T1', 'ma', '09:00', '10:00', 60, 'T1', 'Oude groep', 'Tom', 'ja']);
  ctx.werkPlanningBij();
  const na = get();
  assert.ok(na.trainers.includes('Thibaud') && !na.trainers.includes('Thibaut'));
  const rij = ss.getSheetByName('Trainers').d.find(r => r[0] === 'Thibaud');
  assert.strictEqual(rij[1], 'thibaut@test'); // mailadres behouden
  assert.strictEqual(rij[4], 'nee');          // seintjes-instelling behouden
  const oud = na.groepen.find(g => g.id === 'OUD-0900-T1');
  assert.strictEqual(oud.actief, false);
  assert.strictEqual(na.groepen.filter(g => g.actief !== false).length, 32);
});
ok('stopgezette groep: geschiedenis blijft, nieuwe registraties niet', () => {
  zetInstelling('testdatum', '2026-10-15');
  ss.getSheetByName('Groepen').d.forEach(r => { if (r[0] === 'DI-1800-T1') r[8] = 'nee'; });
  const g = get().groepen.find(x => x.id === 'DI-1800-T1');
  assert.strictEqual(g.actief, false);
  assert.ok(get().registraties.some(r => r.groep_id === 'DI-1800-T1'));
  assert.ok(!post({ actie: 'registreer', verzoek_id: 'c1', datum: '2026-10-06', groep_id: 'DI-1800-T1', status: 'gegeven', gegeven_door: 'Jebbe', ingevuld_door: 'Jebbe' }).ok);
  const m = ctx.bouwOchtendMailJan_('2026-10-22');
  assert.match(m.tekst, /Ouder dan/); // de oudere open lessen staan erbij
  assert.ok(!m.tekst.includes('Di 20/10 18:00')); // die groep is stopgezet
});
ok('formules in het Overzicht met ; (Belgische taalinstelling)', () => {
  const f = ss.getSheetByName('Overzicht').d.flat().filter(x => typeof x === 'string' && x.startsWith('='));
  assert.ok(f.length > 100);
  f.filter(x => !x.includes('QUERY')).forEach(x => assert.ok(!x.includes(','), x));
  const q = f.filter(x => x.includes('QUERY'));
  assert.strictEqual(q.length, 2);
  q.forEach(x => {
    assert.ok(x.startsWith('=IFERROR(QUERY(Registraties!A2:K;"select '), x);
    assert.strictEqual(x.split('(').length, x.split(')').length, 'haakjes: ' + x);
  });
  assert.ok(f.find(x => x.includes('COUNTIFS')).includes('COUNTIFS(Registraties!$E:$E;$A5;'));
});
ok('setup overschrijft bestaande gegevens niet', () => {
  const voor = ss.getSheetByName('Registraties').getLastRow();
  ctx.setup();
  assert.strictEqual(ss.getSheetByName('Registraties').getLastRow(), voor);
});
console.log('\n' + n + ' tests geslaagd.');
