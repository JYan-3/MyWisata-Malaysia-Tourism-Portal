import { describe, expect, it } from 'vitest';
import { DIGITAL_ASSET_BUCKET, digitalAssetObjectPath, digitalAssetUrl } from '@/lib/vendor/digital-assets';

const SUPABASE = 'https://project.supabase.co';
const VENDOR = '11111111-1111-4111-8111-111111111111';
const OTHER_VENDOR = '22222222-2222-4222-8222-222222222222';

describe('digital asset storage paths', () => {
  it('round-trips a file the vendor uploaded to the private bucket', () => {
    const path = `${VENDOR}/product-1/abc-guide.pdf`;
    const url = digitalAssetUrl(SUPABASE, path);

    expect(url).toBe(`${SUPABASE}/storage/v1/object/authenticated/${DIGITAL_ASSET_BUCKET}/${path}`);
    expect(digitalAssetObjectPath(url, VENDOR)).toBe(path);
  });

  it('refuses any other bucket, so the service-role download cannot be pointed at private files', () => {
    for (const bucket of ['kyc-documents', 'vendor-documents', 'chat-attachments', 'vendor-products']) {
      expect(digitalAssetObjectPath(`${SUPABASE}/storage/v1/object/public/${bucket}/${VENDOR}/x.pdf`, VENDOR), bucket).toBeNull();
    }
  });

  it("refuses another vendor's files and path tricks", () => {
    const base = `${SUPABASE}/storage/v1/object/authenticated/${DIGITAL_ASSET_BUCKET}`;
    expect(digitalAssetObjectPath(`${base}/${OTHER_VENDOR}/p/x.pdf`, VENDOR)).toBeNull();
    expect(digitalAssetObjectPath(`${base}/${VENDOR}/..%2F${OTHER_VENDOR}/x.pdf`, VENDOR)).toBeNull();
    expect(digitalAssetObjectPath(`${base}/${VENDOR}`, VENDOR)).toBeNull();
    expect(digitalAssetObjectPath('https://drive.example/file.pdf', VENDOR)).toBeNull();
    expect(digitalAssetObjectPath('not a url', VENDOR)).toBeNull();
  });
});
