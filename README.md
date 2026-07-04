# CVOA Scheduler — real build (Supabase + React)

This is the production version of the scheduling prototype: real staff accounts,
a real database, and Row Level Security enforcing who can see and edit what.

**What's included in this pass:** staff sign-up/login, team availability
(single-date blocks, recurring days off, vacation ranges, daily breaks like
lunch), the public booking flow (individual + urgent routing + recurring
series + group orientation sessions + waitlist), guest self-service
reschedule/cancel by email, the staff dashboard (status tracking, `.ics`
export), settings (scheduling rules, accent color, booking links), and an
audit log.

**Deferred to the next pass** (the schema already has room for these, they
just need wiring): actually sending email/SMS confirmations and reminders
(needs a provider like Resend/Twilio via a Supabase Edge Function), waitlist
auto-notification emails, and a real `.ics` *subscription* feed (right now
it's a one-time download, not a live-updating calendar subscription).

## 1. Create your Supabase project

1. Go to [supabase.com](https://supabase.com) → New Project. Pick any name/region.
2. Once it's created, go to **SQL Editor** → New query, paste in the entire
   contents of `supabase/schema.sql` from this project, and run it.
3. Go to **Authentication → Providers** and make sure **Email** is enabled.
   For a first test, under **Authentication → Settings** you can turn off
   "Confirm email" so you can sign in immediately without checking an inbox —
   turn it back on before real use.
4. Go to **Settings → API** and copy your **Project URL** and **anon public** key.

## 2. Run it locally

```bash
cp .env.example .env.local
# paste your Project URL and anon key into .env.local

npm install
npm run dev
```

Open the printed local URL. Click **Staff sign in → Create staff account**
to make your first account (this is you — likely the National Commander
account). After signing up, go to Supabase's **Table Editor → team_members**,
find your row, and fill in your real name/role/initials, and set
`is_admin = true`.

Repeat "create staff account" for each teammate, or have them do it
themselves — each person owns their own login going forward.

## 3. Deploy it live (Vercel)

1. Push this project to a GitHub repo.
2. Go to [vercel.com](https://vercel.com) → New Project → import that repo.
3. In the project's **Environment Variables**, add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` with the same values from your `.env.local`.
4. Deploy. Vercel gives you a live URL (e.g. `cvoa-scheduler.vercel.app`).

## 4. Embed on your Wix site

Once it's live on a real URL:

1. In the Wix Editor, add an **Embed → Embed a Widget** (or "Custom Embeds → HTML iframe") element.
2. Point it at your Vercel URL, e.g.:
   ```html
   <iframe src="https://cvoa-scheduler.vercel.app" style="width:100%; height:800px; border:0;"></iframe>
   ```
3. Publish. If it doesn't render, check Wix's current documentation for
   iframe/embed restrictions — their editor UI changes over time, so it's
   worth double-checking their help docs rather than relying on old steps.

You can also link directly to the scheduler as its own page (no iframe) if
you'd rather send people a "Book a Call" link than embed it inline — both work.

## Project structure

```
supabase/schema.sql       All tables, security policies, and helper functions
src/lib/scheduling.js     Pure date/slot-availability logic (no network calls)
src/lib/supabaseClient.js Supabase connection
src/hooks/useAuth.js      Auth session + team_members profile
src/pages/BookingPage.jsx      Public booking flow
src/pages/ManagePage.jsx       Guest self-service reschedule/cancel
src/pages/LoginPage.jsx        Staff sign in / sign up
src/pages/TeamAvailabilityPage.jsx  Staff calendar management
src/pages/DashboardPage.jsx    Staff bookings list + waitlist
src/pages/SettingsPage.jsx     Scheduling rules, branding, audit log
```

## How the security actually works

- Every staff member signs in with their own real account (Supabase Auth).
- Anyone (including guests with no account) can **read** availability and
  event types — that's needed to compute open slots on the public page — but
  **only the owning staff member can write to their own availability rows**.
  This is enforced by Postgres Row Level Security policies, not just hidden
  buttons in the UI — so even a direct API call from outside the app would be
  rejected.
- Guest bookings are readable only by signed-in staff. Guests manage their
  *own* bookings through database functions that only ever match rows with
  their exact email — they can never browse anyone else's booking data.
- The public booking page can see enough to compute availability (dates,
  times, durations) through a dedicated function that deliberately excludes
  names, emails, and phone numbers.

## Known gaps to close before handling real veteran data at scale

- No real email/SMS sending yet — bookings save, but nobody gets notified
  automatically. This needs a Supabase Edge Function + an email/SMS provider.
- Logo upload in Settings currently isn't wired to Supabase Storage — that's
  a quick addition (create a public Storage bucket, upload the file, save
  its URL to `org_settings.logo_url`).
- The `?with=slug` personal booking link doesn't yet auto-select that person
  on the booking page — the query param needs to be read in `BookingPage.jsx`.
- Waitlist entries save, but nothing automatically notifies anyone when a
  spot opens — that logic needs to run in a database trigger or Edge Function.
