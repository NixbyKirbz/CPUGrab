# CPUGrab

**Reserve. Pick Up. Skip the Line.** A mobile-first campus food reservation PWA for Central Philippine University.

## Run locally

Use Node.js 24 LTS and npm. From this directory:

```powershell
npm ci
Copy-Item .env.example .env.local
# Fill in the Supabase project URL and publishable key in .env.local.
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Without Supabase configuration, the app displays a clearly labeled demonstration catalog. Browsing, search, filters, and the local cart work; accounts, persisted favorites, seller changes, and confirmed reservations require Supabase. Demo mode never simulates a completed database transaction.

## What’s included

- Student location browsing with horizontal stall menu previews, global debounced search, category/location/price filters, food details and favorites.
- Single-stall Zustand cart scoped to the current account, transparent centavo pricing, pickup slots, cash-at-pickup checkout, orders and private QR codes.
- Email/password accounts, verification, password recovery, seller applications, cookie session refresh and role navigation.
- Seller dashboard, optimistic image availability toggles, grayscale unavailable images, explicit menu edit mode, Storage image uploads, archive, schedules, ready/cancel actions, camera scanning and manual secure-token fallback.
- Administrator approval, stall suspension, location management, account suspension and fee configuration.
- PostgreSQL RLS, atomic reservation and QR redemption functions, idempotency, stock and slot locks, pricing snapshots, token hashes, order history and in-app notifications.
- Supabase Realtime query refreshes and reconnection handling.
- Manifest, logo-derived icons, install UI, offline fallback and saved public menus. Private pages, orders, auth responses and QR tokens never enter the service-worker cache.

## Connect Supabase

1. Create or select a Supabase project. In its Connect/API settings copy the project URL and **publishable** key into `.env.local`:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR-PUBLISHABLE-KEY
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   UNIVERSITY_EMAIL_DOMAINS=
   ```

   No service-role key is needed by the application. Never expose a secret key in a `NEXT_PUBLIC_` variable.

2. Apply the four files in `supabase/migrations` in filename order using Supabase SQL Editor, or use the official Supabase CLI:

   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR-PROJECT-REF
   npx supabase db push
   ```

   Migrations create tables, RPCs, RLS policies, the public `campus-images` bucket (5 MB, JPG/PNG/WebP), and Realtime publication entries. If your project already has tables with these names, review migrations before applying them.

3. For development only, run `supabase/seed.sql` in SQL Editor. Seed data is explicitly illustrative; stall rows retain `is_demo=true`, which keeps the demo label visible even after connection. Stock images are illustrative and not verified photos of CPU campus locations or named foods. Do not seed unverified listings into a public production launch.

4. In **Authentication → URL Configuration**, set the Site URL and allow:

   - `http://localhost:3000/auth/callback`
   - `http://localhost:3000/auth/callback?next=/reset-password`
   - Your Vercel deployment’s corresponding callback URLs.

   Enable email verification. Use a production SMTP provider for a campus rollout; development email sending is limited by Supabase. Set the configured application URL to your production URL after deployment.

5. Register and verify your first account. Bootstrap its administrator role **only in the trusted SQL Editor**:

   ```sql
   update public.user_roles
   set role = 'admin'
   where user_id = (select id from auth.users where email = 'YOUR-VERIFIED-ADMIN-EMAIL');
   ```

   No browser can assign an administrator role. Do not expose this operation through an application endpoint.

6. Use `/admin` to create verified locations. Register a seller at `/register?role=seller`, verify email, sign in, and finish `/register/stall`. Approve the application in `/admin/stalls`. The approved seller can upload a menu, add future pickup schedules, and open the stall. Students can then reserve from another account or device.

7. If testing seeded stalls, an administrator can assign one to a verified seller using SQL Editor:

   ```sql
   update public.user_roles set role='seller' where user_id='VERIFIED-USER-UUID';
   update public.stalls set owner_id='VERIFIED-USER-UUID'
   where id='00000000-0000-4000-8000-000000000020';
   ```

8. Do not assume an official university email domain. Once confirmed, configure the domains in `/admin/settings`. The database enforces the list on signup and reservation; if `UNIVERSITY_EMAIL_DOMAINS` is also set, keep it aligned. An empty list permits development accounts.

## Deploy through GitHub and Vercel

1. Create a GitHub repository and push this source, including `package-lock.json`. Keep `.env.local` excluded.
2. Import the repository into Vercel. Select the Next.js framework, Node.js 24, install command `npm ci`, and build command `npm run build`. The project root is this directory.
3. Add the same environment variables in Vercel. Set `NEXT_PUBLIC_APP_URL` to the final HTTPS URL. Rebuild after changing public environment variables.
4. Apply migrations to the production Supabase project and configure production Auth redirect URLs. Replace demonstration listings with verified campus data and approved owners.
5. Deploy and use Vercel’s returned HTTPS URL as the shareable campus address. Students and sellers use this same deployment and database.
6. Verify `/manifest.webmanifest`, `/sw.js`, authentication email links, Storage image uploads, cross-device Realtime changes, and rear camera scanning on the deployed URL. Camera access is unavailable on ordinary `http://LAN-IP` addresses; use HTTPS for phone testing.

No hosted deployment or live Supabase connection is implied by the local preview. A Vercel account/project and configured Supabase project are required to finish publication.

## Install on a phone

- Android Chrome / supported desktop: use **Install CPUGrab** in Profile or Stall Settings, or the browser’s installation menu.
- iPhone: open the HTTPS URL in Safari, tap **Share → Add to Home Screen → Add**.
- Continue using the browser normally if installation is unavailable.

Offline mode displays saved public menus, marked as potentially outdated. Reservations and pickup redemption require a successful online database call. New service workers wait for existing app windows to close; the app announces an available update without interrupting checkout.

## Verification

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Vitest runs meaningful cart/pricing tests and executes all SQL migrations and the reservation lifecycle against embedded PostgreSQL (PGlite with pgcrypto). The tests provide small stand-ins for Supabase’s `auth`/`storage` schemas. They exercise real PostgreSQL RLS and functions, but do not replace a live Supabase integration test or a multi-connection concurrency test. Playwright covers desktop and phone-sized browsing, checkout gating, manifest/cache behavior and auth configuration errors.

See [docs/TESTING.md](docs/TESTING.md) for deployment and physical-device acceptance checks and [docs/SECURITY.md](docs/SECURITY.md) for the database trust boundaries.

## Structure

- `src/app`: App Router pages, authentication endpoints, role layouts and manifest.
- `src/components`: shared controls, student views, seller workflow, administrator interface.
- `src/services`: catalog and order fetching, authenticated RPC helper.
- `src/stores/cart.ts`: account-scoped persisted cart.
- `src/lib`: Supabase clients, public demo catalog, formatting and uploads.
- `supabase/migrations`: database schema, RLS, secure RPCs and hardening.
- `supabase/seed.sql`: clearly labeled development listings and future Manila pickup slots.
- `public`: supplied branding, stock images, icons, service worker and offline fallback.

Optional background Web Push delivery is deferred; in-app notifications are implemented. `push_subscriptions` is reserved and protected for a future VAPID-backed worker. No online payment gateway or financial transfers are simulated.

Implementation follows the official [Next.js installation guide](https://nextjs.org/docs/app/getting-started/installation), [Supabase SSR client guidance](https://supabase.com/docs/guides/auth/server-side/creating-a-client), and [ZXing Browser](https://github.com/zxing-js/browser). Image sources are recorded in [docs/ASSETS.md](docs/ASSETS.md).
