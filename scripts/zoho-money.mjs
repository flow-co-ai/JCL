// JCL dashboard — Zoho money probe. READ-ONLY.
// Finds where case dollars live (currency fields, case description, notes),
// checks whether the numbers agree with each other, and prints dollar mentions
// in context so we can define "revenue" correctly. Phones and emails are masked.

const ACCOUNTS = 'https://accounts.zoho.com';
const V = 'v7';
const MAX_SNIPPETS = 350;

for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN'])
  if (!process.env[k]) { console.log(`MISSING SECRET: ${k}`); process.exit(1); }

let TOKEN, API;
async function auth() {
  const q = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN, client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET, grant_type: 'refresh_token' });
  const j = await (await fetch(`${ACCOUNTS}/oauth/v2/token?${q}`, { method: 'POST' })).json();
  if (!j.access_token) { console.log('TOKEN FAILED:', JSON.stringify(j)); process.exit(1); }
  TOKEN = j.access_token; API = j.api_domain || 'https://www.zohoapis.com';
}
async function api(path, params = {}) {
  const url = `${API}/crm/${V}/${path}?${new URLSearchParams(params)}`;
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${TOKEN}` } });
    if (r.status === 204) return null;
    if (r.status === 429) { await new Promise((s) => setTimeout(s, 5000)); continue; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${r.status} ${path}: ${JSON.stringify(j).slice(0, 300)}`);
    return j;
  }
  throw new Error(`rate limited: ${path}`);
}
async function all(module, fields) {
  const out = []; let token = null, page = 1;
  while (true) {
    const p = { fields: fields.join(','), per_page: '200' };
    if (token) p.page_token = token; else p.page = String(page);
    const j = await api(module, p);
    if (!j?.data?.length) break;
    out.push(...j.data);
    if (!j.info?.more_records) break;
    token = j.info.next_page_token || null; if (!token) page++;
  }
  return out;
}

const L = (s = '') => console.log(s);
const H = (t) => L(`\n==================== ${t} ====================`);
const money = (n) => (n == null ? '' : '$' + Math.round(n).toLocaleString('en-US'));
const num = (v) => (typeof v === 'number' ? v : v == null || v === '' ? null : Number(v));
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const mask = (s) => String(s || '')
  .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
  .replace(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, '[phone]')
  .replace(/\s+/g, ' ');
const DOLLAR = /\$\s?\d[\d,]*(?:\.\d+)?\s?[kK]?|\b\d{1,3}(?:,\d{3})+(?:\.\d{2})?\b|\b\d+(?:\.\d+)?\s?[kK]\b|\b\d{2,3}\s?%/g;
const KEY = /(fee|attorney|atty|payout|client|settle|waiv|cost|court|net|gross|paid|pay|check|wire|split|percent|%|offer|counter|demand|agree|recover|amount|forgiv|balance|refund)/i;

const CUR = ['Settlement_Amount', 'Settlement_Amount_EXP', 'Settlement_Amount_EQF', 'Settlement_Amount_TU',
  'Gaurds_Law_Attorney_s_Fees', 'Client_Payout', 'Court_fee', 'Debt_Wavier', 'Debt_Waiver_2', 'Debt_Waiver_3'];
const LBL = { Settlement_Amount: 'Def 1 Settlement', Settlement_Amount_EXP: 'Def 2 Settlement',
  Settlement_Amount_EQF: 'Def 3 Settlement', Settlement_Amount_TU: 'Def 4 Settlement',
  Gaurds_Law_Attorney_s_Fees: "Attorney's Fees", Client_Payout: 'Client Payout', Court_fee: 'Court fee',
  Debt_Wavier: 'Debt Waiver 1', Debt_Waiver_2: 'Debt Waiver 2', Debt_Waiver_3: 'Debt Waiver 3' };

async function main() {
  await auth(); L(`OK token. ${API}`);

  H('CASE LAYOUT SECTIONS (where fields sit on the Case page)');
  try {
    const lay = await api('settings/layouts', { module: 'Deals' });
    for (const l of lay.layouts || []) {
      L(`Layout: ${l.name}`);
      for (const s of l.sections || [])
        L(`  [${s.display_label}] ` + (s.fields || []).map((f) => f.api_name).join(', '));
    }
  } catch (e) { L(`layouts unavailable: ${e.message}`); }

  const F = ['Stage', 'Account_Name', 'Lead_Source', 'Case_Type', 'Created_Time', 'Retainer_Signed_Date',
    'Summons_Executed', 'Settled_in_Principle', 'Did_Defendant_Pay_Guards_Law', 'Did_we_Pay_Client',
    'Description', 'Stage_Modified_Time', 'Contract_Fee', ...CUR];
  const deals = await all('Deals', F);
  L(`\nCases pulled: ${deals.length}`);

  H('NOTES');
  let notes = [];
  try { notes = await all('Notes', ['Note_Title', 'Note_Content', 'Parent_Id', 'Created_Time']); }
  catch (e) { L(`notes unavailable: ${e.message}`); }
  const byMod = {};
  for (const n of notes) { const m = n.Parent_Id?.module?.api_name || n.$se_module || '?'; byMod[m] = (byMod[m] || 0) + 1; }
  L(`Notes pulled: ${notes.length} | by parent module: ${JSON.stringify(byMod)}`);
  const dealNotes = new Map();
  for (const n of notes) {
    const id = n.Parent_Id?.id; if (!id) continue;
    if (!dealNotes.has(id)) dealNotes.set(id, []);
    dealNotes.get(id).push(n);
  }

  H('CURRENCY FIELDS — fill rate and totals');
  L('field | filled | >0 | sum | median | max');
  for (const f of CUR) {
    const v = deals.map((d) => num(d[f])).filter((x) => x != null);
    const pos = v.filter((x) => x > 0);
    L(`${LBL[f].padEnd(18)} | ${String(v.length).padStart(5)} | ${String(pos.length).padStart(5)} | ${money(pos.reduce((a, b) => a + b, 0)).padStart(12)} | ${money(med(pos)).padStart(9)} | ${money(Math.max(0, ...pos))}`);
  }

  H('BY STAGE — how many cases carry each number');
  const stages = [...new Set(deals.map((d) => d.Stage))];
  L('stage | cases | any settlement | fees | payout | paid flag | $ in description | $ in notes');
  const hasDesc = (d) => (mask(d.Description).match(DOLLAR) || []).length > 0;
  const hasNote = (d) => (dealNotes.get(d.id) || []).some((n) => (mask(n.Note_Content).match(DOLLAR) || []).length);
  const setl = (d) => ['Settlement_Amount', 'Settlement_Amount_EXP', 'Settlement_Amount_EQF', 'Settlement_Amount_TU']
    .map((f) => num(d[f]) || 0).reduce((a, b) => a + b, 0);
  for (const s of stages) {
    const g = deals.filter((d) => d.Stage === s);
    L(`${String(s).padEnd(30)} | ${String(g.length).padStart(4)} | ${String(g.filter((d) => setl(d) > 0).length).padStart(4)} | ${String(g.filter((d) => num(d.Gaurds_Law_Attorney_s_Fees) > 0).length).padStart(4)} | ${String(g.filter((d) => num(d.Client_Payout) > 0).length).padStart(4)} | ${String(g.filter((d) => d.Did_Defendant_Pay_Guards_Law).length).padStart(4)} | ${String(g.filter(hasDesc).length).padStart(4)} | ${String(g.filter(hasNote).length).padStart(4)}`);
  }

  H('CONSISTENCY — settlement vs fees + client payout (cases with all three)');
  const trio = deals.filter((d) => setl(d) > 0 && num(d.Gaurds_Law_Attorney_s_Fees) > 0 && num(d.Client_Payout) > 0);
  L(`Cases with settlement, fees and payout all filled: ${trio.length}`);
  const buckets = { 'exact (±$5)': 0, 'fees+payout < settlement': 0, 'fees+payout > settlement': 0 };
  const feePct = {};
  for (const d of trio) {
    const S = setl(d), F2 = num(d.Gaurds_Law_Attorney_s_Fees), P = num(d.Client_Payout);
    const diff = S - F2 - P;
    if (Math.abs(diff) <= 5) buckets['exact (±$5)']++; else if (diff > 0) buckets['fees+payout < settlement']++; else buckets['fees+payout > settlement']++;
    const pct = Math.round((F2 / S) * 20) * 5; feePct[pct] = (feePct[pct] || 0) + 1;
  }
  L(JSON.stringify(buckets));
  L('Fees as % of settlement (rounded to 5%): ' + Object.entries(feePct).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}%:${v}`).join('  '));
  const fp = deals.filter((d) => num(d.Gaurds_Law_Attorney_s_Fees) > 0 && setl(d) === 0).length;
  L(`Fees filled but no settlement amount: ${fp}`);
  const fees2 = deals.filter((d) => num(d.Gaurds_Law_Attorney_s_Fees) > 0 && setl(d) > 0);
  const eqS = fees2.filter((d) => Math.abs(num(d.Gaurds_Law_Attorney_s_Fees) - setl(d)) <= 5).length;
  L(`Fees equal to full settlement (fee-only settlements?): ${eqS} of ${fees2.length}`);

  H('SETTLED PAID — money by year paid (structured fields only)');
  const paid = deals.filter((d) => d.Stage === 'Settled Paid');
  const yr = {};
  for (const d of paid) {
    const y = String(d.Summons_Executed || d.Stage_Modified_Time || d.Created_Time || '').slice(0, 7);
    yr[y] ??= { n: 0, s: 0, f: 0, p: 0, nof: 0 };
    yr[y].n++; yr[y].s += setl(d); yr[y].f += num(d.Gaurds_Law_Attorney_s_Fees) || 0; yr[y].p += num(d.Client_Payout) || 0;
    if (!(num(d.Gaurds_Law_Attorney_s_Fees) > 0)) yr[y].nof++;
  }
  L('month | cases | settlement | fees | payout | cases missing fees');
  for (const [k, v] of Object.entries(yr).sort()) L(`${k} | ${v.n} | ${money(v.s)} | ${money(v.f)} | ${money(v.p)} | ${v.nof}`);
  L(`Paid-date source: Settlement Paid Date filled on ${paid.filter((d) => d.Summons_Executed).length} of ${paid.length}`);

  H('TOP DEFENDANTS — structured fees on Settled Paid');
  const def = {};
  for (const d of paid) {
    const k = d.Account_Name?.name || '(none)';
    def[k] ??= { n: 0, s: 0, f: 0 }; def[k].n++; def[k].s += setl(d); def[k].f += num(d.Gaurds_Law_Attorney_s_Fees) || 0;
  }
  for (const [k, v] of Object.entries(def).sort((a, b) => b[1].f - a[1].f).slice(0, 25))
    L(`${k.slice(0, 45).padEnd(45)} | ${String(v.n).padStart(4)} paid | settle ${money(v.s)} | fees ${money(v.f)}`);

  H('DOLLAR MENTIONS IN TEXT (settled/active cases, in context)');
  let shown = 0;
  const focus = deals.filter((d) => ['Settled Paid', 'Settled Unpaid', 'Settlement Agreement', 'Active Negotiations'].includes(d.Stage));
  for (const d of focus) {
    const texts = [['desc', d.Description], ...(dealNotes.get(d.id) || []).map((n) => ['note ' + String(n.Created_Time).slice(0, 10), `${n.Note_Title || ''} ${n.Note_Content || ''}`])];
    const hits = [];
    for (const [src, t] of texts) {
      const s = mask(t);
      for (const m of s.matchAll(DOLLAR)) {
        const ctx = s.slice(Math.max(0, m.index - 90), m.index + m[0].length + 60);
        if (KEY.test(ctx)) hits.push(`   (${src}) …${ctx}…`);
      }
    }
    if (!hits.length) continue;
    L(`\n#${d.id} | ${d.Stage} | ${d.Account_Name?.name || '-'} | settle ${money(setl(d)) || '-'} | fees ${money(num(d.Gaurds_Law_Attorney_s_Fees)) || '-'} | payout ${money(num(d.Client_Payout)) || '-'} | court ${money(num(d.Court_fee)) || '-'}`);
    for (const h of [...new Set(hits)].slice(0, 6)) L(h);
    if (++shown >= MAX_SNIPPETS) break;
  }
  L(`\nCases with dollar mentions shown: ${shown}`);
  H('DONE');
}
main().catch((e) => { console.log('FAILED:', e.message); process.exit(1); });
