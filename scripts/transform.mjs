// Turns raw Zoho + Windsor + tracker-sheet rows into aggregated, name-free totals for the page.
import { buildMatcher, norm } from './match.mjs';
const n = (v) => (typeof v === 'number' ? v : v == null || v === '' ? 0 : Number(v) || 0);
const month = (s) => (s ? String(s).slice(0, 7) : null);
const day = (s) => (s ? new Date(String(s).slice(0, 10) + 'T12:00:00Z') : null);
const daysBetween = (a, b) => (a && b ? Math.round((b - a) / 86400000) : null);

export const STAGE_GROUP = {
  'Follow-Up': 'Signing', 'Retainer Not Signed': 'Signing', 'Retainer Signed': 'Signing',
  'Case Packaged - Needs Review': 'Signing', 'Dispute Sent': 'Signing',
  'Drafted Demand': 'Demand', 'Demand Sent': 'Demand', 'Active Negotiations': 'Demand', 'Failed Demand': 'Demand',
  'Complaint Drafted': 'Litigation', 'Filed': 'Litigation',
  'Settlement Agreement': 'Won, not collected', 'Settled Unpaid': 'Won, not collected',
  'On Ice': 'On hold', 'Settled Paid': 'Collected', 'Case Dismissed': 'Dismissed',
};

function defendantKey(name, aliases) {
  if (!name) return '(not set)';
  if (aliases[name]) return aliases[name];
  return name.toLowerCase().split(/\s+dba\s+/)[0]
    .replace(/[.,'’"()]/g, ' ')
    .replace(/\b(llc|inc|lp|l p|pllc|ltd|corp|corporation|co|company|the)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

export function transform(raw, cfg) {
  const aliases = cfg.defendant_aliases || {};
  const share = cfg.fee_share ?? 1;
  const srcMap = {};
  for (const [g, list] of Object.entries(cfg.source_groups)) for (const s of list) srcMap[s] = g;
  const src = (s) => (!s || s === '-None-' ? 'Not recorded' : srcMap[s] || 'Other');

  // Defendant display names: most common raw spelling per key.
  const spell = {};
  for (const d of raw.deals) {
    const k = defendantKey(d.Account_Name, aliases);
    spell[k] ??= {}; spell[k][d.Account_Name || '(not set)'] = (spell[k][d.Account_Name || '(not set)'] || 0) + 1;
  }
  const display = Object.fromEntries(Object.entries(spell).map(([k, v]) => [k, Object.entries(v).sort((a, b) => b[1] - a[1])[0][0]]));

  const acc = (map, key, init) => (map.get(key) || map.set(key, init()).get(key));
  const paid = new Map(), signed = new Map(), lost = new Map(), open = new Map(), types = {};
  const dq = { cases: raw.deals.length, paid: 0, paid_no_fee: 0, paid_no_date: 0, reconcile_ok: 0, reconcile_n: 0, import_signed: 0 };
  const dealById = new Map();

  for (const d of raw.deals) {
    const def = display[defendantKey(d.Account_Name, aliases)];
    const s = src(d.Lead_Source), type = d.Case_Type && d.Case_Type !== '-None-' ? d.Case_Type : 'Not set';
    types[def] ??= {}; types[def][type] = (types[def][type] || 0) + 1;
    const settle = n(d.Settlement_Amount) + n(d.Settlement_Amount_EXP) + n(d.Settlement_Amount_EQF) + n(d.Settlement_Amount_TU);
    const fees = n(d.Gaurds_Law_Attorney_s_Fees), payout = n(d.Client_Payout);
    const waived = n(d.Debt_Wavier) + n(d.Debt_Waiver_2) + n(d.Debt_Waiver_3);

    // Signed date: retainer date, then intake date, then created date. Created dates in the
    // Aug–Oct 2024 bulk import are not real signing dates.
    let sDate = d.Retainer_Signed_Date || d.Lead_Intake_Date || null, sm = month(sDate);
    if (!sm) { const cm = month(d.Created_Time); if (cm && cm < '2024-11') { sm = 'import'; dq.import_signed++; } else sm = cm; sDate = d.Created_Time; }
    const sDay = sm === 'import' ? null : day(sDate);
    const k = [sm, def, s, type].join('|');
    acc(signed, k, () => ({ m: sm, def, src: s, type, n: 0 })).n++;

    const stage = d.Stage || 'Unknown', group = STAGE_GROUP[stage] || 'Other';
    dealById.set(d.id, { stage, group, fees: fees * share, sm });

    if (stage === 'Settled Paid') {
      dq.paid++;
      if (!fees) dq.paid_no_fee++;
      if (!d.Summons_Executed) dq.paid_no_date++;
      if (settle && fees && payout) { dq.reconcile_n++; if (Math.abs(settle - fees - payout) <= 5) dq.reconcile_ok++; }
      const pDate = d.Summons_Executed || d.Stage_Modified_Time || d.Created_Time;
      const days = daysBetween(sDay, day(pDate));
      const r = acc(paid, [month(pDate), def, s, type].join('|'), () => ({ m: month(pDate), def, src: s, type, n: 0, settle: 0, fees: 0, payout: 0, other: 0, waived: 0, days_sum: 0, days_n: 0 }));
      r.n++; r.settle += settle; r.fees += fees * share; r.payout += payout;
      r.other += Math.max(0, settle - fees - payout); r.waived += waived;
      if (days != null && days >= 0 && days < 1500) { r.days_sum += days; r.days_n++; }
    } else if (stage === 'Case Dismissed') {
      const lm = month(d.Stage_Modified_Time || d.Created_Time);
      acc(lost, [lm, def, s, type].join('|'), () => ({ m: lm, def, src: s, type, n: 0 })).n++;
    } else {
      const since = d.Settled_in_Principle || d.Stage_Modified_Time || d.Created_Time;
      const age = daysBetween(day(since), new Date());
      const r = acc(open, [stage, def, s, type].join('|'), () => ({ stage, group, def, src: s, type, n: 0, settle: 0, fees: 0, age_sum: 0 }));
      r.n++; r.settle += settle; r.fees += fees * share; r.age_sum += Math.max(0, age || 0);
    }
  }


  // ---------- 2026 packaged cases (tracker sheet = source of truth), priced from Zoho ----------
  const sheetMap = {};
  for (const [g, list] of Object.entries(cfg.sheet_source_groups || {})) for (const s of list) sheetMap[norm(s)] = g;
  const sheetSrc = (s) => sheetMap[norm(s)] || (s && s !== 'Not recorded' ? s : 'Not recorded');
  const team = cfg.team || {};
  const matchCase = buildMatcher(raw.deals);
  const cohort = new Map(), unmatched = [];
  const sq = { rows: 0, matched: 0, red: 0, tabs: raw.sheet?.tabs || [] };
  for (const r of raw.sheet?.rows || []) {
    sq.rows++; if (r.red) sq.red++;
    const d = matchCase(r.name); if (d) sq.matched++; else unmatched.push(r.name);
    const rawDef = d?.Account_Name || (r.name.split(/\s+v\.?\s+/i)[1] || '').trim();
    const def = d ? display[defendantKey(d.Account_Name, aliases)] : (rawDef || '(not set)');
    const type = d?.Case_Type && d.Case_Type !== '-None-' ? d.Case_Type : 'Not set';
    const stage = d?.Stage || null;
    const grp = r.red ? 'Charged back' : !d ? 'Not found in Zoho' : STAGE_GROUP[stage] || 'Other';
    const settle = d ? n(d.Settlement_Amount) + n(d.Settlement_Amount_EXP) + n(d.Settlement_Amount_EQF) + n(d.Settlement_Amount_TU) : 0;
    const fee = d ? n(d.Gaurds_Law_Attorney_s_Fees) * share : 0, payout = d ? n(d.Client_Payout) : 0;
    const paidDate = stage === 'Settled Paid' ? (d.Summons_Executed || d.Stage_Modified_Time) : null;
    const days = paidDate && r.date ? daysBetween(day(r.date), day(paidDate)) : null;
    const since = d && grp === 'Won, not collected' ? (d.Settled_in_Principle || d.Stage_Modified_Time) : null;
    const k = [r.m, sheetSrc(r.source), team[r.member] || r.member, def, type, grp, stage, r.isFiled, r.isPresuit, r.isDrafted, month(paidDate)].join('|');
    const x = acc(cohort, k, () => ({ m: r.m, src: sheetSrc(r.source), member: team[r.member] || r.member, def, type, group: grp, stage,
      filed: !!r.isFiled, presuit: !!r.isPresuit, drafted: !!r.isDrafted, pm: month(paidDate), n: 0, settle: 0, fees: 0, payout: 0, days_sum: 0, days_n: 0, age_sum: 0 }));
    x.n++; x.settle += settle; x.fees += fee; x.payout += payout;
    if (days != null && days >= 0) { x.days_sum += days; x.days_n++; }
    if (since) x.age_sum += Math.max(0, daysBetween(day(since), new Date()) || 0);
  }
  // History per defendant (all Zoho cases) for expected value: paid, dismissed, fees.
  const hist = {};
  for (const r of paid.values()) { const h = (hist[r.def] ||= { paid: 0, lost: 0, fees: 0 }); h.paid += r.n; h.fees += r.fees; }
  for (const r of lost.values()) { const h = (hist[r.def] ||= { paid: 0, lost: 0, fees: 0 }); h.lost += r.n; }

  // Dominant case type per defendant.
  const defType = Object.fromEntries(Object.entries(types).map(([k, v]) => [k, Object.entries(v).sort((a, b) => b[1] - a[1])[0][0]]));

  // Leads: by month and source, with what they became.
  const leads = new Map(), status90 = new Map();
  const cutoff90 = new Date(Date.now() - 90 * 86400000);
  for (const l of raw.leads) {
    const m = month(l.Created_Time), s = src(l.Lead_Source);
    const deal = l.Deal ? dealById.get(l.Deal) : null;
    const r = acc(leads, `${m}|${s}`, () => ({ m, src: s, n: 0, cases: 0, collected: 0, fees: 0 }));
    r.n++;
    if (l.Converted || deal) r.cases++;
    if (deal?.stage === 'Settled Paid') { r.collected++; r.fees += deal.fees; }
    if (new Date(l.Created_Time) >= cutoff90) {
      const st = l.Converted || deal ? 'Became a case' : (l.Lead_Status && l.Lead_Status !== '-None-' ? l.Lead_Status : 'No status');
      acc(status90, `${st}|${s}`, () => ({ status: st, src: s, n: 0 })).n++;
    }
  }

  // Meta by month and account; campaigns for the last 90 days.
  const metaM = new Map(), camp = new Map();
  for (const r of raw.windsor.meta || []) {
    const m = month(r.date);
    const x = acc(metaM, `${m}|${r.account}`, () => ({ m, account: r.account, spend: 0, impressions: 0, clicks: 0, leads: 0 }));
    x.spend += n(r.spend); x.impressions += n(r.impressions); x.clicks += n(r.clicks); x.leads += n(r.actions_lead);
    if (new Date(r.date) >= cutoff90) {
      const c = acc(camp, r.campaign || '(no name)', () => ({ campaign: r.campaign || '(no name)', spend: 0, leads: 0, clicks: 0, impressions: 0 }));
      c.spend += n(r.spend); c.leads += n(r.actions_lead); c.clicks += n(r.clicks); c.impressions += n(r.impressions);
    }
  }
  const metaDates = (raw.windsor.meta || []).filter((r) => n(r.spend) > 0).map((r) => r.date).sort();

  const ga4 = new Map();
  for (const r of raw.windsor.ga4 || []) {
    const m = month(String(r.date).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'));
    const x = acc(ga4, `${m}|${r.session_default_channel_group}`, () => ({ m, channel: r.session_default_channel_group || 'Unassigned', sessions: 0, conversions: 0 }));
    x.sessions += n(r.sessions); x.conversions += n(r.conversions);
  }
  const scM = new Map();
  for (const r of raw.windsor.sc_daily || []) {
    const m = month(r.date);
    const x = acc(scM, m, () => ({ m, clicks: 0, impressions: 0 })); x.clicks += n(r.clicks); x.impressions += n(r.impressions);
  }

  // Defendant-name searches: what people search about the companies the firm sues.
  const terms = cfg.defendant_search_terms || {};
  const scDef = [];
  const match = (rows, list) => rows.filter((r) => list.some((t) => String(r.query || '').toLowerCase().includes(t)));
  const sum = (rows) => {
    const c = rows.reduce((a, r) => a + n(r.clicks), 0), i = rows.reduce((a, r) => a + n(r.impressions), 0);
    const p = i ? rows.reduce((a, r) => a + n(r.position) * n(r.impressions), 0) / i : null;
    return { clicks: c, impressions: i, position: p };
  };
  for (const [name, list] of Object.entries(terms)) {
    const last = match(raw.windsor.sc_q_last || [], list), prior = match(raw.windsor.sc_q_prior || [], list);
    if (!last.length && !prior.length) continue;
    const top = [...last].sort((a, b) => n(b.impressions) - n(a.impressions)).slice(0, 5)
      .map((r) => ({ query: r.query, clicks: n(r.clicks), impressions: n(r.impressions), position: n(r.position) }));
    scDef.push({ name, last: sum(last), prior: sum(prior), top });
  }
  // Defendant-name searches by month.
  const scDefMonth = [];
  for (const { m, rows } of raw.windsor.sc_q_months || []) {
    for (const [name, list] of Object.entries(terms)) {
      const hit = match(rows, list); if (!hit.length) continue;
      const t = sum(hit);
      scDefMonth.push({ m, name, clicks: t.clicks, impressions: t.impressions, posw: (t.position || 0) * t.impressions });
    }
  }
  const topQ = (rows) => [...rows].sort((a, b) => n(b.clicks) - n(a.clicks) || n(b.impressions) - n(a.impressions)).slice(0, 60)
    .map((r) => ({ query: r.query, clicks: n(r.clicks), impressions: n(r.impressions), position: n(r.position) }));
  const priorPos = Object.fromEntries((raw.windsor.sc_q_prior || []).map((r) => [r.query, n(r.position)]));

  const vals = (m) => [...m.values()];
  return {
    generated_at: new Date().toISOString(),
    firm: cfg.firm_name, fee_label: cfg.fee_label, fee_share: share,
    defendants: Object.fromEntries(Object.values(display).map((d) => [d, defType[d] || 'Not set'])),
    year: cfg.sheet?.year || null, cohort: vals(cohort), hist, unmatched_count: unmatched.length,
    paid: vals(paid), signed: vals(signed), lost: vals(lost), open: vals(open),
    leads: vals(leads), lead_status_90: vals(status90),
    meta_month: vals(metaM), meta_campaigns_90: vals(camp).sort((a, b) => b.spend - a.spend),
    meta_last_spend: metaDates.at(-1) || null,
    source_costs: cfg.source_costs || {},
    ga4_month: vals(ga4), sc_month: vals(scM).sort((a, b) => a.m.localeCompare(b.m)),
    sc_def_month: scDefMonth,
    sc_months_available: (raw.windsor.sc_q_months || []).map((x) => x.m),
    sc_defendants: scDef.sort((a, b) => b.last.impressions - a.last.impressions),
    sc_queries: topQ(raw.windsor.sc_q_last || []).map((q) => ({ ...q, prior: priorPos[q.query] ?? null })),
    sc_pages: [...(raw.windsor.sc_pages || [])].sort((a, b) => n(b.clicks) - n(a.clicks)).slice(0, 25)
      .map((r) => ({ page: String(r.page).replace(/^https?:\/\/[^/]+/, '') || '/', clicks: n(r.clicks), impressions: n(r.impressions), position: n(r.position) })),
    quality: { ...dq, sheet: sq, windsor_errors: raw.windsor.errors || [] },
    _unmatched: unmatched,
  };
}
