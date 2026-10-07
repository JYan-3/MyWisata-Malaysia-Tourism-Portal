import { describe, expect, it } from 'vitest';
import { getEventOperationalLabelKey } from '@/lib/promotion-campaigns/locations';

describe('location based operational labels', () => {
  it('shows a break between sessions even within the overall event dates', () => {
    expect(getEventOperationalLabelKey({ visibility: 'live', operationalStatus: 'between_sessions' })).toBe('ui.promotionCampaigns.betweenSessions');
  });
  it('uses the operational location status and supports older projections', () => {
    expect(getEventOperationalLabelKey({ visibility: 'live', operationalStatus: 'operating' })).toBe('ui.promotionCampaigns.operating');
    expect(getEventOperationalLabelKey({ visibility: 'live', operationalStatus: 'upcoming' })).toBe('ui.promotionCampaigns.upcoming');
    expect(getEventOperationalLabelKey({ visibility: 'live' })).toBe('ui.promotionCampaigns.live');
  });
});
