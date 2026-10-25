# House Hunt — notes for Claude Code

A shared phone app for Jack and Jakey's flat hunt: homes imported from Rightmove (screenshots, full-page PDF or pasted text), viewings, a checklist and notes per flat, offers, estate agents with tap-to-call, a map, compare, calendar feed. Built to work at viewings with no signal.

## Working with Jack
- List observations and ask before building. Don't pick what to implement yourself.
- Keep replies concise and direct. UK English. Never use the word "seldom".
- Jack has no local Node environment. No build step, no npm — changes must work as plain files on GitHub Pages.

## Stack
- `index.html` loads React 18, supabase-js v2, Leaflet and Babel standalone from jsDelivr, then `app.jsx` as `type="text/babel"` (compiled in the browser, like the gym tracker).
- Hosting: GitHub Pages from `main` / root → https://jackkianders0n-gif.github.io/house-hunt/ — installed on both iPhones via Safari → Add to Home Screen.
- Backend: the **gym tracker's Supabase project**. Everything house-hunt is prefixed `hh_` — never touch the gym tables.
- pdf.js (pinned `pdfjs-dist@6.2.108`) is loaded lazily from jsDelivr only when a PDF is imported. In v6 use `render({ canvas, viewport })` and `loadingTask.destroy()` (`pdf.destroy()` no longer exists).

## Rules that bite
- **Bump `CACHE` in `sw.js` on every change to app files** (`househunt-v1` → `househunt-v2` …) or the phones keep the old version.
- CDN scripts: pinned versions on cdn.jsdelivr.net, UMD builds. (Gym tracker lessons: an unpkg Recharts path 404'd; supabase-js's ESM build broke a classic script — use `dist/umd/supabase.js`.)
- `SUPABASE_URL` in `app.jsx` must be the bare project URL — no trailing slash, no `/rest/v1/`. The anon key is fine in public code; access rules protect the data.
- Never commit personal emails or secrets. `supabase/schema.sql` keeps placeholder emails on purpose.
- iOS: inputs need `font-size: 16px` or Safari zooms on focus. Respect safe areas (`env(safe-area-inset-*)`).
- Children of `.scroll` must not shrink (`.scroll > * { flex-shrink: 0 }`) — removing it squashes cards.

## Files
| Path | What |
|---|---|
| `app.jsx` | The whole app: store (`useHouseHunt`), hash router, all screens |
| `styles.css` | All styles; colour tokens at the top |
| `sw.js` | Service worker: app files network-first, CDN cache-first |
| `supabase/schema.sql` | Full database setup, idempotent (safe to rerun) |
| `supabase/functions/hh-import/index.ts` | Edge Function: Claude reads the listing; also geocodes addresses |
| `supabase/functions/hh-calendar/index.ts` | Edge Function: viewings as an .ics feed / single event |

## Data model (Supabase, all RLS: members only via `hh_is_member()`)
- `hh_members` — the two user ids allowed in. No policies; read only by the security-definer `hh_is_member()`.
- `hh_properties` — one row per flat. `status` ∈ shortlisted, viewing_booked, viewed, offer_made, offer_accepted, not_for_us. `checklist` jsonb `{ itemId: bool }`, `price_history` jsonb `[{ price, at }]` (previous prices), `listing_status` (Rightmove: Available / Under offer / Sold STC / Reserved), `photo_path` in the private `hh-photos` bucket.
- `hh_agents`, `hh_offers` (outcome ∈ waiting, rejected, countered, accepted, withdrawn), `hh_checklist_items`, `hh_settings` (key/value: `lease_warning_years`, `council_tax` per band, `calendar_key`).
- RPC `hh_set_check(property, item, value)` ticks one item without overwriting the other person's ticks.
- All `hh_` tables are in the `supabase_realtime` publication — the app reloads on changes.

## How the app handles data
- `useHouseHunt()` loads everything, caches it in localStorage, signs photo URLs, and subscribes to realtime.
- Offline: `patchProperty`, `setCheck`, `saveOffer`, `deleteOffer` go through `attempt()` — on a network error the change is queued (`hh-queue-v1`), shown in the sync bar, re-applied over fresh data by `overlayQueue()`, and flushed on reconnect. New writes that should work offline must use this path; anything else (new homes, photos, agents, imports) needs signal and says so.
- Routes are hash based: `#/homes`, `#/map`, `#/import[/id]`, `#/review`, `#/edit/id`, `#/property/id[/checklist]`, `#/agents`, `#/agent/id`, `#/compare`, `#/settings`.

## Changing the backend
- **Database:** write idempotent SQL (`create … if not exists`, `add column if not exists`, `drop policy if exists` then `create policy`). Any new table: `hh_` prefix, RLS on, `hh members only` policy using `hh_is_member()`, grants to `authenticated`, add to `supabase_realtime`. Update `schema.sql` too, and give Jack the snippet to run in **Supabase → SQL Editor**.
- **Edge Functions:** after editing, Jack redeploys in **Supabase → Edge Functions** (paste into the function's editor and deploy). `hh-import` keeps JWT verification **on**; `hh-calendar` has it **off** (protected by `calendar_key`).
- **Claude API in `hh-import`:** default model `claude-sonnet-5-5` (override with `ANTHROPIC_MODEL` secret). Structured output via `output_config.format` (`json_schema`); forced `tool_choice` isn't supported on this model and `temperature` returns a 400. Keep optional schema fields ≤ 24 and avoid union types. The key must be scoped to a workspace (no `anthropic-workspace-id` header is sent).
- Secrets: `ANTHROPIC_API_KEY` (required), `CONTACT_EMAIL` (optional, for OpenStreetMap's Nominatim).

## Design
Manrope; ground `#F3F4F1`, ink `#17211C`, accent green `#1E6A50`; status colours in `STATUSES` in `app.jsx`; warnings (short lease, Under offer) use `#FBE3DF` / `#8A2E22`. Phone-first, 44px touch targets, max width 560px.

## Before pushing
- Check `app.jsx` still parses (a JSX syntax error shows a blank screen on the phones).
- Bump `CACHE` in `sw.js`.
- Say what Jack needs to do outside the repo (SQL to run, function to redeploy), if anything.
