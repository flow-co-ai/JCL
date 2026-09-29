// Matches sheet case names ("Client v. Defendant") to Zoho cases (Deal_Name).
const STOP = /\b(llc|inc|lp|l p|pllc|ltd|corp|corporation|co|company|the|dba|group|services|solutions|financial|et al)\b/g;
export const norm = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[.,'’"()]/g, ' ').replace(/\s+/g, ' ').trim();
function split(s) {
  const n = norm(s), parts = n.split(/\s+(?:v|vs)\s+/);
  return { full: n, client: parts[0] || n, def: parts.slice(1).join(' ') };
}
const clientKey = (c) => { const t = c.split(' ').filter((w) => w.length > 1 && w !== 'and'); return t.length ? `${t[0]} ${t.at(-1)}` : c; };
const defWord = (d) => norm(d).replace(STOP, ' ').split(' ').filter((w) => w.length > 2)[0] || '';

export function buildMatcher(deals) {
  const byFull = new Map(), byClient = new Map(), byKey = new Map();
  const add = (m, k, d) => { if (!k) return; (m.get(k) || m.set(k, []).get(k)).push(d); };
  for (const d of deals) {
    if (!d.Deal_Name) continue;
    const s = split(d.Deal_Name);
    add(byFull, s.full, d); add(byClient, s.client, d); add(byKey, clientKey(s.client), d);
    d._defWord = defWord(s.def || d.Account_Name || '');
    d._accWord = defWord(d.Account_Name || '');
  }
  const pick = (list, dw) => {
    if (!list?.length) return null;
    if (list.length === 1) return list[0];
    const hit = list.filter((d) => dw && (d._defWord === dw || d._accWord === dw));
    return hit.length === 1 ? hit[0] : hit.length > 1 ? hit.sort((a, b) => String(b.Created_Time).localeCompare(String(a.Created_Time)))[0] : null;
  };
  return (name) => {
    const s = split(name), dw = defWord(s.def);
    return pick(byFull.get(s.full), dw) || pick(byClient.get(s.client), dw) || pick(byKey.get(clientKey(s.client)), dw) || null;
  };
}
