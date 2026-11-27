# CPUGrab implementation plan and progress

The empty workspace was inspected before implementation. The five supplied images establish the actual CPUGrab logo, navy/gold branding, student browse → reserve → QR flow, and seller availability/edit/scan flows. The application uses React components rather than interface screenshots. Location and food photography is illustrative stock photography; the official logo and banner are preserved.

1. Foundation: Next.js App Router, TypeScript, Tailwind, shared components, Supabase SSR sessions, registration and role guards.
2. Browsing: locations, horizontal previews, search and filters, stall menus, item details, favorites.
3. Reservations: scoped Zustand cart, live pickup slots, backend pricing and capacity validation, simulated GCash and CPUGrab Wallet payments, refunds to the original method, and rotating pickup QR tokens.
4. Seller: approval workflow, availability grid with optimistic rollback, edit mode, uploads, archive, stall settings and schedules.
5. Pickup: pending/ready/cancelled/completed views, browser camera and manual token fallback, and atomic redemption for paid orders.
6. Administrator: approval and suspension, locations, account access, fee settings, realtime invalidation and notifications.
7. PWA: manifest, logo-derived icons, install UI, offline public menu data, static cache, private data exclusions, update notification.
8. Verification: typecheck, lint, production build, unit tests, database operation tests and browser workflow tests. Live Supabase and physical-device checks must be completed after configuration.

No service credentials are embedded. An unconfigured checkout is a labeled public catalog preview. Sign-in, reservations and simulated payments require a configured Supabase project.

Optional web push delivery is not enabled. In-app notifications are persisted in Supabase and refreshed through Realtime. The schema reserves a protected subscription table for a future VAPID-backed push worker.
