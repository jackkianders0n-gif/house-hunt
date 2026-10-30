# House Hunt

A shared phone app for the flat hunt: homes shared straight from Safari or imported from Rightmove screenshots or a full-page PDF, viewings, a checklist and notes per flat, offers, estate agents with tap-to-call, a map and a side-by-side compare. Works with no signal at viewings and stays in sync between your two phones.

Same setup as the gym tracker: `index.html` + `app.jsx` (React, compiled in the browser, no build step), Supabase for logins and data (in the gym tracker's project), hosted on GitHub Pages and added to the home screen.

## What's in here

| File | What it is |
|---|---|
| `index.html`, `app.jsx`, `styles.css` | The app |
| `sw.js`, `manifest.webmanifest`, `icons/` | Home-screen install and offline copy |
| `supabase/schema.sql` | Tables, access rules, photo storage, live updates, starter checklist — run once |
| `supabase/functions/hh-import/index.ts` | Edge Function: screenshots/PDF/shared pages → Claude → listing details, map location, inbox, agent details |
| `shortcut/add-to-house-hunt.js` | The script for the Safari share button Shortcut |
| `supabase/functions/hh-calendar/index.ts` | Edge Function: puts booked viewings into your shared iCloud calendar |

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
3. Turn **JWT verification off** for this one. The Safari share button can't sign in, so it uses a private import key instead; everything else the function does still checks you're in `hh_members`, so nobody else can spend your API credit.

### 3. Calendar function
Booked viewings go into a shared iCloud calendar that you both see.
1. **Make the calendar** (Jack, on iPhone): Calendar → **Calendars** → **Add Calendar** → name it `House hunt`, account **iCloud**. Tap ⓘ next to it → **Add Person** → Jakey. Jakey accepts the invite.
2. **Make an app-specific password** for the Apple ID that owns the calendar: [account.apple.com](https://account.apple.com) → **Sign-In and Security** → **App-Specific Passwords** → name it `House Hunt`. It lets the function write to your calendars, nothing else, and you can revoke it there any time.
3. Supabase → Edge Functions → **Secrets** → add:
   - `ICLOUD_APPLE_ID` — the Apple ID email
   - `ICLOUD_APP_PASSWORD` — the app-specific password (`xxxx-xxxx-xxxx-xxxx`)
   - `ICLOUD_CALENDAR` — only if the calendar isn't called `House hunt`
4. Deploy a second function the same way as the first, named `hh-calendar`, from `supabase/functions/hh-calendar/index.ts`. Turn **JWT verification off**: the database can't sign in, so the function checks a long private key that `schema.sql` created and only you two can read.
5. In the app: **Settings → Sync all viewings now** once, to add the viewings you already have.

From then on, booking, moving or cancelling a viewing updates the calendar within a few seconds (the database tells the function, so it works however the change was made, including changes made offline once they sync).

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
- **Settings → Sync all viewings now** once, after setting up the calendar in step 3.

### 7. Safari share button (optional, each phone)
See [Safari share button](#safari-share-button) below.

## Using it
- **Share from Safari:** on a Rightmove listing, tap Share → **Add to House Hunt**. It lands in the **Inbox** (tray icon on Homes) while Claude reads it, usually within a minute. Tap it when it says *Ready to check*. It reads the whole page, including the collapsed sections, so lease, service charge and council tax come through more often than with screenshots.
- **Import:** the other way is Safari → screenshot the listing → **Full Page** → save as PDF to Files → add it in Import. Screenshots and pasted text work too. Paste the Rightmove link (Share → Copy) so duplicates are caught.
- **Duplicates and changes:** importing a flat you already have offers to update it instead. On any home, **Update from Rightmove** shows what's changed (price drops, Under offer, Sold STC) before saving. Your address, pin, agent, status, checklist and notes are kept.
- **Viewings:** tap the status pill to move a home along. When you book a viewing, add the full address and postcode from the agent — the pin moves to the door and Directions go there. The viewing appears in your shared House hunt calendar by itself.
- **At the viewing:** ticks, notes, status changes and offers save even with no signal. A bar at the top shows how many changes are waiting; they sync on their own when you're back online.
- **Ratings:** on each home, tap your stars (1–5) under the viewing box; tap the same star again to clear it. Both your ratings show on the home cards.
- **Sorting:** tap **Sorted by…** above the list to sort by status, our rating, price, size, £ per sq ft, lease left, service charge or running costs. Each starts best first; tap the same option again to flip it. Homes without that detail go to the end, and figures not already on the cards show in a green tag.
- **Call list:** Agents → **Call list** lists every flat still to book, ranked by your ratings, with the agent's number and a Call button. After a call the app asks how it went (viewing booked, voicemail, no answer, spoke), and can mark the agent's other flats too. A booked viewing goes straight onto the flat. Use **Log a call** for calls you made without the button. Calls show on the Agents list, each agent's page and each flat, with who made them.
- **Not for us:** these flats are hidden from All on Homes; tap the **Not for us** chip to see them.
- **Ask the agent:** on a home, any blank asking price, size, tenure, lease, service charge, ground rent or council tax band is listed as a question above the agent's call button. Tap one to fill it in.
- **Agents:** when an import finds a new agency, the app looks the branch up online and fills in its phone, email, website and address, marked *Found online — check it*. To add someone from an email, use **Paste an email or signature** → **Fill in**.
- **Offers:** log each offer with what happened (waiting, rejected, countered, accepted). Logging one moves the home to *Offer made*; accepting moves it to *Offer accepted*.
- **Both phones:** changes appear on the other phone within a second or two while the app is open.

## Safari share button
A Shortcut that adds the Rightmove listing you're looking at to the Inbox. Build it once on each phone; it takes about 5 minutes.

**Before you start**
- Run the latest `supabase/schema.sql` and redeploy `hh-import` (with JWT verification off).
- iPhone **Settings → Apps → Shortcuts → Advanced** → turn on **Allow Running Scripts**.
- In House Hunt, open **Settings → Share button setup**. You'll copy the **Function URL** and **Import key** from there.
- Open [`shortcut/add-to-house-hunt.js`](shortcut/add-to-house-hunt.js) on GitHub, tap **Raw**, and copy all of it.

**Build it** (Shortcuts app → **+**)
1. Name it **Add to House Hunt** (tap the name at the top).
2. Tap the **ⓘ** (Details) button → turn on **Show in Share Sheet** → Done. At the top of the shortcut, tap **Any** in *Receive Any input from Share Sheet*, deselect everything except **Safari web pages**. Set *If there's no input* to **Stop and Respond**.
3. Add **Run JavaScript on Web Page**. Its web page should be **Shortcut Input**. Tap the script, select all, and paste the script you copied.
4. Add **Get Dictionary Value**: *Get* **Value** *for* `image` *in* **JavaScript Result**.
5. Add **If**: *If* **Dictionary Value** **has any value**. Inside the If:
   - Add **Get Contents of URL** with the URL set to **Dictionary Value**.
   - Add **Base64 Encode** (input: **Contents of URL**). Tap ⌄ and set *Line Breaks* to **None**.
   - Under **Otherwise**, add a **Text** action and leave it empty.
6. After **End If**, add another **Get Contents of URL**:
   - URL: paste the **Function URL**.
   - Tap ⌄ → *Method* **POST** → *Request Body* **JSON** → add four **Text** fields:

     | Key | Value |
     |---|---|
     | `action` | `inbox_add` |
     | `key` | paste the **Import key** |
     | `page` | the **JavaScript Result** variable |
     | `image` | the **If Result** variable |
7. Add **Get Dictionary Value**: *Get* **Value** *for* `message` *in* **Contents of URL**.
8. Add **Show Notification** with **Dictionary Value** as the text.

**Use it:** on a Rightmove listing in Safari, tap Share → **Add to House Hunt**. The first time, allow it to run on rightmove.co.uk and to connect to your Supabase address (**Always Allow**). You'll see *Added to House Hunt inbox*.

**If it goes wrong**
- *The import key isn't right*: copy the key again from Settings. If either of you taps **Make a new key**, paste the new one into the Shortcut on both phones.
- *That isn't a Rightmove property page*: open the listing itself, not a search page.
- An inbox item that failed can be tried again from the Inbox, or opened on Rightmove.

## Updating
After changing any file, bump `CACHE` in `sw.js` (`househunt-v1` → `househunt-v2`) so phones pick up the new version — the same lesson as the gym tracker. App files are fetched network-first, so a normal reload usually shows changes straight away.

## Good to know
- Each import is one Claude API call (Sonnet 5.5 by default; change with an `ANTHROPIC_MODEL` secret). PDFs over 8 MB are refused — use screenshots for those.
- Looking up a new agent's branch is a second call using Claude's web search: up to 3 searches at $10 per 1,000, plus the pages read, so a few pence each. It only runs for agencies you don't have yet. Web search is on by default; if the app says it's turned off, an admin can turn it on in the Claude Console → Settings → Capabilities.
- Anyone with the import key can add listings to your inbox, so keep it to yourselves.
- Saving a new home, photos, agents and imports need signal. Ticks, notes, status, viewing times and offers don't.
- If you both edit the same notes at once, the last save wins. Ticks always merge.
- Viewings in the House hunt calendar are replaced whenever the home changes in the app, so edit them in the app, not in Calendar. Events you add to that calendar yourselves are left alone.
- If a viewing doesn't appear, Settings shows the last error from iCloud under **Viewings in iCloud Calendar**.
- Map © OpenStreetMap contributors. Address lookup uses OpenStreetMap (Nominatim) and postcodes.io. PDF reading in the app uses pdf.js.
