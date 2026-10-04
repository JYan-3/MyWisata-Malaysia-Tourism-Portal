import { placeImageUrl } from '@/lib/storage/place-image';
import { vendorImageUrl } from '@/lib/storage/vendor-image';

export interface ManagedPlaceImage {
  name: string;
  imageUrl: string | null;
}

export interface OutletGalleryImage {
  url: string | null;
  alt_text?: string | null;
  media_type?: string | null;
  sort_order?: number | null;
}

interface ResolveOutletImageInput {
  outletName: string;
  outletGalleryUrl?: string | null;
  outletHeroUrl?: string | null;
  managedPlaceImages: ManagedPlaceImage[];
  outletGalleryImages?: readonly OutletGalleryImage[];
}

function normalizedName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function resolveOutletImage({ outletName, outletGalleryUrl, outletHeroUrl, managedPlaceImages, outletGalleryImages = [] }: ResolveOutletImageInput) {
  if (outletGalleryUrl?.trim()) return outletGalleryUrl;
  if (outletHeroUrl?.trim()) return outletHeroUrl;

  const galleryImage = [...outletGalleryImages]
    .filter((image) => image.url?.trim())
    .filter((image) => (image.media_type === 'gallery' || image.media_type === 'image') && image.sort_order !== -1)
    .filter((image) => !image.alt_text?.toLowerCase().includes(' logo'))
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))[0];
  if (galleryImage?.url?.trim()) return vendorImageUrl(galleryImage.url.trim()) ?? galleryImage.url.trim();

  const normalizedOutletName = normalizedName(outletName);
  const matchingPlace = managedPlaceImages.find((place) => {
    const normalizedPlaceName = normalizedName(place.name);
    return normalizedOutletName.startsWith(normalizedPlaceName) || normalizedPlaceName.startsWith(normalizedOutletName);
  });

  return placeImageUrl(matchingPlace?.imageUrl);
}
