-- The private recommendation-images bucket had no size or type limit, so anything
-- uploaded with the service key bypassing /api/recommendations/images was unbounded.
-- Match the route's own rule (lib/recommendations/submission.ts): JPEG, PNG or WebP,
-- 5 MB at most. Existing objects are all JPEG under 0.5 MB, so none fall outside it.
update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'recommendation-images';
