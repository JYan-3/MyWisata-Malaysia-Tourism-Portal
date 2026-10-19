export async function phoneOtpFeedbackKey(response: Response, phase: 'send' | 'verify') {
  const body = await response.json().catch(() => null) as { error?: { code?: string } } | null;
  const code = body?.error?.code;
  if (response.status === 429 || code === 'RATE_LIMITED') return 'phoneVerification.rateLimited';
  if (code === 'PHONE_ALREADY_CLAIMED') return 'phoneVerification.alreadyClaimed';
  if (code === 'HUMAN_VERIFICATION_REQUIRED') return 'humanVerification.required';
  if (code === 'HUMAN_VERIFICATION_FAILED') return 'humanVerification.invalid';
  if (code === 'HUMAN_VERIFICATION_UNAVAILABLE' || response.status >= 500) return 'humanVerification.unavailable';
  if (phase === 'verify' && response.status === 422) return 'phoneVerification.invalidCode';
  return phase === 'send' ? 'phoneVerification.sendFailed' : 'phoneVerification.verifyFailed';
}
