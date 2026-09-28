import type { MetadataRoute } from 'next';

// Crawler rules. Public discovery/content stays crawlable (explore, activities,
// public vendor/outlet/place pages, events, help, legal); private, auth, portal,
// API and personal-account surfaces are disallowed. Points crawlers to the
// sitemap so they discover the public pages.
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/admin/',
          '/vendor/',
          '/staff/',
          '/staff-invitations/',
          '/outlet-manager-invitations/',
          '/vendor-invite/',
          '/dev/',
          '/login',
          '/reset-password',
          '/auth/',
          '/account-suspended',
          '/account-restore',
          '/r/', // affiliate redirect links — no page content to index
          '/customer/wallet',
          '/customer/checkout',
          '/customer/cart',
          '/customer/orders',
          '/customer/bookings',
          '/customer/kyc',
          '/customer/verification',
          '/customer/phone',
          '/customer/notifications',
          '/customer/profile',
          '/customer/preferences',
          '/customer/saved',
          '/customer/wishlist',
          '/customer/affiliate',
          '/customer/support',
          '/customer/trip',
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
