# Kofix Photography Studio — Promo Booking App
Static site (`public/`) + one Netlify Function (`netlify/functions/api.js`) + Supabase Postgres.
Browsers never talk to the database; the secret key lives only in Netlify env vars.

## Setup
1. **Supabase**: create a project → SQL Editor → run `supabase/schema.sql`, then `supabase/tests.sql` (should print ALL TESTS PASSED).
2. **GitHub**: push this folder to a new repo.
3. **Netlify**: Add new site → Import from GitHub. Build command empty, publish dir `public` (already in netlify.toml).
4. Netlify → Site settings → Environment variables: add everything in `.env.example` (at minimum SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_PASSWORD, ADMIN_TOKEN_SECRET). Redeploy.
5. Open `/admin.html`, log in, go to **Packages → Import flyer packages**, then **Settings** to set the confirmation rule, deposit and payment instructions.

## How slots work
- A customer submission creates a **pending** request; it uses no slot.
- When you click **Confirm**, the database locks that package, checks your payment rule, and gives the lowest free number 1–6. A unique index makes duplicate numbers impossible.
- Cancel/Refund frees the slot. At 6 confirmed, that package alone shows PROMO FULL and refuses new requests.
- New packages added in the dashboard get their own six slots automatically (no hardcoded list).

## Notifications
- Dashboard: new-booking toast + count (checks every 20s while open).
- WhatsApp: the customer's prefilled message goes to https://wa.me/233534349054. This cannot verify that they sent it. Automatic WhatsApp alerts would need an authorised WhatsApp Business API provider (not configured).
- Email: optional via Resend; nothing is sent unless RESEND_API_KEY and NOTIFY_EMAIL are set.
