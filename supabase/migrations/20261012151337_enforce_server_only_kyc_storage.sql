-- Defense in depth: no browser role may access KYC objects, even if an
-- unrelated permissive storage policy matches. Service-role flows bypass RLS.
CREATE POLICY kyc_documents_server_only ON storage.objects
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (bucket_id <> 'kyc-documents')
WITH CHECK (bucket_id <> 'kyc-documents');
