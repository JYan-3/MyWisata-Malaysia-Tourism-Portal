export interface RedemptionApiStats {
  totalCount?: number;
  todayCount?: number;
  voucherCount?: number;
  ticketCount?: number;
  activeOutletsCount?: number;
}

export interface RedemptionStationStats {
  todayScans: number;
  ticketAdmissions: number;
  voucherRedemptions: number;
}

export function mapRedemptionStationStats(stats?: RedemptionApiStats): RedemptionStationStats {
  return {
    todayScans: stats?.todayCount ?? 0,
    ticketAdmissions: stats?.ticketCount ?? 0,
    voucherRedemptions: stats?.voucherCount ?? 0,
  };
}
