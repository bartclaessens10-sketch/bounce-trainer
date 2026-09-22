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
ok('33 groepen, 9 trainers', () => {
  assert.strictEqual(d.groepen.length, 33);
  assert.strictEqual(d.trainers.length, 9);
});
ok('20 lesweken per groep, vakanties eruit', () => {
  d.groepen.forEach(g => assert.strictEqual(g.lessen.length, 20, g.id));
  const wo = d.groepen.find(g => g.id === 'WO-1500-T2');
  assert.strictEqual(wo.lessen[0], '2026-09-30');
  assert.strictEqual(wo.lessen[2], '2026-10-14');
  assert.ok(!wo.lessen.includes('2026-10-28'));
  assert.ok(!wo.lessen.includes('2026-12-23'));
  assert.strictEqual(wo.lessen[19], '2027-03-24');
  const za = d.groepen.find(g => g.id === 'ZA-1000-T2');
  assert.strictEqual(za.lessen[0], '2026-10-03');
});
ok('duo-trainer en onbekende trainer', () => {
  assert.deepStrictEqual(d.groepen.find(g => g.id === 'WO-1500-T1').trainers, ['Steffi', 'Mat']);
  assert.deepStrictEqual(d.groepen.find(g => g.id === 'DI-1700-T1').trainers, []);
  assert.strictEqual(d.groepen.find(g => g.id === 'MA-1600-T1').duur, 90);
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
  assert.ok(!post({ actie: 'registreer', verzoek_id: 'a4', datum: '2026-10-13', groep_id: 'DI-1800-T1', status: 'niet_doorgegaan', reden: 'andere', ingevuld_door: 'Jebbe' }).ok);
  const r = post({ actie: 'registreer', verzoek_id: 'a5', datum: '2026-10-13', groep_id: 'DI-1800-T1', status: 'niet_doorgegaan', reden: 'andere', reden_tekst: 'stroompanne', ingevuld_door: 'Jebbe' });
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
ok('pincode', () => {
  assert.ok(post({ actie: 'pin', pin: '1234' }).ok);
  assert.ok(!post({ actie: 'pin', pin: '0000' }).ok);
});
ok('seintjes: één mail per trainer, alle open lessen samen', () => {
  const tm = ctx.bouwTrainerMails_('2026-10-15');
  const tom = tm.find(m => m.naam === 'Tom');
  assert.ok(tom && !tom.mag); // Tom heeft (nog) geen mailadres
  const jan = tm.find(m => m.naam === 'Jan');
  assert.ok(jan.mag);
  assert.strictEqual(jan.aan, 'janclaessens@makefun.be');
  assert.match(jan.tekst, /Ma 28\/9 16:00 Jeugd · T1/);
  assert.ok(!/Rood B \(6-8j\)/.test(tom.tekst));
  // Steffi en Mat krijgen allebei de duo-groep
  assert.match(tm.find(m => m.naam === 'Steffi').tekst, /Wit en Blauw/);
  assert.match(tm.find(m => m.naam === 'Mat').tekst, /Wit en Blauw/);
  mails.length = 0;
  ctx.dagelijksSeintje();
  assert.deepStrictEqual(mails.map(m => m.to), ['janclaessens@makefun.be']);
});
ok('maandagmail aan Jan met bcc', () => {
  zetInstelling('testdatum', '2026-10-19');
  mails.length = 0;
  ctx.maandagMail();
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
ok('stopgezette groep: geschiedenis blijft, nieuwe registraties niet', () => {
  zetInstelling('testdatum', '2026-10-15');
  ss.getSheetByName('Groepen').d.forEach(r => { if (r[0] === 'DI-1800-T1') r[8] = 'nee'; });
  const g = get().groepen.find(x => x.id === 'DI-1800-T1');
  assert.strictEqual(g.actief, false);
  assert.ok(get().registraties.some(r => r.groep_id === 'DI-1800-T1'));
  assert.ok(!post({ actie: 'registreer', verzoek_id: 'c1', datum: '2026-10-06', groep_id: 'DI-1800-T1', status: 'gegeven', gegeven_door: 'Jebbe', ingevuld_door: 'Jebbe' }).ok);
  const jebbe = ctx.bouwTrainerMails_('2026-10-22').find(m => m.naam === 'Jebbe');
  assert.ok(jebbe.tekst.includes('Vr 16/10 16:00'));
  assert.ok(!jebbe.tekst.includes('Di 20/10 18:00')); // geen open lessen meer voor een stopgezette groep
});
ok('setup overschrijft bestaande gegevens niet', () => {
  const voor = ss.getSheetByName('Registraties').getLastRow();
  ctx.setup();
  assert.strictEqual(ss.getSheetByName('Registraties').getLastRow(), voor);
});
console.log('\n' + n + ' tests geslaagd.');
