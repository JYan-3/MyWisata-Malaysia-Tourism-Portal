-- Public object URLs remain readable. Limit authenticated Storage API metadata
-- reads without allowing callers to enumerate any public bucket's objects.
ALTER POLICY avatar_select_public ON storage.objects
  USING (
    bucket_id = 'avatars'
    AND storage.allow_any_operation(ARRAY[
      'object.get_authenticated_info',
      'object.get_authenticated'
    ])
  );

ALTER POLICY event_posters_public_read ON storage.objects
  USING (
    bucket_id = 'event-posters'
    AND storage.allow_any_operation(ARRAY[
      'object.get_authenticated_info',
      'object.get_authenticated'
    ])
  );

ALTER POLICY place_images_public_read ON storage.objects
  USING (
    bucket_id = 'place-images'
    AND storage.allow_any_operation(ARRAY[
      'object.get_authenticated_info',
      'object.get_authenticated'
    ])
  );

ALTER POLICY product_images_public_read ON storage.objects
  USING (
    bucket_id = 'product-images'
    AND storage.allow_any_operation(ARRAY[
      'object.get_authenticated_info',
      'object.get_authenticated'
    ])
  );

ALTER POLICY vendor_images_public_read ON storage.objects
  USING (
    bucket_id = 'vendor-images'
    AND storage.allow_any_operation(ARRAY[
      'object.get_authenticated_info',
      'object.get_authenticated'
    ])
  );

ALTER POLICY vendor_products_public_read ON storage.objects
  USING (
    bucket_id = 'vendor-products'
    AND storage.allow_any_operation(ARRAY[
      'object.get_authenticated_info',
      'object.get_authenticated'
    ])
  );
