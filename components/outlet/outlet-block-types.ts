import type { GalleryItem, OutletPageBlock, OutletPageDocument } from '@/lib/vendor/outlet-page-schema';

export interface OutletRendererOutlet {
  id: string;
  name: string;
  vendorId?: string | null;
  vendorName?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  operating_hours?: unknown;
  wheelchair_accessible?: boolean | null;
  pet_friendly?: boolean | null;
  logoUrl?: string | null;
  stay?: {
    checkIn: string;
    checkOut: string;
    nights: number;
    rooms: number;
    adults: number;
    checkInTime: string | null;
    checkOutTime: string | null;
    policies: string | null;
  };
}

export interface OutletRendererProduct {
  id: string;
  name: string;
  description?: string | null;
  base_price: number;
  category?: string | null;
  product_type?: string | null;
  requires_booking?: boolean;
  cover_url?: string | null;
  outlet_id?: string | null;
  variant_id?: string | null;
  variant_label?: string | null;
  first_available_slot_id?: string | null;
  available_stock?: number | null;
  rating?: number;
  reviews?: number;
  featured?: boolean;
  stay?: {
    /** Per-room price for every night of the searched stay. */
    total: number;
    /** Rooms free on the fullest night; 0 when any night is unavailable. */
    left: number;
    checkInSlotId: string | null;
  };
}

export interface OutletPageRendererProps {
  document: OutletPageDocument;
  outlet: OutletRendererOutlet;
  products?: OutletRendererProduct[];
  mode?: 'editor' | 'public';
  selectedBlockId?: string | null;
  onSelect?: (blockId: string) => void;
}

export type { GalleryItem, OutletPageBlock, OutletPageDocument };
