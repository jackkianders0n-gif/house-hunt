# House Hunt

A shared phone app for the flat hunt: homes imported from Rightmove screenshots or a full-page PDF, viewings, a checklist and notes per flat, offers, estate agents with tap-to-call, a map and a side-by-side compare. Works with no signal at viewings and stays in sync between your two phones.

Same setup as the gym tracker: `index.html` + `app.jsx` (React, compiled in the browser, no build step), Supabase for logins and data (in the gym tracker's project), hosted on GitHub Pages and added to the home screen.

## What's in here

| File | What it is |
|---|---|
| `index.html`, `app.jsx`, `styles.css` | The app |
| `sw.js`, `manifest.webmanifest`, `icons/` | Home-screen install and offline copy |
| `supabase/schema.sql` | Tables, access rules, photo storage, live updates, starter checklist — run once |
| `supabase/functions/hh-import/index.ts` | Edge Function: screenshots/PDF → Claude → listing details, plus map location |
| `supabase/functions/hh-calendar/index.ts` | Edge Function: your booked viewings as a calendar |

## Setup (about 20 minutes)

### 1. Database — Supabase, gym tracker project
1. Open `supabase/schema.sql` and replace the two emails in step 7 (near the bottom) with the ones you both use for the gym tracker.
2. Dashboard → **SQL Editor** → New query → paste the whole file → **Run**.
3. The last result should list both of you. Safe to run again if needed.

Everything is in `hh_` tables, so the gym data isn't touched. Only the two accounts in `hh_members` can see or change anything, even though other logins exist in the project.

### 2. Import function
1. Dashboard → **Edge Functions** → **Deploy a new function** → **Via Editor**. Name it `hh-import`, paste in `supabase/functions/hh-import/index.ts`, click **Deploy function**.
2. Edge Functions → **Secrets** → add:
   - `ANTHROPIC_API_KEY` — your Claude API key (the Our Kitchen one works, or make a new one in the Claude Console)
   - `CONTACT_EMAIL` — optional; sent to OpenStreetMap's address lookup, which asks apps to identify themselves
3. Leave JWT verification **on** for this one — it also checks you're in `hh_members`, so nobody else can spend your API credit.

### 3. Calendar function
1. Deploy a second function the same way, named `hh-calendar`, from `supabase/functions/hh-calendar/index.ts`.
2. In that function's settings, turn **JWT verification off**. Calendar apps can't sign in; instead the function checks a long private key that `schema.sql` created and only you two can read.

### 4. App config
At the top of `app.jsx`, paste the same two values the gym tracker uses (Project Settings → API):

```js
const SUPABASE_URL = "https://xxxx.supabase.co";   // bare URL — no trailing slash, no /rest/v1/
const SUPABASE_ANON_KEY = "eyJ…";
```

### 5. Host on GitHub Pages
1. New **public** repo (e.g. `house-hunt`) → upload everything in this folder, keeping the `icons/` and `supabase/` folders.
2. Repo **Settings → Pages** → Deploy from branch → `main` / root.
3. On each iPhone: open the Pages link in **Safari** → Share → **Add to Home Screen**. Sign in with your gym tracker login.

### 6. First time in the app (either of you)
- **Settings** (cog on Homes) → enter your council's yearly **council tax** for each band, so running costs include it. Change the **short-lease warning** if 85 years isn't right for you.
- **Settings → Subscribe in Calendar** on each phone, so booked viewings appear in Calendar.

## Using it
- **Import:** the quickest way is Safari → screenshot the listing → **Full Page** → save as PDF to Files → add it in Import. Screenshots and pasted text work too. Paste the Rightmove link (Share → Copy) so duplicates are caught.
- **Duplicates and changes:** importing a flat you already have offers to update it instead. On any home, **Update from Rightmove** shows what's changed (price drops, Under offer, Sold STC) before saving. Your address, pin, agent, status, checklist and notes are kept.
- **Viewings:** tap the status pill to move a home along. When you book a viewing, add the full address and postcode from the agent — the pin moves to the door and Directions go there. **Add to calendar** puts that one viewing straight into Calendar.
- **At the viewing:** ticks, notes, status changes and offers save even with no signal. A bar at the top shows how many changes are waiting; they sync on their own when you're back online.
- **Offers:** log each offer with what happened (waiting, rejected, countered, accepted). Logging one moves the home to *Offer made*; accepting moves it to *Offer accepted*.
- **Both phones:** changes appear on the other phone within a second or two while the app is open.

## Updating
After changing any file, bump `CACHE` in `sw.js` (`househunt-v1` → `househunt-v2`) so phones pick up the new version — the same lesson as the gym tracker. App files are fetched network-first, so a normal reload usually shows changes straight away.

## Good to know
- Each import is one Claude API call (Sonnet 5.5 by default; change with an `ANTHROPIC_MODEL` secret). PDFs over 8 MB are refused — use screenshots for those.
- Saving a new home, photos, agents and imports need signal. Ticks, notes, status, viewing times and offers don't.
- If you both edit the same notes at once, the last save wins. Ticks always merge.
- The calendar feed refreshes about once an hour on iPhone; "Add to calendar" is instant.
- Anyone with the calendar link can see your viewings, so keep it to yourselves.
- Map © OpenStreetMap contributors. Address lookup uses OpenStreetMap (Nominatim) and postcodes.io. PDF reading in the app uses pdf.js.
