import { revalidateTag } from 'next/cache';
import { authorizeVendor } from '@/lib/vendor-authorization';
import { apiFail, apiOk, parseBody } from '@/lib/validation/schemas';
import { productTaxonomyUpdateSchema } from '@/lib/validation/vendor-schemas';
import { isValidProductTypeSelection } from '@/lib/vendor/taxonomy';

interface Props { params: Promise<{ vendorId: string; productId: string }> }

export async function PATCH(request: Request, { params }: Props) {
  const { vendorId, productId } = await params;
  const access = await authorizeVendor(vendorId, ['vendor_owner']);
  if (!access.ok) return access.response;

  const parsed = await parseBody(request, productTaxonomyUpdateSchema);
  if (!parsed.ok) return parsed.response;

  const db = access.access.serviceDb;
  const { data: product, error: productError } = await db.from('products')
    .select('id,category_id')
    .eq('id', productId)
    .eq('vendor_id', vendorId)
    .maybeSingle();
  if (productError) return apiFail('DB_ERROR', productError.message, 500);
  if (!product) return apiFail('NOT_FOUND', 'Product not found', 404);

  const { data: category, error: categoryError } = product.category_id
    ? await db.from('categories').select('slug').eq('id', product.category_id).maybeSingle()
    : { data: null, error: null };
  if (categoryError) return apiFail('DB_ERROR', categoryError.message, 500);
  if (!isValidProductTypeSelection(category?.slug, parsed.data.typeSlugs)) {
    return apiFail('INVALID_PRODUCT_TYPES', 'One or more product types do not match the product category', 422);
  }

  const { data, error } = await db.from('products')
    .update({ type_slugs: parsed.data.typeSlugs })
    .eq('id', productId)
    .eq('vendor_id', vendorId)
    .select('id,type_slugs')
    .single();
  if (error) return apiFail('DB_ERROR', error.message, 500);

  revalidateTag('activities', { expire: 0 });
  return apiOk(data);
}
