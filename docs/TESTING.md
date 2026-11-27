# Acceptance testing

Automated local checks cover TypeScript, ESLint, production compilation, pricing/cart behavior, actual SQL migrations and reservation lifecycle in embedded PostgreSQL, plus Playwright desktop and mobile-sized browsing.

## Live Supabase

Use separate verified student A, student B, seller A, seller B and administrator accounts. Use an isolated staging project with disposable development data.

1. Register and verify student/seller emails; exercise sign in, recovery, session persistence and logout. A requested seller is pending until the administrator approves the stall.
2. Call Supabase directly using each user's JWT. Student A cannot read student B's orders, raw token table, or update role/fees/status/payment. Seller B cannot edit seller A's menu, slots or stall. Suspended accounts cannot reserve, manage menus or redeem tokens.
3. Create a future slot with capacity one. Submit reservations from two independently authenticated connections at the same time. Exactly one must commit. Repeat with stock quantity one. Inspect orders, order items, stock and status history for consistency. PGlite is single-connection and does not establish this live concurrency result.
4. Repeat one reservation with the same idempotency UUID from two connections. Exactly one order should exist. Retry after a deliberately interrupted response using the same key.
5. Toggle a food photo and change a price from seller A. An open student device must refresh immediately. Disconnect during a write and verify rollback/error feedback.
6. Create a reservation. Verify pending order on seller A, readiness notification on student A, cancellation reason propagation, slot release and stock restoration once.
7. Rotate a QR. The older token must fail. Seller B's scanner must reject seller A's token. A completed/cancelled/expired token must fail. Redeem one paid token simultaneously twice and verify only one transaction completes.
8. Verify future slot filtering and Asia/Manila pickup boundaries. Close/suspend a stall or deactivate its location and check that new reservations are rejected.
9. Upload valid image formats and reject oversized/unsupported files. Attempt another user's Storage folder. Confirm bucket configuration and object policies.
10. Cash in from Student Home and checkout. Verify the balance after reload, pay once by each method, and cancel eligible orders. A wallet refund restores the wallet balance. A simulated GCash refund leaves it unchanged.

## Physical Android and iPhone

These checks require real devices; desktop emulation cannot establish them.

- Install from Android Chrome, iOS Safari Share menu, and supported desktop browser. Verify standalone mode, icons, safe-area navigation and home-screen launch.
- Allow and deny rear-camera access. Test manual token fallback and confirm the camera indicator turns off after navigation, completion or cancellation.
- Scan a student’s QR from a second phone. Test repeat scans, cross-stall scanning and prepaid pickup.
- Load a public menu, switch to airplane mode, reload, and inspect the saved public listings with the timestamp. Confirm reservations and pickups cannot complete offline. Confirm auth responses, private order pages and QR tokens are absent from Cache Storage.
- Deploy a new version while checkout is open. Confirm update notice, no forced refresh, and activation after closing existing app windows.
- Check small screens, reduced motion, keyboard focus, screen reader labels, swipeable food previews and safe-area bottom navigation.

In-app Realtime notifications are supported. CPUGrab Wallet and GCash payments use simulated credits and transactions.
