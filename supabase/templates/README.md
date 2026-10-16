# Recipient-language Auth mail

Native Supabase templates use only `auth.users.user_metadata.preferred_locale`, projected from the existing saved profile preference by the recipient-email-locale migration. Missing/unsupported preferences select English. Three locales are rendered locally by Supabase, with existing OTP and confirmation URL variables. No role or authorization decision uses this metadata.

Hosted templates must be deployed separately from Next.js. `node scripts/sync-auth-email-templates.mjs` performs a read-only comparison; it requires a server-side `SUPABASE_ACCESS_TOKEN`. `AUTH_EMAIL_TEMPLATE_WRITE=1 node scripts/sync-auth-email-templates.mjs --write` backs up only existing template/subject fields before a verified update. It never changes SMTP credentials, Auth URLs, access policies or notification-enabled settings. Review the existing live link/OTP behavior before using --write; local source files alone do not change hosted mail.
