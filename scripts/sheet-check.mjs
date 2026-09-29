// JCL Tracker probe. READ-ONLY. Prints the structure of every tab so the dashboard reads it correctly.
// Case-name columns are never printed; only headers, value counts, colors and the goal blocks.
import fs from 'node:fs';
import crypto from 'node:crypto';
const cfg = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const sa = JSON.parse(process.env.GOOGLE_SA_JSON || '{}');
if (!sa.client_email) { console.log('MISSING SECRET: GOOGLE_SA_JSON'); process.exit(1); }
const b64 = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const now = Math.floor(Date.now() / 1000);
const h = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' })), c = b64(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
const jwt = `${h}.${c}.${b64(crypto.createSign('RSA-SHA256').update(`${h}.${c}`).sign(sa.private_key))}`;
const tok = (await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }) })).json()).access_token;
if (!tok) { console.log('TOKEN FAILED'); process.exit(1); }
const p = new URLSearchParams({ includeGridData: 'true', fields: 'sheets(properties.title,data.rowData.values(formattedValue,effectiveFormat.backgroundColor,effectiveFormat.textFormat.strikethrough))' });
const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheet.id}?${p}`, { headers: { Authorization: `Bearer ${tok}` } });
const j = await r.json(); if (!r.ok) { console.log('SHEETS ERROR', r.status, JSON.stringify(j).slice(0, 400)); process.exit(1); }

const txt = (v) => (v?.formattedValue ?? '').toString().trim();
const col = (bg) => (bg ? [bg.red, bg.green, bg.blue].map((x) => Math.round((x ?? 0) * 255)).join(',') : 'none');
const looksLikeName = (s) => /\sv\.?\s/i.test(s) || /^[A-Z][a-z]+ [A-Z]/.test(s);
const mask = (s) => (looksLikeName(s) ? '[name]' : s.replace(/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/g, '[phone]').replace(/\S+@\S+/g, '[email]').slice(0, 70));
for (const sh of j.sheets) {
  const rows = sh.data?.[0]?.rowData || [];
  console.log(`\n==================== TAB: ${sh.properties.title} (${rows.length} rows) ====================`);
  const width = Math.max(0, ...rows.map((x) => (x.values || []).length));
  for (let i = 0; i < Math.min(3, rows.length); i++) console.log(`row ${i + 1}: ` + (rows[i].values || []).map((v) => mask(txt(v))).join(' | '));
  for (let ci = 0; ci < Math.min(width, 16); ci++) {
    const counts = new Map(), colors = new Map(); let filled = 0, names = 0, strike = 0;
    for (const row of rows.slice(1)) {
      const v = row.values?.[ci]; const t = txt(v);
      if (t) { filled++; if (looksLikeName(t)) names++; else counts.set(t.replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, '<date>'), (counts.get(t.replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, '<date>')) || 0) + 1); }
      const k = col(v?.effectiveFormat?.backgroundColor); if (t || k !== '255,255,255') colors.set(k, (colors.get(k) || 0) + 1);
      if (v?.effectiveFormat?.textFormat?.strikethrough) strike++;
    }
    if (!filled && colors.size <= 1) continue;
    const L = String.fromCharCode(65 + ci);
    console.log(`  col ${L}: ${filled} filled${names ? `, ${names} look like case names` : ''}${strike ? `, ${strike} strikethrough` : ''}`);
    const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 14);
    if (top.length) console.log('     values: ' + top.map(([k, n]) => `${mask(k)} ×${n}`).join('  |  '));
    const cs = [...colors].sort((a, b) => b[1] - a[1]).slice(0, 6);
    console.log('     colors (rgb ×cells): ' + cs.map(([k, n]) => `${k} ×${n}`).join('  |  '));
  }
}
console.log('\nDONE');
