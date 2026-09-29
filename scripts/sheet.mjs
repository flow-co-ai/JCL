// Reads the JCL Tracker Google Sheet (read-only) with a service account.
// Returns one row per packaged case from the 2026 monthly tabs, with the chargeback flag (red row).
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
const isRed = (c) => c && (c.red ?? 0) > 0.75 && (c.green ?? 0) < 0.65 && (c.blue ?? 0) < 0.65;
const cellText = (v) => (v?.formattedValue ?? '').toString().trim();
const q = (t) => `'${t.replace(/'/g, "''")}'`;

export async function sheetPull(cfg) {
  const sa = JSON.parse(process.env.GOOGLE_SA_JSON);
  const tok = await token(sa), id = cfg.sheet.id;
  const api = async (path, params) => {
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}${path}?${params}`, { headers: { Authorization: `Bearer ${tok}` } });
    const j = await r.json();
    if (!r.ok) throw new Error(`Sheets ${r.status}: ${JSON.stringify(j).slice(0, 300)}` + (r.status === 403 ? ' — share the sheet with the service account email as Viewer.' : ''));
    return j;
  };
  const meta = await api('', new URLSearchParams({ fields: 'sheets.properties.title' }));
  const titles = meta.sheets.map((s) => s.properties.title);
  const yy = String(cfg.sheet.year).slice(2);
  const monthTabs = titles.map((t) => ({ t, m: MONTHS.findIndex((M) => new RegExp(`^${M}\\s*'${yy}\\s*$`, 'i').test(t.trim())) }))
    .filter((x) => x.m >= 0);
  const allTab = titles.find((t) => /all.?time packaged/i.test(t));

  const p = new URLSearchParams({ includeGridData: 'true', fields: 'sheets(properties.title,data.rowData.values(formattedValue,effectiveFormat.backgroundColor))' });
  for (const x of monthTabs) p.append('ranges', `${q(x.t)}!A1:F300`);
  if (allTab) p.append('ranges', `${q(allTab)}!A1:G2000`);
  const grid = await api('', p);

  const redNames = new Set(), allFiled = new Set(), allDrafted = new Set();
  const out = [];
  for (const sh of grid.sheets) {
    const title = sh.properties.title, rows = sh.data?.[0]?.rowData || [];
    if (title === allTab) {
      for (const r of rows.slice(1)) {
        const v = r.values || [], name = cellText(v[1]); if (!name) continue;
        const red = v.slice(0, 7).some((c) => isRed(c?.effectiveFormat?.backgroundColor));
        if (red) redNames.add(name.toLowerCase());
        if (/true/i.test(cellText(v[5]))) allFiled.add(name.toLowerCase());
        if (/true/i.test(cellText(v[2]))) allDrafted.add(name.toLowerCase());
      }
      continue;
    }
    const mi = monthTabs.find((x) => x.t === title).m;
    const tabMonth = `${cfg.sheet.year}-${String(mi + 1).padStart(2, '0')}`;
    for (const r of rows.slice(1)) {
      const v = r.values || [], name = cellText(v[1]);
      if (!name || !/\sv\.?\s/i.test(name)) continue; // case rows look like "Client v. Defendant"
      const d = cellText(v[2]).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      const date = d ? `${d[3]}-${d[1].padStart(2, '0')}-${d[2].padStart(2, '0')}` : null;
      out.push({ name, member: cellText(v[0]) || '—', date, m: tabMonth,
        source: cellText(v[3]) || 'Not recorded', drafted: cellText(v[4]), filing: cellText(v[5]),
        red: (v.slice(0, 6)).some((c) => isRed(c?.effectiveFormat?.backgroundColor)) });
    }
  }
  for (const r of out) {
    const k = r.name.toLowerCase();
    if (redNames.has(k)) r.red = true;
    r.isFiled = /^filed/i.test(r.filing) || allFiled.has(k);
    r.isDrafted = !!r.drafted || allDrafted.has(k);
  }
  return { rows: out, tabs: monthTabs.map((x) => x.t), allTab: allTab || null, redInAllTab: redNames.size };
}
