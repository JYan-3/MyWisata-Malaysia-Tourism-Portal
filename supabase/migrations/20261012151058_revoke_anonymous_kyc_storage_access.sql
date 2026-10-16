-- Emergency containment: browser/public keys must never access KYC evidence.
-- Upload, review and purge use the server-side service role.
DROP POLICY IF EXISTS anon_read_kyc_docs ON storage.objects;
DROP POLICY IF EXISTS anon_upload_kyc_docs ON storage.objects;
DROP POLICY IF EXISTS anon_update_kyc_docs ON storage.objects;
