# Manna Environment Matrix

Generated from the actual backend source plus current local .env key names. No secret values are included.

| Environment | APP_ENV | Application DB | Prisma shadow DB | Secret location |
|---|---|---|---|---|
| Local / Development | development | Development neondb | Development manna_shadow | ignored local .env |
| Staging | staging | Staging manna_staging | none | Vercel Staging/Custom Environment |
| Production | production | Production manna_production | none | Vercel Production |

Do not create NODE_ENV=staging. Next.js controls NODE_ENV; Manna uses APP_ENV.

## Discovered variables

| Key | Category | Local .env | Source reference | Development | Staging | Production |
|---|---|---:|---:|---|---|---|
| APP_ENV | environment_identity | yes | yes | configure | configure | configure |
| APP_URL | endpoint_or_url | no | yes | configure | configure | configure |
| APPLE_OAUTH_CLIENT_ID | runtime_config | yes | no | configure | configure | configure |
| APPLE_OAUTH_KEY_ID | runtime_config | yes | no | configure | configure | configure |
| APPLE_OAUTH_PRIVATE_KEY | runtime_config | yes | no | configure | configure | configure |
| APPLE_OAUTH_TEAM_ID | runtime_config | yes | no | configure | configure | configure |
| AUTH_OTP_SECRET | secret | yes | yes | configure | configure | configure |
| BREVO_API_KEY | secret | yes | yes | configure | configure | configure |
| BREVO_NEWSLETTER_LIST_ID | runtime_config | yes | yes | configure | configure | configure |
| BREVO_SENDER_EMAIL | runtime_config | yes | no | configure | configure | configure |
| BREVO_SENDER_NAME | runtime_config | yes | no | configure | configure | configure |
| COMPANY_EMAIL | runtime_config | yes | yes | configure | configure | configure |
| CRON_SECRET | secret | yes | yes | configure | configure | configure |
| DATABASE_URL | database | yes | yes | configure | configure | configure |
| DIRECT_URL | database | yes | yes | configure | configure | configure |
| FIREBASE_CLIENT_EMAIL | runtime_config | no | yes | configure | configure | configure |
| FIREBASE_MEDIA_ROOT_FOLDER | runtime_config | yes | yes | configure | configure | configure |
| FIREBASE_PRIVATE_KEY | runtime_config | no | yes | configure | configure | configure |
| FIREBASE_PROJECT_ID | runtime_config | no | yes | configure | configure | configure |
| FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 | runtime_config | yes | yes | configure | configure | configure |
| FIREBASE_STORAGE_BUCKET | runtime_config | yes | yes | configure | configure | configure |
| FIREBASE_UPLOAD_MAX_IMAGE_MB | runtime_config | yes | no | configure | configure | configure |
| FIREBASE_UPLOAD_MAX_VIDEO_MB | runtime_config | yes | no | configure | configure | configure |
| GOOGLE_OAUTH_CLIENT_ID | runtime_config | yes | no | configure | configure | configure |
| GOOGLE_OAUTH_CLIENT_SECRET | secret | yes | no | configure | configure | configure |
| JWT_SECRET | secret | yes | yes | configure | configure | configure |
| KWIK_ACCESS_TOKEN | secret | yes | yes | configure | configure | configure |
| KWIK_BASE_URL | endpoint_or_url | yes | yes | configure | configure | configure |
| KWIK_DOMAIN_NAME | endpoint_or_url | yes | yes | configure | configure | configure |
| KWIK_EMAIL | runtime_config | yes | yes | configure | configure | configure |
| KWIK_FORM_ID | runtime_config | yes | yes | configure | configure | configure |
| KWIK_INSECURE_TLS | runtime_config | yes | yes | configure | configure | configure |
| KWIK_PASSWORD | secret | yes | yes | configure | configure | configure |
| KWIK_PAYMENT_METHOD | runtime_config | yes | yes | configure | configure | configure |
| KWIK_SAREA_ID | runtime_config | yes | yes | configure | configure | configure |
| KWIK_TEAM_ID | runtime_config | yes | yes | configure | configure | configure |
| KWIK_TIMEZONE | runtime_config | yes | yes | configure | configure | configure |
| KWIK_USER_ID | runtime_config | yes | yes | configure | configure | configure |
| KWIK_VEHICLE_ID | runtime_config | yes | yes | configure | configure | configure |
| KWIK_VEHICLE_ID_BIKE | runtime_config | yes | yes | configure | configure | configure |
| KWIK_VEHICLE_ID_SUV | runtime_config | yes | yes | configure | configure | configure |
| KWIK_VEHICLE_ID_VAN | runtime_config | yes | yes | configure | configure | configure |
| KWIK_VENDOR_ID | runtime_config | yes | yes | configure | configure | configure |
| KWIK_WEBHOOK_SECRET | secret | yes | yes | configure | configure | configure |
| MANNA_ADMIN_JWT_SECRET | secret | yes | yes | configure | configure | configure |
| MANNA_APP_ENV | runtime_config | no | yes | configure | configure | configure |
| MANNA_CONSOLE_EXECUTION_ENABLED | runtime_config | yes | yes | configure | configure | configure |
| MANNA_EMAIL_LOGO_URL | endpoint_or_url | yes | yes | configure | configure | configure |
| MANNA_WEBHOOK_SECRET | secret | yes | no | configure | configure | configure |
| NEXT_PUBLIC_APP_URL | public_build_time | yes | yes | configure | configure | configure |
| NEXT_PUBLIC_FIREBASE_API_KEY | public_build_time | yes | no | configure | configure | configure |
| NEXT_PUBLIC_FIREBASE_APP_ID | public_build_time | yes | no | configure | configure | configure |
| NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN | public_build_time | yes | no | configure | configure | configure |
| NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID | public_build_time | yes | no | configure | configure | configure |
| NEXT_PUBLIC_FIREBASE_PROJECT_ID | public_build_time | yes | no | configure | configure | configure |
| NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET | public_build_time | yes | no | configure | configure | configure |
| NEXT_PUBLIC_FIREBASE_VAPID_KEY | public_build_time | yes | no | configure | configure | configure |
| NODE_ENV | runtime_config | no | yes | configure | configure | configure |
| OAUTH_COOKIE_SECRET | secret | yes | yes | configure | configure | configure |
| PAYSTACK_MODE | runtime_config | yes | yes | configure | configure | configure |
| PAYSTACK_SECRET_KEY | runtime_config | no | yes | configure | configure | configure |
| PAYSTACK_SECRET_KEY_LIVE | runtime_config | yes | yes | configure | configure | configure |
| PAYSTACK_SECRET_KEY_TEST | runtime_config | yes | yes | configure | configure | configure |
| RECEIPT_FROM_EMAIL | runtime_config | no | yes | configure | configure | configure |
| SHADOW_DATABASE_URL | database | yes | yes | required | omit | omit |
| SMTP_FROM | runtime_config | yes | yes | configure | configure | configure |
| SMTP_HOST | endpoint_or_url | yes | yes | configure | configure | configure |
| SMTP_PASS | runtime_config | yes | yes | configure | configure | configure |
| SMTP_PORT | runtime_config | yes | yes | configure | configure | configure |
| SMTP_USER | runtime_config | yes | yes | configure | configure | configure |
| TRACKING_PUBLIC | runtime_config | yes | no | configure | configure | configure |
| WAREHOUSE_ADDRESS | runtime_config | yes | yes | configure | configure | configure |
| WAREHOUSE_LAT | runtime_config | yes | yes | configure | configure | configure |
| WAREHOUSE_LNG | runtime_config | yes | yes | configure | configure | configure |
| WAREHOUSE_PHONE | runtime_config | yes | yes | configure | configure | configure |

## Referenced by source but absent from local .env

- APP_URL
- FIREBASE_CLIENT_EMAIL
- FIREBASE_PRIVATE_KEY
- FIREBASE_PROJECT_ID
- MANNA_APP_ENV
- NODE_ENV
- PAYSTACK_SECRET_KEY
- RECEIPT_FROM_EMAIL

## Dynamic process.env access requiring review

- src/lib/brevo/transactional.ts
- src/lib/kwik/env.ts
- src/lib/media/mediaValidation.ts
- src/lib/oauth/config.ts

## Rules

- Staging must point only to manna_staging.
- Production must point only to manna_production.
- SHADOW_DATABASE_URL is Development-only.
- NEXT_PUBLIC_* values are browser-visible/build-time values; never store secrets there.
- Staging/Production secrets belong in Vercel, not Git.
