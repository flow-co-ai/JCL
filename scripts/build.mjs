// Build: pull Zoho + Windsor, aggregate, encrypt to public/data.enc.json.
// Local preview: FIXTURE=sample/fixture.json NO_ENCRYPT=1 node scripts/build.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { zohoPull, windsorPull } from './sources.mjs';
import { transform } from './transform.mjs';
import { sheetPull } from './sheet.mjs';

const cfg = JSON.parse(fs.readFileSync('config.json', 'utf8'));
let raw;
if (process.env.FIXTURE) {
  raw = JSON.parse(fs.readFileSync(process.env.FIXTURE, 'utf8'));
  console.log('Using fixture data');
} else {
  for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN', 'WINDSOR_API_KEY', 'DASHBOARD_KEY', 'GOOGLE_SA_JSON'])
    if (!process.env[k]) { console.log(`MISSING SECRET: ${k}`); process.exit(1); }
  const z = await zohoPull(cfg);
  console.log(`Zoho: ${z.deals.length} cases, ${z.leads.length} leads`);
  const w = await windsorPull(cfg);
  console.log(`Windsor: meta ${w.meta.length}, ga4 ${w.ga4.length}, sc ${w.sc_daily.length} rows, errors ${w.errors.length}`);
  const s = await sheetPull(cfg);
  console.log(`Sheet: ${s.rows.length} packaged cases from ${s.tabs.length} tabs (${s.tabs.join(', ')}), ${s.rows.filter((r) => r.red).length} red`);
  raw = { ...z, windsor: w, sheet: s };
}

const data = transform(raw, cfg);
const q = data.quality;
const unmatched = data._unmatched; delete data._unmatched;
console.log(`Matched to Zoho: ${q.sheet.matched} of ${q.sheet.rows} packaged cases (${unmatched.length} not found)`);
if (process.env.SHOW_UNMATCHED) for (const u of unmatched) console.log('  not found:', u);
console.log(`Paid cases ${q.paid} | missing fee ${q.paid_no_fee} | missing paid date ${q.paid_no_date} | reconcile ${q.reconcile_ok}/${q.reconcile_n}`);
if (!process.env.FIXTURE && q.cases < 100) { console.log('Too few cases returned; not publishing.'); process.exit(1); }

const json = JSON.stringify(data);
fs.mkdirSync('public', { recursive: true });
if (process.env.NO_ENCRYPT) {
  fs.writeFileSync('public/data.json', json);
  console.log('Wrote public/data.json (unencrypted, preview only)');
} else {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(process.env.DASHBOARD_KEY, salt, 200000, 32, 'sha256');
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(zlib.gzipSync(json)), c.final(), c.getAuthTag()]);
  fs.writeFileSync('public/data.enc.json', JSON.stringify({ v: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64') }));
  if (fs.existsSync('public/data.json')) fs.unlinkSync('public/data.json');
  console.log(`Wrote public/data.enc.json (${Math.round(ct.length / 1024)} KB)`);
}
