// Reads the JCL Tracker Google Sheet (read-only) with a service account.
// Layout confirmed from the tracker probe (see README):
//   Monthly tabs ("January '26" …): A team letter | B case name (fill color = case type, red = chargeback) |
//     C date packaged | D source | E complaint drafted | F filing status (free text) | G–K weekly goal block.
//     A text row in B such as "Approved for Conditional Retainer" starts a section of conditional retainers.
//   All-Time Packaged Cases: B case | G date filed (may say "Filed AAA") | H status note ("Pre-Suit…").
//   Status: Attorney Review Sent: pre-packaging checklist. Scheduling Orders: AAA arbitrations (strikethrough = closed).
//   All-Time Referred Out: cases referred to other firms, Paid / Unpaid.
import crypto from 'node:crypto';

const b64url = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
async function token(sa) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: sa.token_uri || 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = b64url(crypto.createSign('RSA-SHA256').update(`${head}.${claim}`).sign(sa.private_key));
  const r = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }) });
  const j = await r.json();
  if (!j.access_token) throw new Error('Google token failed: ' + JSON.stringify(j).slice(0, 300));
  return j.access_token;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const rgb = (c) => (c ? [c.red ?? 0, c.green ?? 0, c.blue ?? 0].map((x) => Math.round(x * 255)) : null);
const isRed = (c) => { const x = rgb(c); return !!x && x[0] > 200 && x[1] < 90 && x[2] < 90; };
const isWhite = (x) => !x || (x[0] > 250 && x[1] > 250 && x[2] > 250);
const txt = (v) => (v?.formattedValue ?? '').toString().trim();
const bg = (v) => v?.effectiveFormat?.backgroundColor;
const q = (t) => `'${t.replace(/'/g, "''")}'`;
const isCase = (s) => /\sv\.?\s|\svs\.?\s/i.test(s);
const isDate = (s) => /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(s);
const toIso = (s, year) => { const d = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/); if (!d) return null; const y = d[3] ? (d[3].length === 2 ? '20' + d[3] : d[3]) : String(year); return `${y}-${d[1].padStart(2, '0')}-${d[2].padStart(2, '0')}`; };

// Filing column text → status. Examples seen: "Filed", "Filed 3/4", "Pre-Suit sent on 5/1-Due date 5/31-Filed AAA 6/9",
// "Pre-Suit sent on 1/5 failed-Filed 2/2", "Pre-Suit sent on 7/2", a bare date (Aug/Sep '26 "Filings" column).
export function filingStatus(f, note = '') {
  const s = `${f} ${note}`.toLowerCase();
  const presuit = /pre-?\s?suit|presuit/.test(s);
  const filed = /\bfiled\b/.test(s) || (!presuit && isDate(String(f).trim()));
  const aaa = /\baaa\b/.test(s), court = /court/.test(s);
  const status = filed ? (aaa ? 'Filed with AAA' : court ? 'Filed in court' : 'Filed') : presuit ? 'Pre-suit demand out' : 'Not yet filed';
  return { presuit, filed, status, dateOnly: filed && isDate(String(f).trim()) };
}

export async function sheetPull(cfg) {
  const sa = JSON.parse(process.env.GOOGLE_SA_JSON);
  const tok = await token(sa), id = cfg.sheet.id, year = cfg.sheet.year, yy = String(year).slice(2);
  const api = async (params) => {
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?${params}`, { headers: { Authorization: `Bearer ${tok}` } });
    const j = await r.json();
    if (!r.ok) throw new Error(`Sheets ${r.status}: ${JSON.stringify(j).slice(0, 300)}` + (r.status === 403 ? ' — share the sheet with the service account email as Viewer.' : ''));
    return j;
  };
  const titles = (await api(new URLSearchParams({ fields: 'sheets.properties.title' }))).sheets.map((s) => s.properties.title);
  const monthTabs = titles.map((t) => ({ t, m: MONTHS.findIndex((M) => new RegExp(`^${M}\\s*'${yy}\\s*$`, 'i').test(t.trim())) })).filter((x) => x.m >= 0);
  const find = (re) => titles.find((t) => re.test(t));
  const allTab = find(/all.?time packaged/i), refTab = find(/referred out/i), prepTab = find(/attorney review sent/i), schedTab = find(/scheduling orders/i);

  const p = new URLSearchParams({ includeGridData: 'true', fields: 'sheets(properties.title,data.rowData.values(formattedValue,effectiveFormat.backgroundColor,effectiveFormat.textFormat.strikethrough))' });
  for (const x of monthTabs) p.append('ranges', `${q(x.t)}!A1:K400`);
  for (const t of [allTab, refTab, prepTab, schedTab].filter(Boolean)) p.append('ranges', `${q(t)}!A1:J2000`);
  const grid = await api(p);
  const tabs = Object.fromEntries(grid.sheets.map((s) => [s.properties.title, s.data?.[0]?.rowData || []]));

  // Case-type color key (label in col I, color in col J) — read from any tab that has one.
  const key = [];
  for (const rows of Object.values(tabs)) for (const r of rows) {
    const v = r.values || [], label = txt(v[8]).toUpperCase(), c = rgb(bg(v[9]));
    if (/^(CROA|FCRA|TCPA|FDCPA|OTHER|EMPLOYMENT)$/.test(label) && c && !isWhite(c) && !key.some((k) => k.label === label && k.c.join() === c.join())) key.push({ label, c });
  }
  const typeOf = (cell) => {
    const c = rgb(bg(cell)); if (!c || isWhite(c) || isRed(bg(cell)) || !key.length) return null;
    const best = key.map((k) => ({ k, d: k.c.reduce((a, x, i) => a + (x - c[i]) ** 2, 0) })).sort((a, b) => a.d - b.d)[0];
    return best.d < 2500 ? best.k.label : null;
  };

  // All-Time tab: red rows and status notes, by case name.
  const allInfo = new Map();
  for (const r of (tabs[allTab] || []).slice(1)) {
    const v = r.values || [], name = txt(v[1]); if (!isCase(name)) continue;
    allInfo.set(name.toLowerCase(), { red: isRed(bg(v[1])), filedText: txt(v[6]), note: txt(v[7]), referred: txt(v[4]) });
  }

  const rows = [], conditional = [], goals = [];
  for (const x of monthTabs) {
    const m = `${year}-${String(x.m + 1).padStart(2, '0')}`, data = tabs[x.t] || [];
    const goalHeader = data.slice(0, 3).some((r) => /^goal$/i.test(txt(r.values?.[7])));
    let section = 'packaged';
    for (const r of data.slice(1)) {
      const v = r.values || [], name = txt(v[1]);
      // Weekly goal block (G date | H goal | I packaged count), only on tabs whose header says "Goal".
      if (goalHeader && isDate(txt(v[6])) && /^\d+$/.test(txt(v[7]))) goals.push({ m, week: toIso(txt(v[6]), year), goal: +txt(v[7]), count: /^\d+$/.test(txt(v[8])) ? +txt(v[8]) : null });
      if (!name) continue;
      if (!isCase(name)) { if (/conditional/i.test(name)) section = 'conditional'; continue; }
      if (section === 'conditional') { conditional.push({ m, member: txt(v[2]) || txt(v[0]) || '—' }); continue; }
      const ai = allInfo.get(name.toLowerCase()) || {};
      const f = filingStatus(txt(v[5]) || ai.filedText || '', ai.note || '');
      rows.push({ name, member: txt(v[0]) || '—', date: toIso(txt(v[2]), year), m, source: txt(v[3]) || 'Not recorded',
        drafted: txt(v[4]), filing: txt(v[5]), stype: typeOf(v[1]), red: isRed(bg(v[1])) || !!ai.red,
        isPresuit: f.presuit, isFiled: f.filed, filingStatus: f.status, dateOnly: f.dateOnly, isDrafted: isDate(txt(v[4])) });
    }
  }

  // Before packaging: Attorney Review Sent checklist.
  const prep = { cases: 0, contract: 0, ledger: 0, retainer: 0, docs: 0, ready: 0 };
  for (const r of (tabs[prepTab] || []).slice(1)) {
    const v = r.values || []; if (!isCase(txt(v[0]))) continue;
    const t = (i) => /true/i.test(txt(v[i]));
    prep.cases++; prep.contract += t(2); prep.ledger += t(3); prep.retainer += t(4); prep.docs += t(5); prep.ready += t(6);
  }
  // Arbitrations: Scheduling Orders (strikethrough row = closed).
  const arb = { open: 0, closed: 0, order: 0, drafted: 0, issued: 0, notice: 0, received: 0 };
  for (const r of (tabs[schedTab] || []).slice(1)) {
    const v = r.values || []; if (!isCase(txt(v[0]))) continue;
    if (v[0]?.effectiveFormat?.textFormat?.strikethrough) { arb.closed++; continue; }
    const t = (i) => /true/i.test(txt(v[i]));
    arb.open++; arb.order += t(3); arb.drafted += t(4); arb.issued += t(5); arb.notice += t(6); arb.received += t(7);
  }
  // Referred out.
  const referred = []; let refMonth = null;
  for (const r of (tabs[refTab] || []).slice(1)) {
    const v = r.values || [], mm = txt(v[0]).match(new RegExp(`^(${MONTHS.join('|')})\\s+(\\d{4})$`, 'i'));
    if (mm) refMonth = `${mm[2]}-${String(MONTHS.findIndex((M) => M.toLowerCase() === mm[1].toLowerCase()) + 1).padStart(2, '0')}`;
    if (!isCase(txt(v[1])) || v[1]?.effectiveFormat?.textFormat?.strikethrough) continue;
    referred.push({ m: refMonth, source: txt(v[3]) || 'Not recorded', member: txt(v[4]) || '—', paid: /paid/i.test(txt(v[5])) && !/unpaid/i.test(txt(v[5])) });
  }
  return { rows, conditional, goals, prep, arb, referred, key: key.map((k) => k.label), tabs: monthTabs.map((x) => x.t), allTab: allTab || null };
}
