# Recipient-language email design and rollout plan

Status: Implementation and local verification complete; uncommitted on feature/event-part. Production rollout and inbox acceptance pending.
Workspace: /Users/tanzhengyang/Documents/GitHub/MyWisata-Malaysia-Tourism-Portal
Branch: feature/event-part

## Context and approved policy

Every recipient, including Admin, Customer, Vendor, Guest and first-time users, receives system mail in their own explicitly selected supported language. Use English only when no valid preference exists. Supported languages remain en, zh-CN and ms. The sender/admin/browser acting for another person must not choose that recipient's language.

The inventory confirms Staff invitations already resolve recipient preference. General business templates, exception reasons, KYC security copy and order/PDF receipts are English. Signup does not supply locale metadata. Supabase Auth templates are separately configured; their production configuration has not been inspected or changed in this task.

## Reuse Decisions — Reuse audit complete

| Exact candidate | Decision and purpose |
| --- | --- |
| lib/i18n/locale.ts | Reuse AppLocale validation and English default; email must not infer preference from the sender's browser. |
| app/api/locale/route.ts | Extend the existing preference-save path for Auth-mail locale projection; retain public.users.preferred_locale as account authority. |
| lib/staff-invitations/route-helpers.ts | Reuse recipient-owned lookup and fallback behavior, preserving governed preparation and permissions. |
| lib/email/templates.ts | Extend existing renderers with three-language system copy, subject, HTML, plain text, actions and dates. |
| lib/email/events.ts and lib/email/outbox.ts | Extend existing recipient lookup and durable payload with validated locale; preserve leases, deduplication, unknown-delivery quarantine and retry limits. |
| lib/email/order-receipt.ts and lib/pdf/receipt.ts | Extend existing receipt rendering; add a licensed CJK-capable embedded font and render verification. |
| lib/checkout/subject.ts, app/api/checkout/prepare/route.ts, app/api/customer/event-reservations/route.ts | Extend existing checkout context to retain Guest's explicit selected locale before payment/notification triggers. |
| lib/wallet/approver-notifications.ts | Extend existing per-recipient fanout; different admins can receive different languages for the same event. |
| supabase/migrations/20261012013400_event_exception_vendor_notices.sql, 20261007034901_event_vendor_change_notices.sql and 20261002004603_guest_order_access.sql | Read-only source references for a new forward migration; preserve scope, event keys, financial phases and access tokens. Do not edit or replay applied migrations. |
| components/admin/ai-draft-email-modal.tsx, app/api/admin/vendors/{recommendation-invite,[id]/approval-email}/draft/route.ts, app/i18n/locales/{en,zh-CN,ms}/admin.json | Extend existing reviewed draft workflow with recipient email, language lookup and translated guidance. Preserve edits when destination changes; lookup alone never calls AI. |
| lib/wallet/withdrawal-review-projection.ts | Extend the existing redacted snapshot formatter with recipient-language labels and known status terms; preserve default English for existing in-App notifications and preserve masking. |
| New SMTP service, new preference column on users, or AI translation of private mail | Reject: an SMTP adapter, user preference field and locale validator already exist; private transactional content does not need an external AI service. |

## Design and value of additional data

1. `locale` on each email intent: snapshot the recipient's explicit preference when enqueued and keep it stable through retries. Existing pending legacy records without locale resolve the recipient preference once before their first send; already-sent or unknown-delivery records are never resent for localization.
2. Guest order contact locale: retain the explicit language selected at checkout so asynchronous payment callbacks, refunds and later recovery mail do not depend on an absent browser cookie. Unsupported/unselected values use English; do not infer from email address or name.
3. Structured reason/event code and safe interpolation fields: translate system-generated exception phases and default labels locally instead of persisting only English prose. Preserve product/business names and user-authored evidence verbatim; never claim that arbitrary manually authored prose was automatically translated.
4. Auth mail language projection: register first-time users with the selected locale in Auth metadata; keep the projection synchronized with the saved account preference. Native Supabase templates use conditional `.Data` locale values. Metadata remains presentation-only and cannot grant roles or access. Handle synchronization failure explicitly rather than reporting a completed preference save with mismatched Auth language. Existing account preferences require a controlled reconciliation before claiming Auth-mail coverage.
5. Full receipt localization: localize email and PDF labels, dates and defaults together; embed an approved CJK font so Chinese names and labels remain legible. Currency stays MYR and time zone stays Asia/Kuala_Lumpur.
6. Admin-reviewed custom Vendor outreach: retain the existing review/send workflow; expose and use the recipient target language for fixed draft/CTA copy, preserve the admin's edited prose, and make any unsupported/untranslated manual content explicit. Do not send private order/contact content to AI for translation.

## Ordered phases and affected functions

1. Recipient locale and queue contract: extend enqueueEmail/processEmailOutbox, user event helpers, Staff invitation delivery and per-admin fanout. Cover missing/invalid preferences, mixed-language recipients, stable retry locale and legacy pending rows.
2. Business copy: extend renderTransactionEmail/renderAccountEmail/renderRecommendationEmail/renderVendorEmail/renderEventVendorEmail/renderKycSecurityEmail and sender input types. Cover en/zh-CN/ms subjects, HTML/text parity and field interpolation; preserve escaping and privacy safeguards.
3. Guest and database-generated notices: extend resolveCheckoutSubject/CheckoutBuyer and both checkout routes; add a forward migration generated with the Supabase CLI under the name recipient_email_locale. Actual CLI-generated path: supabase/migrations/20261014143818_recipient_email_locale.sql. Extend queue_guest_order_access and scoped event notice producers to snapshot locale and structured system reason fields without changing financial/pickup decisions.
4. Receipts: extend sendOrderReceiptEmail, generateReceiptPdf and app/api/orders/receipt/route.ts. Include a licensed static CJK font asset and its license, with PDF text/render acceptance.
5. Auth and custom mail: extend app/login/page.tsx, app/staff-invitations/[token]/page.tsx, app/outlet-manager-invitations/[token]/page.tsx and app/api/locale/route.ts. Version the native Auth template content under supabase/templates/ and inspect/backup live templates before any production edit. Inventory/reset/password/security mail coverage explicitly. Extend the existing custom Vendor invitation draft/send paths for recipient target language; do not silently rewrite approved prose.
6. Verification and rollout: one bounded luna_worker privacy/recipient-scope review, affected tests, lint, TypeScript and i18n checks. Validate one same-event multi-recipient language split, first signup in Chinese, no-preference English, Guest delayed callback, retry consistency and Chinese PDF rendering. Deploy only after the code/config changes are reviewable and authorized; real inbox acceptance uses synthetic content and the user-approved test mailbox.

## Boundaries, dependencies and risks

No changes to roles, purchase eligibility, stock quantities, reservation/access durations, Reward, Affiliate, KYC eligibility, Withdrawal decisions or payment/refund amounts. Existing SMTP security, lease protocol, event-key idempotence and recipient/outlet scope remain intact. No new mail provider or translation API. A licensed CJK font asset is required; preserve license and provenance. A forward database migration and separate hosted Auth template rollout are required; neither has been performed by this planning task.

Do not describe manual free-text translation, hosted Auth rollout, old sent mail or language inbox acceptance as completed before each is separately verified. Hostinger's outstanding inability to remove two Node Cron entries remains a separate operational issue.

## Evidence

- Read-only independent luna_worker locale audit: ordinary mail is not localized; Staff invitation preference/fallback tests are covered; 5 focused files / 28 tests passed in that audit.
- Supabase native language template guidance: https://supabase.com/docs/guides/troubleshooting/customizing-emails-by-language-KZ_38Q
- Native hosted template management and available Auth variables: https://supabase.com/docs/guides/auth/auth-email-templates
- Read Next.js bundled cookies documentation before designing Guest locale capture.
- No implementation, production configuration, database update or email send was performed during this planning task.

## Execution notes

The event checkout path referenced by an old source comment does not exist; repository search located app/api/customer/event-reservations/route.ts. Checkout locale capture is centralized in lib/checkout/subject.ts so both existing routes reuse it. Auth language is projected atomically by a private database trigger on the existing preference save, rather than introducing a two-phase API write.


### Additional implementation evidence

- Reproduced auth/profile deadlock (40P01) under concurrent locale save and email verification in isolated loopback PostgreSQL. The self-only authenticated `set_my_preferred_locale` RPC now locks Auth before profile, matching verification. Anonymous access and invalid locales are denied; no user-id argument, role change or third-party update is exposed. Concurrent GREEN confirmed.
- Guest contact carries locale; registered-user contact retains its original field contract and database account preference remains authoritative.
- English/Chinese/Malay PDF samples rendered and visually checked; Chinese names are extractable in all three. Malay wrapped table headers now reserve their full height.
- Native Auth template files and safe compare/backup/update operator script are prepared. Production confirmation template was inspected read-only and still contains the English ConfirmationURL flow. No Management token is configured locally; a logged-in dashboard is available. No production template write, schema migration, deploy or language test email has been performed in this implementation.
- Final read-only luna_worker review requested; full suite initially found one account-contact contract mismatch, now corrected and focused regression passed. Lint: 0 errors / 93 existing warnings; i18n: three-locale coverage complete. Final verification results recorded after checks complete.


## Final verification and handoff

- Vitest: 1100 files passed, 12 skipped; 5092 tests passed, 42 skipped.
- TypeScript: npx tsc --noEmit passed. Next production build passed; receipt route trace includes the local Noto CJK font.
- ESLint: 0 errors, 93 pre-existing warnings. i18n coverage/default-values/lint/status passed in en/zh-CN/ms.
- Loopback PostgreSQL: signup initialization, existing metadata reconciliation, per-recipient locale, stable retries, both Guest checkout paths, exception reason code, private ACL, self-only locale RPC, invalid/anonymous denial, concurrent verification/save all passed. Database dropped after each run.
- Native Auth operator script: two Node tests passed; no SMTP secret printed/backed up, no provider/notification flags changed.
- Three synthetic receipt PDFs rendered/extracted and visually checked; no clipped Chinese names or overlapping Malay headers.
- One bounded final luna_worker review completed. No confirmed new security/privacy/auth/core-flow blockers. Existing AI draft fields and synchronous custom-outreach SMTP recovery were compared against a5f15fc and classified as pre-existing follow-ups, unchanged by this localization work. System transaction content uses local copy, not AI translation.
- Production wrapper preflight read-only: both Guest wrappers match the guarded migration marker, have p_contact, deny anon/authenticated execution and retain service-only ACL.

## Required rollout order (not executed)

1. Review/commit and CI this branch; do not rewrite existing history.
2. Apply forward migration 20261014143818_recipient_email_locale.sql before deploying the new locale API; otherwise authenticated language saves will fail because the self-only RPC is absent.
3. Back up and update native Supabase Auth templates/subjects separately, preserving installed confirmation/redirect flow and all SMTP/security flags. The operator script defaults to read-only; dashboard configuration is separately hosted.
4. Deploy app including traced CJK font. Use synthetic data for first signup Chinese, missing-preference English, per-recipient Admin/Vendor languages, Guest delayed callback and receipt inbox checks. No actual production email was sent by this implementation.
5. Keep unrelated Hostinger two-Node-Cron cleanup tracked separately; it is not resolved by language localization.

## Existing follow-ups outside this change

- Existing Admin AI draft context can benefit from a stricter allowlist/sensitive-value boundary; this change adds only a validated language label and no new AI-bound data fields.
- Existing manually reviewed Admin outreach sends SMTP synchronously and is not covered by the transaction Outbox recovery protocol. No retries or extra sends were introduced here; a separate reviewed recovery change is needed.

## Exact changed file inventory

- `app/api/admin/vendors/[id]/approval-email/draft/__tests__/route.test.ts`
- `app/api/admin/vendors/[id]/approval-email/draft/route.ts`
- `app/api/admin/vendors/[id]/approval-email/route.ts`
- `app/api/admin/vendors/event-invite/route.ts`
- `app/api/admin/vendors/recommendation-invite/__tests__/route.test.ts`
- `app/api/admin/vendors/recommendation-invite/draft/__tests__/route.test.ts`
- `app/api/admin/vendors/recommendation-invite/draft/route.ts`
- `app/api/admin/vendors/recommendation-invite/route.ts`
- `app/api/guest/__tests__/checkout.test.ts`
- `app/api/locale/__tests__/route.test.ts`
- `app/api/locale/route.ts`
- `app/api/orders/receipt/route.ts`
- `app/i18n/locales/en/admin.json`
- `app/i18n/locales/ms/admin.json`
- `app/i18n/locales/zh-CN/admin.json`
- `app/login/page.tsx`
- `app/outlet-manager-invitations/[token]/page.tsx`
- `app/staff-invitations/[token]/page.tsx`
- `components/admin/__tests__/ai-draft-email-modal.contract.test.ts`
- `components/admin/ai-draft-email-modal.tsx`
- `lib/auth/__tests__/signup-email-language.test.ts`
- `lib/checkout/subject.ts`
- `lib/email/__tests__/auth-templates.test.ts`
- `lib/email/__tests__/custom-recipient-language.test.ts`
- `lib/email/__tests__/delivery-recovery.test.ts`
- `lib/email/__tests__/locale.test.ts`
- `lib/email/__tests__/receipt-language.test.ts`
- `lib/email/__tests__/recipient-language.test.ts`
- `lib/email/copy.ts`
- `lib/email/events.ts`
- `lib/email/locale.ts`
- `lib/email/order-receipt.ts`
- `lib/email/outbox.ts`
- `lib/email/sender.ts`
- `lib/email/templates.ts`
- `lib/pdf/__tests__/receipt-language.test.ts`
- `lib/pdf/fonts/NotoSansCJKsc-Regular.otf`
- `lib/pdf/fonts/OFL.txt`
- `lib/pdf/fonts/README.md`
- `lib/pdf/receipt.ts`
- `lib/recommendations/invite-draft.ts`
- `lib/staff-invitations/__tests__/route-helpers.test.ts`
- `lib/staff-invitations/route-helpers.ts`
- `lib/vendors/approval-draft.ts`
- `lib/wallet/__tests__/withdrawal-review-projection.test.ts`
- `lib/wallet/approver-notifications.ts`
- `lib/wallet/withdrawal-review-projection.ts`
- `next.config.ts`
- `scripts/sync-auth-email-templates.mjs`
- `scripts/sync-auth-email-templates.test.mjs`
- `scripts/test-recipient-email-db.mjs`
- `supabase/migrations/20261014143818_recipient_email_locale.sql`
- `supabase/migrations/__tests__/canonical-history.test.ts`
- `supabase/templates/README.md`
- `supabase/templates/confirmation.html`
- `supabase/templates/email_change.html`
- `supabase/templates/email_changed_notification.html`
- `supabase/templates/identity_linked_notification.html`
- `supabase/templates/identity_unlinked_notification.html`
- `supabase/templates/invite.html`
- `supabase/templates/magic_link.html`
- `supabase/templates/manifest.json`
- `supabase/templates/mfa_factor_enrolled_notification.html`
- `supabase/templates/mfa_factor_unenrolled_notification.html`
- `supabase/templates/password_changed_notification.html`
- `supabase/templates/phone_changed_notification.html`
- `supabase/templates/reauthentication.html`
- `supabase/templates/recovery.html`
