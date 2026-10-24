import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.createServiceClient }));

import { GET } from '../route';

const userId = '11111111-1111-4111-8111-111111111111';

function query(result: { data: unknown; error: null | { message: string } }) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  return builder;
}

function profileRow() {
  return {
    id: userId,
    email: 'customer@example.test',
    full_name: 'Customer',
    display_name: null,
    avatar_url: null,
    bio: null,
    phone: null,
    city: null,
    country: null,
    city_id: null,
    country_code: null,
    city_source: null,
    status: 'active',
    tier: 'email_verified',
    kyc_status: 'approved',
    email_verified_at: null,
    phone_verified_at: null,
    profile_completed_at: null,
  };
}

describe('GET /api/profile/me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads only the authenticated customer KYC summary through the server client', async () => {
    const profileQuery = query({ data: profileRow(), error: null });
    const preferenceQuery = query({ data: null, error: null });
    const requestFrom = vi.fn((table: string) => table === 'users' ? profileQuery : preferenceQuery);
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }) },
      from: requestFrom,
    });

    const reviewQuery = query({
      data: [{ status: 'approved', review_reason_code: null, reviewed_at: '2026-10-20T10:00:00Z', created_at: '2026-10-20T09:00:00Z' }],
      error: null,
    });
    const serviceFrom = vi.fn(() => reviewQuery);
    mocks.createServiceClient.mockReturnValue({ from: serviceFrom });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.latestKycReview.status).toBe('approved');
    expect(requestFrom).not.toHaveBeenCalledWith('kyc_submissions');
    expect(serviceFrom).toHaveBeenCalledWith('kyc_submissions');
    expect(reviewQuery.select).toHaveBeenCalledWith('status,review_reason_code,reviewed_at,created_at');
    expect(reviewQuery.eq).toHaveBeenCalledWith('user_id', userId);
  });

  it('does not create a service client for an unauthenticated request', async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      from: vi.fn(),
    });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });
});
