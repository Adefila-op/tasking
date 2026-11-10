# Deployment plan

## 1. Supabase

1. Create a new Supabase project.
2. Apply the SQL in `supabase/schema.sql`.
3. Create the Edge Functions under `supabase/edge-functions/approve-payment` and `supabase/edge-functions/activate-subscription`.
4. Protect secrets in the Supabase dashboard. Never expose the service-role key in the APK.
5. Configure the auth providers for email sign-in and email verification.

## 2. Admin dashboard

```bash
cd admin-dashboard
npm install
npm run dev
```

For Vercel deployment:

```bash
vercel --prod
```

Set the following env vars:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## 3. Mobile app integration

Use the helper at `mobile-subscription.ts` to:

- sign in or register the device,
- submit payment proof,
- redeem activation code,
- fetch current subscription state,
- refuse access if the subscription has expired or the device is unauthorized.

## 4. Production hardening

- use RLS everywhere,
- require admin checks in server-side functions,
- rate-limit activation attempts,
- record audit logs for every payment review and activation,
- enforce single-device access,
- block suspended or revoked subscriptions from protected app screens.

## 5. Acceptance testing checklist

- registration and email verification
- pending payment -> approval -> activation code creation
- invalid code fails
- duplicate approval rejected
- 14-day exact expiry behavior
- early renewal extends expiry
- second device blocked
- expired accounts lose protected access while still retaining login access
- admin-only actions protected
- audit trail retained for all sensitive actions
