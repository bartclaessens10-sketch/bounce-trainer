// Nagebootste Google Apps Script-omgeving om Code.gs lokaal te testen.
// Alleen wat Code.gs gebruikt. Geen afhankelijkheden.
process.env.TZ = 'Europe/Brussels';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function maakOmgeving() {
  const mails = [];
  const cache = {};

  class Range {
    constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
    getValues() {
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const rij = [];
        for (let j = 0; j < this.nc; j++) {
          const v = (this.sh.d[this.r - 1 + i] || [])[this.c - 1 + j];
          rij.push(v === undefined ? '' : v);
        }
        out.push(rij);
      }
      return out;
    }
    setValues(v) {
      v.forEach((rij, i) => rij.forEach((x, j) => this.sh.zet(this.r + i, this.c + j, x)));
      return this;
    }
    setValue(x) { this.sh.zet(this.r, this.c, x); return this; }
    setFormulas(v) { return this.setValues(v); }
    setNumberFormat() { return this; }
    setFontWeight() { return this; }
    setFontStyle() { return this; }
    setBackground() { return this; }
  }

  class Sheet {
    constructor(naam) { this.naam = naam; this.d = []; }
    getName() { return this.naam; }
    zet(r, c, x) {
      while (this.d.length < r) this.d.push([]);
      const rij = this.d[r - 1];
      while (rij.length < c) rij.push('');
      rij[c - 1] = x;
    }
    getLastRow() {
      for (let i = this.d.length; i > 0; i--) if (this.d[i - 1].some(x => x !== '' && x != null)) return i;
      return 0;
    }
    getLastColumn() { return Math.max(0, ...this.d.map(r => r.length)); }
    getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
    getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
    appendRow(rij) { const r = this.getLastRow() + 1; rij.forEach((x, j) => this.zet(r, j + 1, x)); return this; }
    clear() { this.d = []; return this; }
    setFrozenRows() {} setFrozenColumns() {} setColumnWidth() {}
  }

  const sheets = [new Sheet('Blad1')];
  let ssTz = 'Etc/UTC';
  const ss = {
    getSheetByName: n => sheets.find(s => s.naam === n) || null,
    insertSheet: n => { const s = new Sheet(n); sheets.push(s); return s; },
    getSheets: () => sheets.slice(),
    deleteSheet: s => sheets.splice(sheets.indexOf(s), 1),
    setSpreadsheetTimeZone: t => { ssTz = t; },
    getSpreadsheetTimeZone: () => ssTz
  };

  function formatDate(d, tz, patroon) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(d).map(x => [x.type, x.value]));
    return patroon.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day)
      .replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
  }

  const ctx = {
    console, Date, JSON, Math, Object, String, Number, Array, RegExp, Error,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      getActive: () => ss,
      getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addToUi() {} }) })
    },
    Session: {
      getScriptTimeZone: () => 'Europe/Brussels',
      getActiveUser: () => ({ getEmail: () => 'bart@test' }),
      getEffectiveUser: () => ({ getEmail: () => 'bart@test' })
    },
    Utilities: { formatDate },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: t => ({ tekst: t, setMimeType() { return this; } })
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: {
      getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; } })
    },
    MailApp: { sendEmail: o => mails.push(o) },
    ScriptApp: { getProjectTriggers: () => [], WeekDay: { MONDAY: 'MONDAY' } },
    Logger: { log: () => {} }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });

  function zetInstelling(sleutel, waarde) {
    const sh = ss.getSheetByName('Instellingen');
    sh.d.forEach(r => { if (r[0] === sleutel) r[1] = waarde; });
  }
  return { ctx, ss, mails, cache, zetInstelling };
}

module.exports = { maakOmgeving };
