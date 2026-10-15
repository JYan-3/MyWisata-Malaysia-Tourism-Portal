// Paid digital downloads live in a private bucket with no storage policies, so
// only the service role (the paid-order download route) can read them.
// Migration: supabase/migrations/20261012180000_private_digital_assets_bucket.sql

export const DIGITAL_ASSET_BUCKET = 'vendor-digital-assets';

/**
 * The URL stored in products.digital_asset_url. It names the object but is not
 * publicly fetchable, so it is safe for the column to be readable by anyone.
 */
export function digitalAssetUrl(supabaseUrl: string, objectPath: string): string {
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/authenticated/${DIGITAL_ASSET_BUCKET}/${objectPath}`;
}

/**
 * The object path to serve for a product, or null when the stored URL does not
 * point into the private bucket under the selling vendor's own folder. The
 * download route uses the service role, so it must never follow a URL into any
 * other bucket (KYC, vendor documents, chat attachments) or another vendor's files.
 */
export function digitalAssetObjectPath(storedUrl: string, vendorId: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(storedUrl).pathname;
  } catch {
    return null;
  }
  const match = pathname.match(/^\/storage\/v1\/object\/(?:authenticated|sign|public)\/([^/]+)\/(.+)$/);
  if (!match || match[1] !== DIGITAL_ASSET_BUCKET) return null;
  let objectPath: string;
  try {
    objectPath = decodeURIComponent(match[2]);
  } catch {
    return null;
  }
  const segments = objectPath.split('/');
  if (segments[0] !== vendorId || segments.length < 2 || segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null;
  return objectPath;
}
