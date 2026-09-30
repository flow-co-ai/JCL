// Fake raw data shaped like the real Zoho + Windsor pulls, for local preview only.
import fs from 'node:fs';
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (arr) => { const t = arr.reduce((a, x) => a + x[1], 0); let r = rnd() * t; for (const [v, w] of arr) if ((r -= w) <= 0) return v; return arr[0][0]; };
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, k) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + k); return x; };

const defs = [['Freedom Debt Relief', 125, 7800, 'CROA'], ['Credit Collection Services', 110, 2200, 'E8'], ['Beyond Finance, LLC', 94, 5300, 'CROA'],
  ['Amsher Collection Services, Inc.', 37, 2200, 'E8'], ["JG Wentworth's Debt Relief Program", 35, 5900, 'CROA'], ['Alleviate Financial Solutions', 33, 7800, 'CROA'],
  ['Consumer Adjustment Company, Inc', 29, 2000, 'E8'], ['LVNV Funding LLC dba Resurgent Capital Services L.P.', 27, 2300, 'E8'],
  ['LVNV Funding LLC dba Resurgent Correspondence', 21, 2300, 'E8'], ['Clarity Debt Resolutions, Inc.', 20, 7200, 'CROA'],
  ['Midland Credit Management, Inc', 16, 2400, 'E8'], ['Midland Credit Management, Inc.', 10, 2400, 'E8'], ['Americor Funding, LLC', 17, 4600, 'CROA'],
  ['Turnbull Law Group', 14, 6700, 'CROA'], ['ClearOne Advantage', 10, 4750, 'CROA'], ['Hunter Warfield, Inc', 16, 3000, 'E8'], ['Transunion, LLC.', 6, 7400, 'FCRA']];
const sources = [['Credit Saint', 736], ['Bolster CRM', 281], ['GuardsLaw CROA-CLAIMS', 221], ['AR - CROA', 198], ['SEO', 61], ['Meta Ads', 48], ['TCA', 26], ['AttorneyReview', 21], ['Organic', 20], ['Meta', 8], ['Referral', 7]];
const deals = [];
let id = 1000;
for (let i = 0; i < 1650; i++) {
  const [name, , fee, type] = pick(defs.map((d) => [d, d[1]]));
  const imported = rnd() < 0.55;
  const created = imported ? addDays(new Date('2024-08-01'), Math.floor(rnd() * 90)) : addDays(new Date('2024-11-01'), Math.floor(rnd() * 690));
  const signed = imported ? (rnd() < 0.5 ? addDays(created, -Math.floor(rnd() * 200)) : null) : addDays(created, Math.floor(rnd() * 10));
  const stage = pick([['Settled Paid', 538], ['Case Dismissed', 231], ['Demand Sent', 180], ['On Ice', 159], ['Case Packaged - Needs Review', 143], ['Filed', 141], ['Failed Demand', 80], ['Settled Unpaid', 48], ['Drafted Demand', 45], ['Active Negotiations', 40], ['Settlement Agreement', 20], ['Retainer Not Signed', 13]]);
  const d = { id: String(id++), Deal_Name: `Client${i} Sample v. ${name}`, Stage: stage, Account_Name: name, Lead_Source: pick(sources), Case_Type: type,
    Created_Time: created.toISOString(), _presuit: rnd() < 0.3 ? iso(addDays(created, 20)) : null, _filed: rnd() < 0.2 ? iso(addDays(created, 60)) : null, Case_Status: rnd() < 0.2 ? 'Waiting on defendant response' : null, Retainer_Signed_Date: signed ? iso(signed) : null, Lead_Intake_Date: null, Stage_Modified_Time: addDays(created, 60 + Math.floor(rnd() * 200)).toISOString() };
  if (['Settled Paid', 'Settled Unpaid', 'Settlement Agreement'].includes(stage)) {
    const f = Math.round(fee * (0.6 + rnd() * 0.8) / 50) * 50, p = Math.round(f * (0.1 + rnd() * 0.3) / 50) * 50;
    d.Settlement_Amount = f + p; d.Gaurds_Law_Attorney_s_Fees = rnd() < 0.96 ? f : null; d.Client_Payout = p;
    if (rnd() < 0.2) d.Debt_Wavier = Math.round(rnd() * 3000);
    const paidAt = addDays(signed || created, 90 + Math.floor(rnd() * 300));
    if (stage === 'Settled Paid') d.Summons_Executed = iso(paidAt > new Date() ? addDays(new Date(), -Math.floor(rnd() * 60)) : paidAt);
    else d.Settled_in_Principle = addDays(new Date(), -Math.floor(rnd() * 120)).toISOString();
  }
  deals.push(d);
}
const leadStatus = [['Unresponsive', 30], ['Attempted to Contact', 20], ['Junk Lead', 12], ['Not Moving Forward w/ Claim', 10], ['Short Time in Program', 8], ['Time Barred', 5], ['Duplicate', 5], ['Pre-Qualified', 6]];
const leads = [];
for (let i = 0; i < 6000; i++) {
  const created = addDays(new Date('2025-01-01'), Math.floor(rnd() * 635));
  const conv = rnd() < 0.08, deal = conv ? deals[Math.floor(rnd() * deals.length)].id : null;
  leads.push({ id: 'L' + i, name: `Lead Person ${i}`, owner: 'Andrew', Lead_Source: pick([['Meta Ads', 30], ['Credit Saint', 25], ['AR - CROA', 20], ['SEO', 10], ['Bolster CRM', 10], ['TCA', 5]]), Lead_Status: pick(leadStatus), Created_Time: created.toISOString(), Converted: conv, Deal: deal });
}
const meta = [];
for (let d = new Date('2024-06-01'); d < new Date(); d = addDays(d, 1)) {
  const old = d < new Date('2026-05-01');
  if (old && d > new Date('2026-03-10')) continue;
  meta.push({ date: iso(d), campaign: old ? 'CROA Lead Form' : (rnd() < 0.8 ? 'CROA Static Split' : 'CROA Video'), spend: 20 + rnd() * 40, impressions: 2000 + rnd() * 3000, clicks: 20 + rnd() * 50, actions_lead: rnd() < 0.3 ? 1 : 0, account: old ? 'Previous account' : 'Current account' });
}
const ga4 = [], sc = [];
for (let d = addDays(new Date(), -470); d < new Date(); d = addDays(d, 1)) {
  for (const [ch, s] of [['Organic Search', 60], ['Direct', 25], ['Paid Social', 30], ['Referral', 5]]) ga4.push({ date: iso(d).replace(/-/g, ''), session_default_channel_group: ch, sessions: Math.round(s * (0.6 + rnd())), conversions: rnd() < 0.2 ? 1 : 0 });
  sc.push({ date: iso(d), clicks: Math.round(30 + rnd() * 30), impressions: Math.round(2000 + rnd() * 1500) });
}
const q = (s, c, i, p) => ({ query: s, clicks: c, impressions: i, position: p });
const sc_q_last = [q('is freedom debt relief legit', 140, 3500, 6.2), q('freedom debt relief lawsuit', 90, 1900, 4.1), q('beyond finance lawsuit', 40, 1200, 8.3), q('jg wentworth debt relief reviews', 12, 900, 14.2), q('alleviate financial solutions complaints', 8, 600, 11.5), q('justice consumer law', 60, 120, 1.2), q('debt relief scam lawyer', 22, 1400, 12.8), q('croa lawsuit', 15, 800, 9.4), q('clarity debt resolution lawsuit', 6, 300, 7.7)];
const sc_q_prior = sc_q_last.map((r) => ({ ...r, clicks: Math.round(r.clicks * 0.7), impressions: Math.round(r.impressions * 0.8), position: r.position + 2 }));
const sc_pages = [{ page: 'https://justiceconsumerlaw.com/freedom-debt-relief-lawsuit/', clicks: 220, impressions: 5200, position: 5.1 }, { page: 'https://justiceconsumerlaw.com/', clicks: 90, impressions: 800, position: 3.2 }, { page: 'https://justiceconsumerlaw.com/beyond-finance-lawsuit/', clicks: 40, impressions: 1200, position: 8.3 }];
const sc_q_months = [];
for (let i = 15; i >= 0; i--) { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i); const f = 0.5 + (15 - i) / 20;
  sc_q_months.push({ m: iso(d).slice(0, 7), rows: sc_q_last.map((r) => ({ ...r, clicks: Math.round(r.clicks / 3 * f * (0.8 + rnd() * 0.4)), impressions: Math.round(r.impressions / 3 * f * (0.8 + rnd() * 0.4)) })) }); }
// Tracker rows: 2026 packaged cases pointing at some of the Zoho cases above.
const srcs2 = [['Meta', 20], ['AR CROA', 35], ['SEO', 12], ['Attorney Review', 15], ['GL-CROA', 8], ['Credit Saint', 10]];
const sheetRows = []; const nowM = new Date().getUTCMonth();
for (let mi = 0; mi <= nowM; mi++) {
  const count = 25 + Math.floor(rnd() * 20);
  for (let k = 0; k < count; k++) {
    const d = deals[Math.floor(rnd() * deals.length)];
    const age = nowM - mi;
    d.Stage = pick(age > 5 ? [['Settled Paid', 30], ['Settled Unpaid', 10], ['Filed', 30], ['Case Dismissed', 10], ['Demand Sent', 20]] : age > 2 ? [['Settled Paid', 8], ['Settled Unpaid', 10], ['Filed', 45], ['Demand Sent', 25], ['Case Dismissed', 5]] : [['Filed', 30], ['Demand Sent', 30], ['Drafted Demand', 25], ['Case Packaged - Needs Review', 15]]);
    if (['Settled Paid', 'Settled Unpaid'].includes(d.Stage) && !d.Gaurds_Law_Attorney_s_Fees) { d.Gaurds_Law_Attorney_s_Fees = 4000 + Math.round(rnd() * 5000); d.Settlement_Amount = d.Gaurds_Law_Attorney_s_Fees + 800; d.Client_Payout = 800; }
    if (d.Stage === 'Settled Paid') d.Summons_Executed = iso(addDays(new Date(Date.UTC(2026, mi, 10)), 60 + Math.floor(rnd() * 90)));
    const unmatched = rnd() < 0.05; if (rnd() < 0.15) d.Settlement_Amount_EXP = 1500;
    sheetRows.push({ name: unmatched ? `Nomatch Person${k} v. Somebody` : d.Deal_Name.replace('Sample', 'Q. Sample'), member: rnd() < 0.55 ? 'A' : 'K',
      date: iso(new Date(Date.UTC(2026, mi, 1 + Math.floor(rnd() * 27)))), m: `2026-${String(mi + 1).padStart(2, '0')}`, source: pick(srcs2),
      drafted: rnd() < 0.8 ? '9/2' : '', filing: '', red: rnd() < 0.09, isDrafted: rnd() < 0.8 });
    const z = sheetRows.at(-1), u = rnd(); z.filing = u < 0.35 ? 'Filed' : u < 0.8 ? 'Pre-Suit sent on 5/12' : ''; z.isPresuit = /pre-suit/i.test(z.filing); z.isFiled = z.filing === 'Filed' || rnd() < 0.3 && z.isPresuit; z.filingStatus = z.isFiled ? (z.isPresuit ? 'Filed with AAA' : 'Filed') : z.isPresuit ? 'Pre-suit demand out' : 'Not yet filed';
  }
}
fs.mkdirSync('sample', { recursive: true });
fs.writeFileSync('sample/fixture.json', JSON.stringify({ zohoLink: 'https://crm.zoho.com/crm/org000/tab/Potentials/', zohoBase: 'https://crm.zoho.com/crm/org000/tab/', deals, leads, sheet: { rows: sheetRows, tabs: ['January \'26'], goals: [{ m: '2026-08', goal: 33 }, { m: '2026-09', goal: 40 }], conditional: [{ m: '2026-09', member: 'A' }, { m: '2026-09', member: 'K' }], referred: [{ m: '2026-07', source: 'SEO', member: 'K', paid: true }, { m: '2026-08', source: 'AR Employment', member: 'A', paid: false }], prep: { cases: 7, contract: 4, ledger: 1, retainer: 0, docs: 4, ready: 2 }, arb: { open: 32, closed: 17, order: 30, drafted: 17, issued: 22, notice: 15, received: 11 } }, windsor: { meta, ga4, sc_daily: sc, sc_q_last, sc_q_prior, sc_q_months, sc_pages, errors: [] } }));
console.log('Wrote sample/fixture.json');
