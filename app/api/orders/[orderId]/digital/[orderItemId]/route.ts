import { authorizeOrder } from '@/lib/checkout/order-access';
import { createServiceClient } from '@/lib/supabase/service';
import { apiFail } from '@/lib/validation/schemas';
import { guestPrivateResponse } from '@/lib/checkout/guest-session';

interface Props { params: Promise<{ orderId: string; orderItemId: string }> }

export async function GET(request: Request, { params }: Props) {
  const { orderId, orderItemId } = await params;
  const access = await authorizeOrder(request,orderId);
  if (!access) return apiFail('NOT_FOUND','Order not found',404);
  const service = createServiceClient();
  const { data: item } = await service.from('order_items').select('id,product_id,products(product_type,digital_asset_url,digital_asset_name)').eq('id', orderItemId).eq('order_id', orderId).maybeSingle();
  const order = access.order;
  if (!item || !order || order.status !== 'paid') return apiFail('NOT_FOUND', 'Digital entitlement not found', 404);
  const product = Array.isArray(item.products) ? item.products[0] : item.products;
  if (!product || product.product_type !== 'digital' || !product.digital_asset_url) return apiFail('NOT_FOUND', 'This item is not a secure digital download', 404);
  let assetPath: string;
  try { assetPath = new URL(product.digital_asset_url).pathname; } catch { return apiFail('NOT_CONFIGURED', 'Digital asset configuration is invalid', 409); }
  const match = assetPath.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)$/);
  if (!match) return apiFail('NOT_CONFIGURED', 'This digital asset is not stored in a private Supabase bucket yet', 409);
  if (new URL(request.url).searchParams.get('download') !== '1') return guestPrivateResponse({ url: `/api/orders/${orderId}/digital/${orderItemId}?download=1`, filename: product.digital_asset_name ?? 'download' });
  const downloaded = await service.storage.from(match[1]).download(decodeURIComponent(match[2]));
  if (downloaded.error || !downloaded.data) return apiFail('DOWNLOAD_FAILED','Unable to download this file',502);
  const filename = String(product.digital_asset_name ?? 'download').replace(/[\r\n"\\]/g,'_');
  return new Response(downloaded.data,{ headers: { 'Content-Type': 'application/octet-stream','Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff' } });
}
