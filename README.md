# 14-Day Subscription & Activation Management System

This repository now contains the starter blueprint for a subscription platform that matches the required business flow:

- Android app integration via Expo / React Native
- Supabase PostgreSQL schema with row-level security
- Supabase Edge Functions for payment approval and activation
- Admin dashboard scaffold for Vercel hosting
- Mobile helper for subscription enforcement

## Architecture

- Mobile app: Expo / React Native APK
- Backend: Supabase PostgreSQL + Edge Functions
- Admin console: Vite + React + TypeScript
- Email provider: any approved transactional provider (Resend, Postmark, SendGrid, etc.)

## Included modules

- `supabase/schema.sql` — production-ready schema for profiles, payments, codes, subscriptions, devices, settings and audit logs
- `supabase/edge-functions/approve-payment/index.ts` — admin approval and activation-code generation flow
- `supabase/edge-functions/activate-subscription/index.ts` — one-time activation and device registration
- `admin-dashboard` — starter dashboard for overview, payments, customers, devices, and subscriptions
- `mobile-subscription.ts` — mobile integration helper for the Android app

## Quick start

### 1) Supabase

Apply the SQL in `supabase/schema.sql` to your Supabase project.

### 2) Admin dashboard

```bash
cd admin-dashboard
npm install
npm run dev
```

### 3) Mobile app

Add the helper from `mobile-subscription.ts` to the app and call it from your login, activation and protected-screen gate.

## Critical rules enforced by design

- only admin users can approve payments and manage subscriptions
- activation codes are hashed before storage
- codes are redeemed once only
- new subscriptions are 14 days from activation
- early renewal extends the current expiry
- expired subscriptions automatically lose access
- customer login remains available even after expiry
- one device is allowed at a time
- admin actions are stored in audit logs

## Production note

This repository provides the architecture and implementation starter. You still need to:

- create the Supabase project and run migrations
- configure auth and email verification
- create the Vercel project and env vars
- connect the APK to the production Supabase instance
- run the acceptance test suite before release
