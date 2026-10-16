-- Paid digital downloads (PDF/ZIP) get their own private bucket.
--
-- They used to be uploaded to the public 'vendor-products' bucket, so anyone
-- holding the URL could download a paid file, and products.digital_asset_url is
-- readable by anonymous visitors. This bucket is private with no storage
-- policies at all: only the service role (the paid-order download route) can
-- read it, so a leaked URL is useless.
--
-- Path convention: {vendor_id}/{product_id | draft-<user_id>}/{uuid}-{name}.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vendor-digital-assets', 'vendor-digital-assets', false, 10485760, array['application/pdf', 'application/zip'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The public product bucket goes back to images only, so a PDF/ZIP can no
-- longer be placed where anyone can fetch it. It held no PDF/ZIP objects when
-- this ran.
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'vendor-products';
