import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/auth/safe-next";

describe("safeNext", () => {
  it("keeps local routes", () => expect(safeNext("/customer/profile")).toBe("/customer/profile"));
  it("rejects external and protocol-relative routes", () => {
    expect(safeNext("https://attacker.example")).toBe("/customer/explore");
    expect(safeNext("//attacker.example")).toBe("/customer/explore");
  });
});
import { safeKycReviewNext } from '../safe-next';
describe('KYC MFA return path', () => {
  it('allows only the queue and a concrete submission detail', () => {
    const detail = '/admin/kyc/11111111-1111-4111-8111-111111111111';
    expect(safeKycReviewNext(detail)).toBe(detail);
    for (const path of ['//evil.test', '/admin/kyc/mfa', '/admin/users', '/admin/kyc?next=evil', '/admin/kyc/../users']) {
      expect(safeKycReviewNext(path)).toBe('/admin/kyc');
    }
  });
});
