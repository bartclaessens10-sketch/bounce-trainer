/**
 * Bounce trainersapp v2 (per groep) · Google Apps Script
 * Winter 2026-2027. Spec: 20_trainersapp/v2-per-groep/spec.md
 *
 * Eén keer: setup() draaien (maakt de tabbladen en vult de startdata in),
 * daarna installeerTriggers() (seintjes). Implementeren als web-app.
 *
 * doGet  ?actie=data         -> alles wat de app nodig heeft
 * doPost {actie:'registreer'} -> een les invullen of wijzigen
 * doPost {actie:'pin'}        -> pincode voor het overzicht van Jan controleren
 */

const TAB = {
  trainers: 'Trainers',
  groepen: 'Groepen',
  lesdata: 'Lesdata',
  registraties: 'Registraties',
  instellingen: 'Instellingen',
  overzicht: 'Overzicht'
};

const KOP = {
  Trainers: ['naam', 'mail', 'gsm', 'actief', 'seintjes'],
  Groepen: ['id', 'dag', 'start', 'einde', 'duur_min', 'terrein', 'naam', 'standaardtrainer', 'actief'],
  Lesdata: ['datum', 'lesweek', 'opmerking'],
  Registraties: ['tijdstip', 'datum', 'groep_id', 'status', 'gegeven_door', 'reden', 'opmerking', 'ingevuld_door', 'telt', 'duur_min', 'verzoek_id'],
  Instellingen: ['sleutel', 'waarde', 'uitleg']
};

const REDENEN = [
  'regen of weer',
  'vakantie of feestdag',
  'trainer afwezig, geen vervanging',
  'terrein of sporthal niet beschikbaar',
  'andere'
];

const BEWERK_DAGEN = 7;
const DAGNR = { zo: 0, ma: 1, di: 2, wo: 3, do: 4, vr: 5, za: 6 };
const DAGKORT = ['Zo', 'Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za'];

/* ------------------------------------------------------------------ web-app */

function doGet(e) {
  try {
    const actie = (e && e.parameter && e.parameter.actie) || 'data';
    if (actie === 'data') return json_(Object.assign({ ok: true }, leesAlles_()));
    return json_({ ok: false, fout: 'Onbekende actie.' });
  } catch (err) {
    return json_({ ok: false, fout: String((err && err.message) || err) });
  }
}

function doPost(e) {
  try {
    const b = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (b.actie === 'pin') {
      return json_(pinKlopt_(b.pin) ? { ok: true } : { ok: false, fout: 'Verkeerde pincode.' });
    }
    if (b.actie === 'registreer') {
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        return json_(registreer_(b));
      } finally {
        lock.releaseLock();
      }
    }
    return json_({ ok: false, fout: 'Onbekende actie.' });
  } catch (err) {
    return json_({ ok: false, fout: String((err && err.message) || err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ lezen */

function leesAlles_() {
  const inst = leesInstellingen_();
  const vandaag = vandaagIso_(inst);
  // Ook stopgezette groepen (actief = nee): hun gegeven lessen blijven meetellen in de overzichten.
  const groepen = leesGroepen_();
  const kaart = lesdagKaart_();
  return {
    vandaag: vandaag,
    reeks: { start: inst.reeks_start, einde: inst.reeks_einde },
    redenen: REDENEN,
    bewerkDagen: BEWERK_DAGEN,
    trainers: leesTrainers_().filter(function (t) { return t.actief; }).map(function (t) { return t.naam; }),
    groepen: groepen.map(function (g) {
      return {
        id: g.id, dag: g.dag, start: g.start, einde: g.einde, duur: g.duur,
        terrein: g.terrein, naam: g.naam, trainers: g.trainers, actief: g.actief,
        lessen: lessenVan_(g, inst, kaart)
      };
    }),
    registraties: huidigeRegistraties_().lijst
  };
}

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function tz_() {
  return Session.getScriptTimeZone();
}

function rijen_(tab) {
  const sh = ss_().getSheetByName(tab);
  if (!sh) throw new Error('Tabblad "' + tab + '" ontbreekt. Draai eerst setup().');
  const v = sh.getDataRange().getValues();
  v.shift();
  return v;
}

function leesInstellingen_() {
  const o = {};
  rijen_(TAB.instellingen).forEach(function (r) {
    const k = String(r[0]).trim();
    if (!k) return;
    o[k] = (k === 'reeks_start' || k === 'reeks_einde' || k === 'testdatum') ? naarIso_(r[1]) : String(r[1]).trim();
  });
  return o;
}

function leesTrainers_() {
  return rijen_(TAB.trainers)
    .filter(function (r) { return String(r[0]).trim(); })
    .map(function (r) {
      return {
        naam: String(r[0]).trim(),
        mail: String(r[1]).trim(),
        actief: jaNee_(r[3], true),
        seintjes: jaNee_(r[4], true)
      };
    });
}

function leesGroepen_() {
  return rijen_(TAB.groepen)
    .filter(function (r) { return String(r[0]).trim(); })
    .map(function (r) {
      const start = naarTijd_(r[2]);
      const einde = naarTijd_(r[3]);
      return {
        id: String(r[0]).trim(),
        dag: String(r[1]).trim().toLowerCase().slice(0, 2),
        start: start,
        einde: einde,
        duur: Number(r[4]) || minuten_(einde) - minuten_(start),
        terrein: String(r[5]).trim(),
        naam: String(r[6]).trim(),
        trainers: splitsTrainers_(r[7]),
        actief: jaNee_(r[8], true)
      };
    });
}

/** "Steffi, Mat" / "Steffi en Mat" -> ['Steffi', 'Mat']. Leeg of "nog onbekend" -> []. */
function splitsTrainers_(v) {
  const s = String(v || '').trim();
  if (!s || /onbekend|volgt/i.test(s)) return [];
  return s.split(/\s*(?:,|\/|&|\ben\b)\s*/).map(function (x) { return x.trim(); }).filter(String);
}

/** datum (yyyy-MM-dd) -> true/false. Een maandag geldt voor de hele week, een andere datum enkel voor die dag. */
function lesdagKaart_() {
  const k = {};
  rijen_(TAB.lesdata).forEach(function (r) {
    const iso = naarIso_(r[0]);
    if (iso) k[iso] = jaNee_(r[1], true);
  });
  return k;
}

function isLesdag_(iso, kaart) {
  if (Object.prototype.hasOwnProperty.call(kaart, iso)) return kaart[iso];
  const ma = maandagVan_(iso);
  if (Object.prototype.hasOwnProperty.call(kaart, ma)) return kaart[ma];
  return false;
}

function lessenVan_(g, inst, kaart) {
  const uit = [];
  if (!inst.reeks_start || !inst.reeks_einde || !(g.dag in DAGNR)) return uit;
  let d = inst.reeks_start;
  while (weekdag_(d) !== DAGNR[g.dag]) d = isoPlus_(d, 1);
  for (; d <= inst.reeks_einde; d = isoPlus_(d, 7)) {
    if (isLesdag_(d, kaart)) uit.push(d);
  }
  return uit;
}

/**
 * De laatste rij per les (datum + groep) telt. `sinds` = tijdstip van de eerste
 * registratie van die les (voor de 7-dagenregel).
 */
function huidigeRegistraties_() {
  const perLes = {};
  const verzoeken = {};
  rijen_(TAB.registraties).forEach(function (r, i) {
    const datum = naarIso_(r[1]);
    const gid = String(r[2]).trim();
    if (!datum || !gid) return;
    const key = datum + '|' + gid;
    const tijdstip = r[0] instanceof Date ? r[0].toISOString() : String(r[0]);
    const vorige = perLes[key];
    perLes[key] = {
      datum: datum,
      groep_id: gid,
      status: String(r[3]).trim(),
      gegeven_door: String(r[4]).trim(),
      reden: String(r[5]).trim(),
      opmerking: String(r[6]).trim(),
      ingevuld_door: String(r[7]).trim(),
      tijdstip: tijdstip,
      sinds: vorige ? vorige.sinds : tijdstip,
      rij: i + 2
    };
    if (r[10]) verzoeken[String(r[10])] = key;
  });
  const lijst = Object.keys(perLes).map(function (k) { return perLes[k]; });
  return { perLes: perLes, verzoeken: verzoeken, lijst: lijst };
}

/* ------------------------------------------------------------------ schrijven */

function registreer_(b) {
  const inst = leesInstellingen_();
  const vandaag = vandaagIso_(inst);
  const beheer = b.pin != null && b.pin !== '' && pinKlopt_(b.pin);
  if (b.pin != null && b.pin !== '' && !beheer) return { ok: false, fout: 'Verkeerde pincode. Open het overzicht opnieuw.' };

  const huidig = huidigeRegistraties_();
  const datum = String(b.datum || '');
  const gid = String(b.groep_id || '');
  const key = datum + '|' + gid;

  // Dezelfde tik die opnieuw binnenkomt (wachtrij na een zwakke verbinding): niet dubbel wegschrijven.
  if (b.verzoek_id && huidig.verzoeken[b.verzoek_id]) {
    return { ok: true, dubbel: true, registratie: zonderRij_(huidig.perLes[huidig.verzoeken[b.verzoek_id]]) };
  }

  const g = leesGroepen_().filter(function (x) { return x.id === gid && x.actief; })[0];
  if (!g) return { ok: false, fout: 'Deze groep bestaat niet (meer).' };
  if (lessenVan_(g, inst, lesdagKaart_()).indexOf(datum) < 0) return { ok: false, fout: 'Op die datum is er geen les voor deze groep.' };

  const trainers = leesTrainers_().filter(function (t) { return t.actief; }).map(function (t) { return t.naam; });
  const ingevuldDoor = String(b.ingevuld_door || '').trim();
  if (!beheer && trainers.indexOf(ingevuldDoor) < 0) return { ok: false, fout: 'Kies eerst wie je bent.' };
  if (beheer && !ingevuldDoor) return { ok: false, fout: 'Ingevuld door ontbreekt.' };

  const status = String(b.status || '');
  let gegevenDoor = '';
  let reden = '';
  const opmerking = String(b.opmerking || '').trim().slice(0, 300);
  if (status === 'gegeven') {
    if (datum > vandaag) return { ok: false, fout: 'Een les in de toekomst kan je nog niet als gegeven invullen.' };
    gegevenDoor = String(b.gegeven_door || '').trim();
    if (trainers.indexOf(gegevenDoor) < 0) return { ok: false, fout: 'Kies wie de les gaf.' };
  } else if (status === 'niet_doorgegaan') {
    reden = String(b.reden || '').trim();
    if (REDENEN.indexOf(reden) < 0) return { ok: false, fout: 'Kies een reden.' };
    if (reden === 'andere') {
      const tekst = String(b.reden_tekst || '').trim().slice(0, 120);
      if (!tekst) return { ok: false, fout: 'Schrijf kort waarom de les niet doorging.' };
      reden = 'andere: ' + tekst;
    }
  } else {
    return { ok: false, fout: 'Onbekende status.' };
  }

  const vorige = huidig.perLes[key];
  if (vorige && !beheer) {
    const dagen = (Date.now() - new Date(vorige.sinds).getTime()) / 86400000;
    if (vorige.ingevuld_door !== ingevuldDoor) {
      return { ok: false, fout: 'Deze les is al ingevuld door ' + vorige.ingevuld_door + '. Klopt het niet? Vraag het aan Jan.' };
    }
    if (dagen > BEWERK_DAGEN) {
      return { ok: false, fout: 'Wijzigen kan tot ' + BEWERK_DAGEN + ' dagen na het invullen. Vraag het aan Jan.' };
    }
  }

  const sh = ss_().getSheetByName(TAB.registraties);
  const nu = new Date();
  sh.appendRow([
    nu, isoNaarCel_(datum), gid, status, gegevenDoor, reden, opmerking,
    beheer ? ingevuldDoor + ' (beheer)' : ingevuldDoor,
    'ja', g.duur, String(b.verzoek_id || '')
  ]);
  if (vorige) sh.getRange(vorige.rij, 9).setValue('nee');

  return {
    ok: true,
    registratie: {
      datum: datum, groep_id: gid, status: status, gegeven_door: gegevenDoor, reden: reden,
      opmerking: opmerking, ingevuld_door: beheer ? ingevuldDoor + ' (beheer)' : ingevuldDoor,
      tijdstip: nu.toISOString(), sinds: vorige ? vorige.sinds : nu.toISOString()
    }
  };
}

function zonderRij_(r) {
  const o = Object.assign({}, r);
  delete o.rij;
  return o;
}

/** Pincode op de server. Max. 10 foute pogingen per 10 minuten. */
function pinKlopt_(pin) {
  const cache = CacheService.getScriptCache();
  const fout = Number(cache.get('pinfout') || 0);
  if (fout >= 10) return false;
  const juist = String(leesInstellingen_().pincode || '').trim();
  const ok = juist.length > 0 && String(pin).trim() === juist;
  if (!ok) cache.put('pinfout', String(fout + 1), 600);
  return ok;
}

/* ------------------------------------------------------------------ seintjes */

/** Open lessen = datum voor vandaag, binnen de reeks, nog niets ingevuld. */
function openLessen_(vandaag) {
  const inst = leesInstellingen_();
  const kaart = lesdagKaart_();
  const regs = huidigeRegistraties_().perLes;
  const uit = [];
  leesGroepen_().filter(function (g) { return g.actief; }).forEach(function (g) {
    lessenVan_(g, inst, kaart).forEach(function (d) {
      if (d < vandaag && !regs[d + '|' + g.id]) uit.push({ datum: d, groep: g });
    });
  });
  uit.sort(function (a, b) { return (a.datum + a.groep.start).localeCompare(b.datum + b.groep.start); });
  return uit;
}

function lesLabel_(datum, g) {
  const p = datum.split('-');
  return DAGKORT[weekdag_(datum)] + ' ' + Number(p[2]) + '/' + Number(p[1]) + ' ' + g.start + ' ' + g.naam + ' · ' + g.terrein;
}

/** Eén mail per trainer met al zijn open lessen. Trainer zonder mail of met seintjes "nee": geen mail. */
function bouwTrainerMails_(vandaag) {
  const inst = leesInstellingen_();
  const open = openLessen_(vandaag);
  return leesTrainers_()
    .filter(function (t) { return t.actief; })
    .map(function (t) {
      const zijn = open.filter(function (o) { return o.groep.trainers.indexOf(t.naam) >= 0; });
      if (!zijn.length) return null;
      const meer = zijn.length > 1;
      return {
        naam: t.naam,
        aan: t.mail,
        mag: !!t.mail && t.seintjes,
        onderwerp: meer ? 'Bounce: vergeet je deze ' + zijn.length + ' lessen niet in te vullen?' : 'Bounce: vergeet je deze les niet in te vullen?',
        tekst: 'Dag ' + t.naam + ',\n\n' +
          (meer ? 'Deze lessen staan nog open' : 'Deze les staat nog open') + ' in de trainersapp:\n\n' +
          zijn.map(function (o) { return '- ' + lesLabel_(o.datum, o.groep); }).join('\n') +
          '\n\nEén tik per les volstaat: ' + (inst.app_url || '') +
          '\n\nGaf iemand anders de les, of ging ze niet door? Dat kan je daar ook aanduiden.\n\nBounce'
      };
    })
    .filter(Boolean);
}

function bouwJanMail_(vandaag) {
  const inst = leesInstellingen_();
  const van = isoPlus_(maandagVan_(vandaag), -7);
  const tot = isoPlus_(van, 5);
  const open = openLessen_(vandaag);
  const vorigeWeek = open.filter(function (o) { return o.datum >= van && o.datum <= tot; });
  const ouder = open.filter(function (o) { return o.datum < van; });
  const groepen = {};
  leesGroepen_().forEach(function (g) { groepen[g.id] = g; });
  const niet = huidigeRegistraties_().lijst
    .filter(function (r) { return r.status === 'niet_doorgegaan' && r.datum >= van && r.datum <= tot && groepen[r.groep_id]; })
    .sort(function (a, b) { return (a.datum + groepen[a.groep_id].start).localeCompare(b.datum + groepen[b.groep_id].start); });

  const p = van.split('-');
  const regels = [];
  regels.push('Dag Jan,', '', 'Zo stond het vorige week (vanaf maandag ' + Number(p[2]) + '/' + Number(p[1]) + ') in de trainersapp.', '');
  regels.push('NOG NIET INGEVULD (' + vorigeWeek.length + ')');
  if (vorigeWeek.length) {
    vorigeWeek.forEach(function (o) {
      regels.push('- ' + lesLabel_(o.datum, o.groep) + ' (' + (o.groep.trainers.join(', ') || 'trainer nog onbekend') + ')');
    });
  } else {
    regels.push('Alles is ingevuld.');
  }
  if (ouder.length) regels.push('', 'Daarnaast staan er nog ' + ouder.length + ' oudere lessen open. Je ziet ze in je overzicht.');
  regels.push('', 'GING NIET DOOR (' + niet.length + ')');
  if (niet.length) {
    niet.forEach(function (r) { regels.push('- ' + lesLabel_(r.datum, groepen[r.groep_id]) + ': ' + r.reden); });
  } else {
    regels.push('Geen.');
  }
  regels.push('', 'Je overzicht: ' + (inst.app_url || '') + '?jan', '', 'Bounce trainersapp');
  return {
    aan: inst.mail_jan,
    bcc: inst.bcc,
    onderwerp: 'Bounce: lessen vorige week (' + vorigeWeek.length + ' open, ' + niet.length + ' niet doorgegaan)',
    tekst: regels.join('\n')
  };
}

/** Trigger: elke dag rond 12:00. */
function dagelijksSeintje() {
  const inst = leesInstellingen_();
  const vandaag = vandaagIso_(inst);
  if (inst.testdatum) return; // testmodus: nooit echte seintjes versturen
  if (inst.reeks_start && vandaag <= inst.reeks_start) return;
  bouwTrainerMails_(vandaag).forEach(function (m) {
    if (!m.mag) return;
    MailApp.sendEmail({ to: m.aan, subject: m.onderwerp, body: m.tekst, name: 'Bounce trainersapp' });
  });
}

/** Trigger: elke maandag rond 8:00. */
function maandagMail() {
  const inst = leesInstellingen_();
  const vandaag = vandaagIso_(inst);
  if (inst.testdatum) return; // testmodus: nooit echte seintjes versturen
  if (inst.reeks_start && vandaag <= inst.reeks_start) return;
  const m = bouwJanMail_(vandaag);
  if (!m.aan) return;
  const opties = { to: m.aan, subject: m.onderwerp, body: m.tekst, name: 'Bounce trainersapp' };
  if (m.bcc) opties.bcc = m.bcc;
  MailApp.sendEmail(opties);
}

/** Test: stuurt alle seintjes van vandaag naar jezelf (niet naar de trainers of Jan). */
function testSeintjes() {
  const ik = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
  const vandaag = vandaagIso_(leesInstellingen_());
  const mails = bouwTrainerMails_(vandaag);
  mails.forEach(function (m) {
    MailApp.sendEmail({
      to: ik,
      subject: '[TEST voor ' + m.naam + (m.mag ? '' : ', zou NIET verstuurd worden: geen mail of seintjes uit') + '] ' + m.onderwerp,
      body: m.tekst, name: 'Bounce trainersapp'
    });
  });
  const j = bouwJanMail_(vandaag);
  MailApp.sendEmail({ to: ik, subject: '[TEST voor Jan] ' + j.onderwerp, body: j.tekst, name: 'Bounce trainersapp' });
  Logger.log('Verstuurd naar ' + ik + ': ' + mails.length + ' trainersmail(s) en 1 mail voor Jan.');
}

function installeerTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['dagelijksSeintje', 'maandagMail'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dagelijksSeintje').timeBased().everyDays(1).atHour(12).inTimezone('Europe/Brussels').create();
  ScriptApp.newTrigger('maandagMail').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).inTimezone('Europe/Brussels').create();
  Logger.log('Triggers staan: elke dag rond 12:00 en elke maandag rond 8:00.');
}

/* ------------------------------------------------------------------ menu in de Sheet */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Bounce')
    .addItem('Seintjes testen (naar mij)', 'testSeintjes')
    .addItem('Overzicht opnieuw opbouwen', 'bouwOverzicht')
    .addToUi();
}

/* ------------------------------------------------------------------ datums */

function vandaagIso_(inst) {
  if (inst && inst.testdatum) return inst.testdatum;
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
}

function naarIso_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}

function naarTijd_(v) {
  if (v instanceof Date) return ('0' + v.getHours()).slice(-2) + ':' + ('0' + v.getMinutes()).slice(-2);
  const m = String(v || '').trim().match(/^(\d{1,2})[:.u]?(\d{2})?/);
  if (!m) return '';
  return ('0' + m[1]).slice(-2) + ':' + (m[2] || '00');
}

function minuten_(t) {
  const p = String(t).split(':');
  return Number(p[0]) * 60 + Number(p[1] || 0);
}

function isoPlus_(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekdag_(iso) {
  return new Date(iso + 'T00:00:00Z').getUTCDay();
}

function maandagVan_(iso) {
  return isoPlus_(iso, -((weekdag_(iso) + 6) % 7));
}

/** Datum in een cel: 12:00 's middags, zodat een tijdzoneverschil nooit een dag verschuift. */
function isoNaarCel_(iso) {
  const p = iso.split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0);
}

function jaNee_(v, standaard) {
  if (v === true || v === false) return v;
  const s = String(v || '').trim().toLowerCase();
  if (!s) return standaard;
  return s === 'ja' || s === 'j' || s === 'yes' || s === 'true' || s === 'x' || s === '1';
}

/* ------------------------------------------------------------------ setup + startdata */

/**
 * Eén keer draaien. Maakt ontbrekende tabbladen en vult ze met de startdata.
 * Een tabblad dat al gegevens bevat, wordt NIET overschreven.
 */
function setup() {
  const ss = ss_();
  ss.setSpreadsheetTimeZone('Europe/Brussels');
  if (tz_() !== 'Europe/Brussels') {
    Logger.log('LET OP: de tijdzone van het script is ' + tz_() + '. Zet ze op Europe/Brussels (Projectinstellingen).');
  }

  maakTab_(TAB.trainers, KOP.Trainers, [
    ['Jan', 'janclaessens@makefun.be', '', 'ja', 'ja'],
    ['Thibaut', '', '', 'ja', 'ja'],
    ['Jebbe', '', '', 'ja', 'ja'],
    ['Bekin', '', '', 'ja', 'ja'],
    ['Steffi', '', '', 'ja', 'ja'],
    ['Tom', '', '', 'ja', 'ja'],
    ['Mat', '', '', 'ja', 'ja'],
    ['Amir', '', '', 'ja', 'ja'],
    ['Luna', '', '', 'ja', 'ja']
  ], ['@', '@', '@', '@', '@']);

  const G = [
    ['ma', '16:00', '17:30', 'T1', 'Jeugd', 'Jan'],
    ['ma', '16:00', '17:30', 'T2', 'Jeugd', 'Jan'],
    ['ma', '19:00', '20:00', 'T1', 'Volwassenen', 'Thibaut'],
    ['ma', '20:00', '21:00', 'T1', 'Volwassenen', 'Thibaut'],
    ['di', '17:00', '18:00', 'T1', 'Jeugd', ''],
    ['di', '18:00', '19:00', 'T1', 'Jeugd', 'Jebbe'],
    ['di', '20:30', '21:30', 'T1', 'Volwassenen', 'Bekin'],
    ['di', '21:30', '22:30', 'T1', 'Volwassenen', 'Bekin'],
    ['wo', '14:00', '15:00', 'T1', 'Jeugd', 'Steffi'],
    ['wo', '14:00', '15:00', 'T2', 'Jeugd', 'Tom'],
    ['wo', '15:00', '16:00', 'T1', 'Wit en Blauw (3-5j)', 'Steffi, Mat'],
    ['wo', '15:00', '16:00', 'T2', 'Rood A (6-8j)', 'Tom'],
    ['wo', '15:00', '16:00', 'T3', 'Rood B (6-8j)', 'Jan'],
    ['wo', '16:00', '17:00', 'T1', 'Jeugd', 'Mat'],
    ['wo', '16:00', '17:00', 'T2', 'Jeugd', 'Tom'],
    ['wo', '17:00', '18:00', 'T1', 'Jeugd', 'Mat'],
    ['wo', '17:00', '18:00', 'T2', 'Jeugd', 'Tom'],
    ['wo', '18:00', '19:00', 'T1', 'Volwassenen', 'Jan'],
    ['wo', '18:00', '19:00', 'T2', 'Jeugd', 'Tom'],
    ['wo', '19:00', '20:00', 'T1', 'Dames', 'Amir'],
    ['wo', '19:00', '20:00', 'T2', 'Volwassenen', 'Jan'],
    ['wo', '20:00', '21:00', 'T1', 'Volwassenen', 'Jan'],
    ['wo', '20:00', '21:00', 'T2', 'Dames', 'Amir'],
    ['wo', '21:00', '22:00', 'T1', 'Heren', 'Amir'],
    ['do', '19:00', '20:00', 'T1', 'Jeugd / privé', 'Luna'],
    ['do', '20:00', '21:00', 'T1', 'Dames', 'Luna'],
    ['vr', '16:00', '17:00', 'T1', 'Jeugd', 'Jebbe'],
    ['vr', '17:00', '18:00', 'T1', 'Jeugd', 'Jebbe'],
    ['vr', '18:00', '19:00', 'T1', 'Jeugd', ''],
    ['za', '10:00', '11:00', 'T2', 'Wit/Blauw (proefles 3/10)', 'Mat'],
    ['za', '10:00', '11:00', 'T3', 'Rood A', 'Amir'],
    ['za', '11:00', '12:00', 'T2', 'Volwassene (privé)', 'Amir'],
    ['za', '11:00', '12:00', 'T3', 'Rood B', '']
  ];
  maakTab_(TAB.groepen, KOP.Groepen, G.map(function (r) {
    const id = r[0].toUpperCase() + '-' + r[1].replace(':', '') + '-' + r[3];
    return [id, r[0], r[1], r[2], minuten_(r[2]) - minuten_(r[1]), r[3], r[4], r[5], 'ja'];
  }), ['@', '@', '@', '@', '0', '@', '@', '@', '@']);

  // Lesweken: een rij per week (de maandag). Vakanties op "nee".
  const nee = {
    '2026-10-26': 'herfstvakantie', '2026-11-02': 'herfstvakantie',
    '2026-12-21': 'kerstvakantie', '2026-12-28': 'kerstvakantie',
    '2027-02-08': 'krokusvakantie', '2027-02-15': 'krokusvakantie'
  };
  const weken = [];
  for (let d = '2026-09-28'; d <= '2027-03-22'; d = isoPlus_(d, 7)) {
    weken.push([isoNaarCel_(d), nee[d] ? 'nee' : 'ja', nee[d] ? nee[d] + ' (te bevestigen door Jan)' : '']);
  }
  maakTab_(TAB.lesdata, KOP.Lesdata, weken, ['dd/mm/yyyy', '@', '@']);

  maakTab_(TAB.registraties, KOP.Registraties, [], ['dd/mm/yyyy hh:mm', 'dd/mm/yyyy', '@', '@', '@', '@', '@', '@', '@', '0', '@']);

  maakTab_(TAB.instellingen, KOP.Instellingen, [
    ['pincode', '1234', 'Pincode (4 cijfers) voor het overzicht van Jan. Tijdelijk 1234.'],
    ['mail_jan', 'janclaessens@makefun.be', 'Krijgt elke maandag om 8:00 het weekoverzicht.'],
    ['bcc', Session.getEffectiveUser().getEmail(), 'Krijgt de maandagmail in bcc (standaard: wie setup draaide).'],
    ['app_url', 'https://bartclaessens10-sketch.github.io/bounce-trainer/v2/', 'Link in de seintjes.'],
    ['reeks_start', '2026-09-28', 'Eerste lesdag van de reeks (jjjj-mm-dd).'],
    ['reeks_einde', '2027-03-27', 'Laatste lesdag van de reeks (jjjj-mm-dd).'],
    ['testdatum', '', 'ALLEEN OM TE TESTEN: doet alsof het vandaag deze datum is. Leeg = echte datum.']
  ], ['@', '@', '@']);

  bouwOverzicht();
  const leeg = ss.getSheetByName('Blad1') || ss.getSheetByName('Sheet1');
  if (leeg && ss.getSheets().length > 1 && leeg.getLastRow() === 0) ss.deleteSheet(leeg);
  Logger.log('Setup klaar.');
}

function maakTab_(naam, kop, data, formaten) {
  const ss = ss_();
  let sh = ss.getSheetByName(naam);
  if (sh && sh.getLastRow() > 1) {
    Logger.log('"' + naam + '" bevat al gegevens: niet overschreven.');
    return sh;
  }
  if (!sh) sh = ss.insertSheet(naam);
  sh.clear();
  formaten.forEach(function (f, i) { sh.getRange(1, i + 1, 1000, 1).setNumberFormat(f); });
  sh.getRange(1, 1, 1, kop.length).setValues([kop]).setFontWeight('bold').setBackground('#FFDD00');
  if (data.length) sh.getRange(2, 1, data.length, kop.length).setValues(data);
  sh.setFrozenRows(1);
  return sh;
}

/**
 * Tabblad Overzicht: formules, ook bruikbaar zonder app.
 * Telt alleen rijen met telt = "ja" (de laatste registratie per les).
 */
function bouwOverzicht() {
  const ss = ss_();
  const inst = leesInstellingen_();
  let sh = ss.getSheetByName(TAB.overzicht);
  if (!sh) sh = ss.insertSheet(TAB.overzicht);
  sh.clear();

  const maanden = [];
  let m = (inst.reeks_start || '2026-09-28').slice(0, 7);
  const tot = (inst.reeks_einde || '2027-03-27').slice(0, 7);
  while (m <= tot) {
    maanden.push(m);
    const p = m.split('-').map(Number);
    m = p[1] === 12 ? (p[0] + 1) + '-01' : p[0] + '-' + ('0' + (p[1] + 1)).slice(-2);
  }
  const n = maanden.length;
  const R = "Registraties!";
  // Formules gebruiken het scheidingsteken van de taalinstelling van de Sheet:
  // "," in het Engels, ";" in o.a. nl_BE en fr_BE (waar de komma het decimaalteken is).
  const sep = /^(en|ja|zh|ko|th|he|iw|hi)/i.test(ss.getSpreadsheetLocale()) ? ',' : ';';
  const lok = function (f) { return sep === ',' ? f : f.replace(/,/g, sep); };
  const blokken = [
    { titel: 'Gegeven lessen per trainer per maand', extra: '' },
    { titel: 'Waarvan lessen van 1,5 uur (90 min of langer)', extra: ',' + R + '$J:$J,">=90"' }
  ];
  const RIJEN = 25;
  let rij = 1;
  sh.getRange(rij, 1).setValue('Overzicht · telt enkel de laatste registratie per les · automatisch berekend, niet aanpassen').setFontStyle('italic');
  rij += 2;
  blokken.forEach(function (b) {
    sh.getRange(rij, 1).setValue(b.titel).setFontWeight('bold');
    rij++;
    const kop = sh.getRange(rij, 1, 1, n + 2);
    const koprij = ['Trainer'];
    maanden.forEach(function (mm) { koprij.push(isoNaarCel_(mm + '-01')); });
    koprij.push('Totaal');
    kop.setValues([koprij]).setFontWeight('bold').setBackground('#FFDD00');
    sh.getRange(rij, 2, 1, n).setNumberFormat('mmm yyyy');
    const kopRij = rij;
    const formules = [];
    for (let i = 0; i < RIJEN; i++) {
      const r = rij + 1 + i;
      const f = ['=IFERROR(INDEX(FILTER(Trainers!$A$2:$A,Trainers!$A$2:$A<>""),' + (i + 1) + '),"")'];
      for (let c = 0; c < n; c++) {
        const col = kolom_(c + 2);
        f.push('=IF($A' + r + '="","",COUNTIFS(' + R + '$E:$E,$A' + r + ',' + R + '$D:$D,"gegeven",' + R + '$I:$I,"ja",' +
          R + '$B:$B,">="&' + col + '$' + kopRij + ',' + R + '$B:$B,"<"&EDATE(' + col + '$' + kopRij + ',1)' + b.extra + '))');
      }
      f.push('=IF($A' + r + '="","",SUM(B' + r + ':' + kolom_(n + 1) + r + '))');
      formules.push(f);
    }
    sh.getRange(rij + 1, 1, RIJEN, n + 2).setFormulas(formules.map(function (r) { return r.map(lok); }));
    rij += RIJEN + 2;
  });

  sh.getRange(rij, 1).setValue('Niet doorgegaan per maand (alle groepen)').setFontWeight('bold');
  rij++;
  const kopRij = rij;
  const koprij = [''];
  maanden.forEach(function (mm) { koprij.push(isoNaarCel_(mm + '-01')); });
  sh.getRange(rij, 1, 1, n + 1).setValues([koprij]).setFontWeight('bold').setBackground('#FFDD00');
  sh.getRange(rij, 2, 1, n).setNumberFormat('mmm yyyy');
  const f = [];
  for (let c = 0; c < n; c++) {
    const col = kolom_(c + 2);
    f.push('=COUNTIFS(' + R + '$D:$D,"niet_doorgegaan",' + R + '$I:$I,"ja",' + R + '$B:$B,">="&' + col + '$' + kopRij + ',' + R + '$B:$B,"<"&EDATE(' + col + '$' + kopRij + ',1))');
  }
  sh.getRange(rij + 1, 1).setValue('Aantal lessen');
  sh.getRange(rij + 1, 2, 1, n).setFormulas([f.map(lok)]);
  sh.setColumnWidth(1, 160);
  sh.setFrozenColumns(1);
}

function kolom_(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
