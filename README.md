# Justice Consumer Law — firm report

Live at https://jcl-4oz4.netlify.app (password = DASHBOARD_KEY secret).

## How it works
GitHub Action (every 2 hours, on push, or Run workflow) → `scripts/build.mjs` pulls Zoho CRM (cases, leads) and Windsor
(Meta both accounts, GA4 533359334, Search Console) → aggregates to name-free totals → AES-256-GCM encrypts to
`public/data.enc.json` → deploys `public/` to Netlify. No client data is stored in the repo.

## Scope
Cases = the 2026 monthly tabs of the JCL Tracker Google Sheet (packaged cases; red row = chargeback; column A = team member).
Each is matched to its Zoho case by name for stage and dollars. Run the workflow with "show_unmatched" to list names that did not match.

## Where each number comes from (Zoho › Cases › Settlement Information)
- Fees: Attorney's Fees field × `fee_share` in config.json (1.0 = JCL + Guards Law combined).
- Settlement: Defendant 1–4 Settlement Amount. Client payout: Client Payout. Debt waived: Debt Waiver 1–3 (not cash).
- Collected: stage Settled Paid, dated by Settlement Paid Date. Won, not collected: Settled Unpaid + Settlement Agreement.
- Signed: Retainer Signed Date, else intake date. Aug–Oct 2024 imports without a date are excluded from monthly signing.

## Settings (config.json)
- `fee_share`: set to JCL's share (e.g. 0.5) once the Guards Law split is known.
- `source_groups`: which Zoho lead sources roll up into each source on the page.
- `source_costs`: monthly cost of paid sources other than Meta, e.g. `{"Credit Saint": {"2026-08": 5000}}`.
- `defendant_aliases`: merge spellings, e.g. `{"Freedom Debt Relief, LLC": "freedom debt relief"}`.
- `defendant_search_terms`: words that tie Google searches to each company.

## Checks
- `Zoho check` workflow: `fields` lists every Zoho field; `money` audits the dollar fields.
- Local preview: `node scripts/make-fixture.mjs && FIXTURE=sample/fixture.json NO_ENCRYPT=1 node scripts/build.mjs`, then serve `public/`.
