// JCL dashboard — Zoho CRM check mode. READ-ONLY.
// Prints modules, fields, picklist values, and value counts so we can map
// lead source, target company, and signed status. Writes nothing to Zoho.

const ACCOUNTS = 'https://accounts.zoho.com';
const V = 'v7';
const MAX_RECORDS = 5000; // per module, for value counts
const MATCH = /(compan|defend|creditor|debt|source|campaign|utm|status|sign|retain|case|stage|type|outcome|referr|disposition|qualif)/i;

for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) {
  if (!process.env[k]) { console.log(`MISSING SECRET: ${k}`); process.exit(1); }
}

async function getToken() {
  const q = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  const r = await fetch(`${ACCOUNTS}/oauth/v2/token?${q}`, { method: 'POST' });
  const j = await r.json();
  if (!j.access_token) { console.log('TOKEN FAILED:', JSON.stringify(j)); process.exit(1); }
  return j;
}

let TOKEN, API;
async function api(path, params = {}) {
  const url = `${API}/crm/${V}/${path}` + (Object.keys(params).length ? `?${new URLSearchParams(params)}` : '');
  const r = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${TOKEN}` } });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${path}: ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

const line = (s = '') => console.log(s);
const hr = (t) => line(`\n==================== ${t} ====================`);

function valueOf(v, f) {
  if (v === null || v === undefined || v === '') return '(blank)';
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === 'object' ? x.name ?? x.id : x)).join(' + ') : '(blank)';
  if (typeof v === 'object') return v.name ?? '(object)';
  return String(v);
}

async function main() {
  const t = await getToken();
  TOKEN = t.access_token;
  API = t.api_domain || 'https://www.zohoapis.com';
  line(`OK token. API domain: ${API}`);

  const org = await api('org').catch((e) => ({ err: e.message }));
  if (org?.org?.[0]) line(`Org: ${org.org[0].company_name} | time zone ${org.org[0].time_zone} | currency ${org.org[0].currency}`);

  hr('MODULES');
  const mods = (await api('settings/modules')).modules.filter((m) => m.api_supported);
  for (const m of mods) line(`${m.api_name.padEnd(28)} | ${String(m.plural_label).padEnd(28)} | ${m.generated_type}`);

  const focus = mods.filter((m) =>
    ['Leads', 'Contacts', 'Deals', 'Accounts'].includes(m.api_name) || m.generated_type === 'custom');

  for (const m of focus) {
    hr(`MODULE ${m.api_name} (${m.plural_label})`);
    try {
      const c = await api(`${m.api_name}/actions/count`);
      line(`Total records: ${c?.count ?? 0}`);
    } catch (e) { line(`count unavailable: ${e.message}`); }

    let fields = [];
    try { fields = (await api('settings/fields', { module: m.api_name })).fields; }
    catch (e) { line(`fields unavailable: ${e.message}`); continue; }

    line('\n-- Fields (api_name | label | type | extra)');
    for (const f of fields) {
      let extra = '';
      if (f.lookup?.module) extra = `lookup -> ${f.lookup.module.api_name}`;
      if (f.pick_list_values?.length)
        extra = 'values: ' + f.pick_list_values.map((p) => p.display_value).slice(0, 40).join(' | ');
      line(`${f.api_name.padEnd(32)} | ${String(f.field_label).padEnd(30)} | ${f.data_type.padEnd(12)} | ${extra}`);
    }

    // Fields worth counting: picklists, booleans, lookups to companies/custom, and name-matched text.
    const safeLookup = (f) => f.data_type === 'lookup' &&
      !['Leads', 'Contacts', 'users', 'Users'].includes(f.lookup?.module?.api_name);
    const tally = fields.filter((f) =>
      ['picklist', 'multiselectpicklist', 'boolean'].includes(f.data_type) ||
      safeLookup(f) ||
      (['text', 'textarea'].includes(f.data_type) && MATCH.test(f.api_name + ' ' + f.field_label))
    ).slice(0, 48);
    const want = [...new Set(['Created_Time', ...tally.map((f) => f.api_name)])];

    const counts = Object.fromEntries(tally.map((f) => [f.api_name, new Map()]));
    const months = new Map();
    let n = 0, token = null, page = 1;
    try {
      while (n < MAX_RECORDS) {
        const params = { fields: want.join(','), per_page: '200', sort_by: 'Created_Time', sort_order: 'desc' };
        if (token) params.page_token = token; else params.page = String(page);
        const j = await api(m.api_name, params);
        if (!j?.data?.length) break;
        for (const r of j.data) {
          n++;
          const mo = String(r.Created_Time || '').slice(0, 7) || '(none)';
          months.set(mo, (months.get(mo) || 0) + 1);
          for (const f of tally) {
            const v = valueOf(r[f.api_name], f);
            counts[f.api_name].set(v, (counts[f.api_name].get(v) || 0) + 1);
          }
        }
        if (!j.info?.more_records) break;
        token = j.info.next_page_token || null;
        if (!token) page++;
      }
    } catch (e) { line(`records unavailable: ${e.message}`); }

    line(`\n-- Records scanned: ${n} (newest first, cap ${MAX_RECORDS})`);
    line('-- Created per month: ' + [...months].sort().map(([k, v]) => `${k}:${v}`).join('  '));
    for (const f of tally) {
      const top = [...counts[f.api_name]].sort((a, b) => b[1] - a[1]).slice(0, 20);
      if (!top.length) continue;
      line(`\n[${f.api_name}] ${f.field_label} (${f.data_type})`);
      for (const [v, c] of top) line(`   ${String(c).padStart(5)}  ${v.slice(0, 80)}`);
    }
  }
  hr('DONE');
}

main().catch((e) => { console.log('FAILED:', e.message); process.exit(1); });
