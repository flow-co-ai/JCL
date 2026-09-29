// Pulls raw rows from Zoho CRM and Windsor. No names, phones or emails are requested.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Zoho ----------
export async function zohoPull(cfg) {
  const q = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN, client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET, grant_type: 'refresh_token' });
  const t = await (await fetch(`${cfg.zoho_accounts_url}/oauth/v2/token?${q}`, { method: 'POST' })).json();
  if (!t.access_token) throw new Error('Zoho token failed: ' + JSON.stringify(t));
  const API = t.api_domain || 'https://www.zohoapis.com';

  async function get(path, params) {
    const url = `${API}/crm/v7/${path}?${new URLSearchParams(params)}`;
    for (let i = 0; i < 4; i++) {
      const r = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${t.access_token}` } });
      if (r.status === 204) return null;
      if (r.status === 429) { await sleep(5000); continue; }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Zoho ${r.status} ${path}: ${JSON.stringify(j).slice(0, 300)}`);
      return j;
    }
    throw new Error('Zoho rate limited');
  }
  async function all(module, fields, extra = {}) {
    const out = []; let token = null, page = 1;
    while (true) {
      const p = { fields: fields.join(','), per_page: '200', ...extra };
      if (token) p.page_token = token; else p.page = String(page);
      const j = await get(module, p);
      if (!j?.data?.length) break;
      out.push(...j.data);
      if (!j.info?.more_records) break;
      token = j.info.next_page_token || null; if (!token) page++;
    }
    return out;
  }

  const deals = await all('Deals', ['Deal_Name', 'Stage', 'Account_Name', 'Lead_Source', 'Case_Type', 'Created_Time',
    'Retainer_Signed_Date', 'Lead_Intake_Date', 'Summons_Filed', 'Case_Status', 'Settled_in_Principle_EXP', 'Settled_in_Principle_EQF', 'Settled_in_Principle_TU', 'Summons_Executed', 'Settled_in_Principle', 'Stage_Modified_Time',
    'Settlement_Amount', 'Settlement_Amount_EXP', 'Settlement_Amount_EQF', 'Settlement_Amount_TU',
    'Gaurds_Law_Attorney_s_Fees', 'Client_Payout', 'Court_fee', 'Debt_Wavier', 'Debt_Waiver_2', 'Debt_Waiver_3']);
  let leads = [];
  try {
    leads = await all('Leads', ['Lead_Source', 'Lead_Status', 'Created_Time', 'Converted__s', 'Converted_Deal'], { converted: 'both' });
  } catch (e) {
    console.log('Leads with converted=both failed, retrying without it:', e.message);
    leads = await all('Leads', ['Lead_Source', 'Lead_Status', 'Created_Time', 'Converted__s', 'Converted_Deal']);
  }
  // Keep only what the transform needs; drop Zoho record ids except for the lead->case link.
  return {
    deals: deals.map((d) => ({ ...d, Account_Name: d.Account_Name?.name || null })),
    leads: leads.map((l) => ({ Lead_Source: l.Lead_Source, Lead_Status: l.Lead_Status, Created_Time: l.Created_Time,
      Converted: !!l.Converted__s, Deal: l.Converted_Deal?.id || null })),
    dealIds: deals.map((d) => d.id),
  };
}

// ---------- Windsor ----------
async function windsor(connector, account, fields, from, to) {
  const p = new URLSearchParams({ api_key: process.env.WINDSOR_API_KEY, date_from: from, date_to: to,
    fields: fields.join(','), select_accounts: account });
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://connectors.windsor.ai/${connector}?${p}`);
    const txt = await r.text();
    if (r.ok) {
      const j = JSON.parse(txt);
      return Array.isArray(j) ? j : j.data || [];
    }
    if (i === 2) throw new Error(`Windsor ${connector} ${r.status}: ${txt.slice(0, 300)}`);
    await sleep(4000);
  }
}
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return iso(d); };

export async function windsorPull(cfg) {
  const W = cfg.windsor, today = iso(new Date()), out = { errors: [] };
  const safe = async (label, fn) => { try { return await fn(); } catch (e) { out.errors.push(`${label}: ${e.message}`); console.log(`WARN ${label}: ${e.message}`); return []; } };

  out.meta = [];
  for (const a of W.meta_accounts) {
    const rows = await safe(`Meta ${a.label}`, () => windsor('facebook', a.id,
      ['date', 'campaign', 'spend', 'impressions', 'clicks', 'actions_lead'], cfg.history_start, today));
    out.meta.push(...rows.map((r) => ({ ...r, account: a.label })));
  }
  // Search Console rejects ranges older than 16 months.
  const scFrom = daysAgo(470);
  out.ga4 = await safe('GA4', () => windsor('googleanalytics4', W.ga4_property,
    ['date', 'session_default_channel_group', 'sessions', 'conversions'], scFrom, today));
  out.sc_daily = await safe('Search Console daily', () => windsor('searchconsole', W.search_console,
    ['date', 'clicks', 'impressions'], scFrom, today));
  // Query-level Search Console by calendar month, so every date range on the page can use it.
  out.sc_q_months = [];
  const first = new Date(); first.setUTCDate(1); first.setUTCMonth(first.getUTCMonth() - 15);
  for (let d = new Date(first); d <= new Date(); d.setUTCMonth(d.getUTCMonth() + 1)) {
    const from = iso(d), end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    const to = iso(end > new Date() ? new Date() : end);
    const rows = await safe(`Search Console ${from.slice(0, 7)}`, () => windsor('searchconsole', W.search_console,
      ['query', 'clicks', 'impressions', 'position'], from, to));
    out.sc_q_months.push({ m: from.slice(0, 7), rows });
  }
  out.sc_q_last = await safe('Search Console queries', () => windsor('searchconsole', W.search_console,
    ['query', 'clicks', 'impressions', 'position'], daysAgo(92), daysAgo(3)));
  out.sc_q_prior = await safe('Search Console prior queries', () => windsor('searchconsole', W.search_console,
    ['query', 'clicks', 'impressions', 'position'], daysAgo(182), daysAgo(93)));
  out.sc_pages = await safe('Search Console pages', () => windsor('searchconsole', W.search_console,
    ['page', 'clicks', 'impressions', 'position'], daysAgo(92), daysAgo(3)));
  return out;
}
