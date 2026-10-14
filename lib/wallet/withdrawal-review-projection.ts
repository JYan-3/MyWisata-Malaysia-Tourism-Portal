export type WithdrawalNotificationSnapshot = {
  customer: { id: string; displayName: string; email: string | null };
  requestTime: string;
  kycStatus: string;
  risk: { level: string; reasons: string[] };
  sourceTotals: { rewardSen: number; affiliateSen: number; otherSen: number };
  destination: { type: string; maskedReference: string };
};

import { emailLocale, emailTime } from "@/lib/email/copy";
import type { AppLocale } from "@/lib/i18n/locale";
import { formatMYRFromSen } from "@/lib/i18n/format";

function safeLabel(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) || 'Unknown';
}

function formatSen(value: number): string {
  return formatMYRFromSen(Math.max(0, value));
}

export function buildWithdrawalNotificationReason(snapshot: WithdrawalNotificationSnapshot, locale?: AppLocale): string {
  const selected = emailLocale(locale);
  if (selected !== 'en') {
    const zh = selected === 'zh-CN';
    const labels = zh ? ['顾客','KYC 状态','风险','推荐奖励来源','联盟奖励来源','其他来源','收款去向','申请时间'] : ['Pelanggan','Status KYC','Risiko','Sumber ganjaran','Sumber afiliasi','Sumber lain','Destinasi','Masa permohonan'];
    const terms: Record<string, readonly [string,string]> = {
      approved:['已批准','Diluluskan'], pending:['待处理','Tertunda'], rejected:['已拒绝','Ditolak'],
      low:['低','Rendah'],review:['待审核','Perlu semakan'],high:['高','Tinggi'],
      e_wallet:['电子钱包','E-dompet'],bank:['银行','Bank'],stripe:['Stripe','Stripe'],
      recent_failed_withdrawal:['近期有失败提现','Pengeluaran terkini gagal'],
    };
    const term = (value: string) => terms[value]?.[zh ? 0 : 1] ?? safeLabel(value);
    const risk = snapshot.risk.reasons.map(term).join(', ') || (zh ? '无额外风险因素' : 'Tiada faktor risiko tambahan');
    return [
      `${labels[0]}: ${safeLabel(snapshot.customer.displayName)}`,
      `${labels[1]}: ${term(snapshot.kycStatus)}`,
      `${labels[2]}: ${term(snapshot.risk.level)} (${risk})`,
      `${labels[3]}: ${formatSen(snapshot.sourceTotals.rewardSen)}`,
      `${labels[4]}: ${formatSen(snapshot.sourceTotals.affiliateSen)}`,
      `${labels[5]}: ${formatSen(snapshot.sourceTotals.otherSen)}`,
      `${labels[6]}: ${term(snapshot.destination.type)} ${safeLabel(snapshot.destination.maskedReference)}`,
      `${labels[7]}: ${emailTime(snapshot.requestTime, selected)}`,
    ].join(' | ');
  }
  const reasons = snapshot.risk.reasons.map(safeLabel).join(', ') || 'No elevated factors';
  return [
    `Customer: ${safeLabel(snapshot.customer.displayName)}`,
    `KYC: ${safeLabel(snapshot.kycStatus)}`,
    `Risk: ${safeLabel(snapshot.risk.level)} (${reasons})`,
    `Reward sources: ${formatSen(snapshot.sourceTotals.rewardSen)}`,
    `Affiliate sources: ${formatSen(snapshot.sourceTotals.affiliateSen)}`,
    `Other sources: ${formatSen(snapshot.sourceTotals.otherSen)}`,
    `Destination: ${safeLabel(snapshot.destination.type)} ${safeLabel(snapshot.destination.maskedReference)}`,
    `Request time: ${snapshot.requestTime}`,
  ].join(' | ');
}

export function buildWithdrawalNotificationMetadata(snapshot: WithdrawalNotificationSnapshot) {
  return {
    customer_id: snapshot.customer.id,
    customer_display_name: safeLabel(snapshot.customer.displayName),
    request_time: snapshot.requestTime,
    kyc_status: safeLabel(snapshot.kycStatus),
    risk_level: safeLabel(snapshot.risk.level),
    risk_reasons: snapshot.risk.reasons.map(safeLabel),
    reward_source_sen: Math.max(0, snapshot.sourceTotals.rewardSen),
    affiliate_source_sen: Math.max(0, snapshot.sourceTotals.affiliateSen),
    other_source_sen: Math.max(0, snapshot.sourceTotals.otherSen),
    destination_type: safeLabel(snapshot.destination.type),
    destination_masked_ref: safeLabel(snapshot.destination.maskedReference),
  };
}
