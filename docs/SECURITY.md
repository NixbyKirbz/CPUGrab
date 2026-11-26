# Database security model

Supabase’s publishable key is public by design. It only grants access allowed by PostgreSQL privileges and Row Level Security. No service-role key is used by the Next.js application.

- Every exposed application table has RLS. Users cannot directly insert or update orders, order items, pickup tokens, roles, status history, or notification messages.
- Signup creates a student role. The caller can request a pending seller application, but never choose administrator privileges or approve a stall. Seller access is limited to approved, assigned stalls. Suspended profiles fail protected operations immediately, even if an existing JWT has not expired.
- Profiles expose only the current profile (or administrator access). Profile column grants exclude suspension. Menu/stall column grants exclude ownership, membership and approval fields.
- Reservation functions verify the student, approved/open stall and active location, then lock the slot and menu rows in a stable order. Prices and fees are computed from database values in integer centavos. Repeated requests with the same student/idempotency UUID return the original order.
- Existing reservation pricing is immutable to clients. Cancellation restores stock once and frees capacity by removing the reservation from the active slot count.
- QR secrets are 32 random bytes. Only SHA-256 hashes are persisted. An order owner can issue a fresh token; doing so invalidates the previous token. Raw tokens are held in component memory, never URL parameters, persisted local state or shared caches.
- Redemption locks the order and token, verifies the assigned stall and pickup window (15 minutes before slot start through two hours after its end), requires cash acknowledgment for an unpaid order, records completion, consumes the token, and posts the student notification in one transaction. Direct completion by order number is unsupported.
- Student cancellation requires reserved/unpaid status and more than 15 minutes before the pickup starts. Sellers can cancel eligible reserved or ready unpaid orders with a reason. Paid reservations require a future explicit refund workflow and cannot be cancelled through this MVP.
- Security-definer functions use an empty `search_path`, qualify references, revoke default execution rights, and grant only intended RPCs.
- Storage is a public **image-only** bucket with a 5 MB limit. Authenticated uploads must use the caller’s UUID folder. No order data or pickup secrets are uploaded. Images are user-supplied; replace seeded stock images with verified photographs before launch.
- Service worker caches public assets only. The separately persisted catalog contains approved public locations, stalls, menus, categories and fee settings, with a saved-at timestamp. Auth sessions use Supabase SSR cookies; orders and tokens are never placed in Cache Storage. Browser-local cart persistence is scoped and cleared when switching accounts, but it contains only public food data and quantities.

Before campus rollout, run the live RLS and multi-session tests in TESTING.md, configure Auth rate limits and SMTP, confirm actual email domains, and audit administrator bootstrap access. The embedded PostgreSQL test harness verifies SQL behavior without making a claim about production Supabase configuration.
