# House Hunt — notes for Claude Code

A shared phone app for Jack and Jakey's flat hunt: homes imported from Rightmove (Safari share button → Inbox, screenshots, full-page PDF or pasted text), viewings, a checklist and notes per flat, offers, estate agents with tap-to-call, a map, compare, viewings in a shared iCloud calendar. Built to work at viewings with no signal.

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
| `supabase/functions/hh-import/index.ts` | Edge Function: Claude reads the listing; geocodes; inbox (share button); agent lookup (web search) and signature reading |
| `shortcut/add-to-house-hunt.js` | Script pasted into the iOS Shortcut's "Run JavaScript on Web Page"; returns `JSON.stringify({ url, text, data, image })` |
| `supabase/functions/hh-calendar/index.ts` | Edge Function: writes viewings into the shared iCloud calendar (CalDAV); old .ics feed still served on GET |

## Data model (Supabase, all RLS: members only via `hh_is_member()`)
- `hh_members` — the two user ids allowed in. No policies; read only by the security-definer `hh_is_member()`.
- `hh_properties` — one row per flat. `status` ∈ shortlisted, viewing_booked, viewed, offer_made, offer_accepted, not_for_us. `checklist` jsonb `{ itemId: bool }`, `price_history` jsonb `[{ price, at }]` (previous prices), `listing_status` (Rightmove: Available / Under offer / Sold STC / Reserved), `photo_path` in the private `hh-photos` bucket. `ratings` jsonb `{ userId: 0.5–5 in halves }` — each person's stars, set with RPC `hh_set_rating(property, value numeric)` (0 clears; only touches your own). Tapping a star fills it, again makes it a half, a third time clears.
- `hh_agents` (incl. `website`, `address`), `hh_offers` (outcome ∈ waiting, rejected, countered, accepted, withdrawn), `hh_checklist_items`, `hh_settings` (key/value: `lease_warning_years`, `council_tax` per band, `calendar_key`, `import_key`, `icloud_status` `{ ok, error?, count?, removed?, at }` written by `hh-calendar`).
- `hh_inbox` — listings shared from Safari. `status` ∈ processing, ready, failed, done; `listing`/`location` are the same shapes the import action returns; `agent_lookup` is `{ agency, phone, email, website, address, source_url }`, `{ error }` or null; `photo_path` under `inbox/` in `hh-photos`; `payload` `{ text, data }` kept for Try again. The app hides `done` rows and treats `processing` older than 5 minutes as failed.
- `hh_calls` — calls to agents about a flat: `property_id`, `agent_id`, `called_at`, `outcome` ∈ booked, voicemail, no_answer, spoke, `note`, `created_by`. Saved and deleted offline through `attempt()` like offers.
- RPC `hh_set_check(property, item, value)` ticks one item without overwriting the other person's ticks.
- RPC `hh_member_names()` (security definer, members only) returns `{ user_id, display_name }` so ratings can be labelled Jack / Jakey; the store exposes `members` and `me`.
- All `hh_` tables are in the `supabase_realtime` publication — the app reloads on changes.
- Triggers `hh_properties_calendar_{insert,update,delete}` call `hh_calendar_push()`, which uses pg_net to POST `{ id }` to `hh-calendar` (header `x-calendar-key`) when a viewing or a field shown in the event changes. The project URL is written into that function in `schema.sql`.

## How the app handles data
- `useHouseHunt()` loads everything, caches it in localStorage, signs photo URLs, and subscribes to realtime.
- Offline: `patchProperty`, `setCheck`, `setRating`, `saveOffer`, `deleteOffer`, `saveCall`, `deleteCall` go through `attempt()` — on a network error the change is queued (`hh-queue-v1`), shown in the sync bar, re-applied over fresh data by `overlayQueue()`, and flushed on reconnect. New writes that should work offline must use this path; anything else (new homes, photos, agents, imports) needs signal and says so.
- Routes are hash based: `#/homes`, `#/map`, `#/inbox`, `#/import[/id]`, `#/review`, `#/edit/id[/field]` (focuses that input), `#/property/id[/checklist]`, `#/agents`, `#/calls` (Call list), `#/agent/id`, `#/compare`, `#/settings`.
- Every Call button calls `store.startCall(agentId, propertyId)` before dialling; the pending call is kept in localStorage (`hh-pending-call`) and Main shows the "How did the call go?" `CallSheet` until it's saved or closed.
- "Not for us" homes are left out of All on Homes and only show under their own chip.
- Inbox drafts carry `inboxId`/`inboxPhotoPath`; saving the review calls `finishInbox` (marks done, deletes the inbox photo). New-agent drafts with an agency run `agent_lookup` from the review screen (`d.lookup` holds its state); inbox items arrive with it already done.

## Changing the backend
- **Database:** write idempotent SQL (`create … if not exists`, `add column if not exists`, `drop policy if exists` then `create policy`). Any new table: `hh_` prefix, RLS on, `hh members only` policy using `hh_is_member()`, grants to `authenticated`, add to `supabase_realtime`. Update `schema.sql` too, and give Jack the snippet to run in **Supabase → SQL Editor**.
- **Edge Functions:** after editing, Jack redeploys in **Supabase → Edge Functions** (paste into the function's editor and deploy). Both have JWT verification **off**: `hh-import` checks `hh_is_member()` itself for every action except `inbox_add`, which is protected by `import_key`; `hh-calendar` is protected by `calendar_key` (header `x-calendar-key`, or `?key=` for the GET feed). Functions deployed from the dashboard editor can't share files, which is why the inbox lives inside `hh-import`.
- **hh-import actions:** `import`, `geocode`, `agent_lookup`, `agent_from_text`, `inbox_retry` (members), `inbox_add` (import key; replies at once, reads in the background with `EdgeRuntime.waitUntil`). Time limits: 100s for the listing call, 45s for the agent lookup, 8s per Nominatim/postcodes.io lookup; the app gives up on `callImport` after 110s.
- **Claude API in `hh-import`:** default model `claude-sonnet-5-5` (override with `ANTHROPIC_MODEL` secret). Structured output via `output_config.format` (`json_schema`); forced `tool_choice` isn't supported on this model and `temperature` returns a 400. The listing schema hit "Schema is too complex" with optional fields, so every field is required and "not found" is `""` / `-1` / `photo.found: false` (mapped back to null by `tidyListing`); if the schema is still rejected it retries as plain JSON. The key must be scoped to a workspace (no `anthropic-workspace-id` header is sent).
- **Web search** (`web_search_20260209`, max 3 uses, $10 per 1,000 searches) can't be combined with `output_config.format` (its citations aren't allowed with it), so `agent_lookup` asks for plain JSON and parses it; it handles `pause_turn` by sending the assistant turn back. If an admin disables web search (Console → Settings → Capabilities) the API returns a 400 that the function turns into a readable message.
- **hh-calendar:** POST `{ id }` (from the trigger; replies 202 and works in the background) or `{ all: true }` (Settings → Sync all; reconciles the whole calendar and only deletes events named `<uuid>.ics`, so hand-made events survive). Finds the calendar by name through iCloud's CalDAV discovery (`caldav.icloud.com` → principal → calendar home), PUTs each viewing as `<home id>.ics` (no `METHOD` line — CalDAV rejects it), 10s per request. Agent edits don't trigger it; Sync all picks them up.
- Secrets: `ANTHROPIC_API_KEY` (required), `CONTACT_EMAIL` (optional, for OpenStreetMap's Nominatim), `ICLOUD_APPLE_ID` + `ICLOUD_APP_PASSWORD` (app-specific password) and optional `ICLOUD_CALENDAR` (default `House hunt`) for `hh-calendar`.

## Design
Manrope; ground `#F3F4F1`, ink `#17211C`, accent green `#1E6A50`; status colours in `STATUSES` in `app.jsx`; warnings (short lease, Under offer) use `#FBE3DF` / `#8A2E22`. Phone-first, 44px touch targets, max width 560px.

## Before pushing
- Check `app.jsx` still parses (a JSX syntax error shows a blank screen on the phones).
- Bump `CACHE` in `sw.js`.
- Bump `APP_VERSION` in `app.jsx` (shown in Settings, so Jack can tell when a phone has the update).
- Say what Jack needs to do outside the repo (SQL to run, function to redeploy), if anything.
