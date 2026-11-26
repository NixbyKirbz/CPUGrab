# Current deployment

- Live application: https://cpugrab.vercel.app
- Repository: https://github.com/NixbyKirbz/CPUGrab
- Vercel project: `cpugrab` (`prj_XOl4nUKnESkDijEqAvx3mCsh30Wf`)
- Supabase project: `CPUGrab`, `elyhudnmywupetxethay`, Tokyo region.
- Supabase API: https://elyhudnmywupetxethay.supabase.co

GitHub main is connected to Vercel. New commits trigger deployment. Public Supabase variables are configured on Vercel; no database password or service-role key is present in the app or repository.

The Supabase production Site URL is `https://cpugrab.vercel.app`. Allowed callbacks are the production and localhost `/auth/callback` URLs and their `?next=/reset-password` variants. Review these when adding a custom domain.

A private, one-time invitation has been configured for the administrator address supplied by the project owner. Register and verify that address through the app, then sign in. The database promotes only that verified account and consumes the invitation. The address is not committed in this repository.

All seeded campus data and photos are illustrative and labeled. Demo stalls have no real owner until an administrator assigns one. Approved new sellers can add their actual menu, pickup slots, and open their stall. Replace demo content before a campus launch.

Physical phone camera, installed PWA, cross-device Realtime, email delivery and true multi-connection race acceptance tests remain on the checklist in TESTING.md. Optional background Web Push and online payments are not enabled.
