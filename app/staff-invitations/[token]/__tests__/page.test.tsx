import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
const layoutSource = readFileSync(new URL("../layout.tsx", import.meta.url), "utf8");

describe("staff invitation acceptance page", () => {
  it("reviews permissions and uses the fixed invited email", () => {
    expect(source).toContain("invitation.permissions.map");
    expect(source).toContain("readOnly");
    expect(source).toContain("invitation.email");
  });

  it("supports password registration, Google, verification, account switching, and explicit acceptance", () => {
    expect(source).toContain("signUp");
    expect(source).toContain("signInWithPassword");
    expect(source).toContain("signInWithOAuth");
    expect(source).toContain("resend");
    expect(source).toContain("signOut");
    expect(source).toMatch(/method:\s*["']POST["']/);
  });

  it("returns the recipient to the invitation after auth and redirects accepted staff to /staff", () => {
    expect(source).toContain("/auth/callback?next=");
    expect(source).toContain('router.push("/staff")');
  });

  it("refreshes the authenticated employee before entering the Staff shell", () => {
    expect(source).toContain('import { useAuth } from "@/components/providers/auth"');
    expect(source).toMatch(/await refreshUser\(\)[\s\S]*?router\.push\("\/staff"\)/);
  });

  it("offers the shared language and appearance controls on the invitation page", () => {
    expect(source).toContain('import { LanguageSwitcher } from "@/components/shared/language-switcher"');
    expect(source).toContain('import { AppearanceControl } from "@/components/shared/appearance-control"');
    expect(source).toContain("<LanguageSwitcher compact />");
    expect(source).toContain("<AppearanceControl />");
  });

  it("refreshes the page after a successful existing-account sign-in to apply its saved locale", () => {
    expect(source).toMatch(/setSessionEmail\(result\.data\.user\.email[\s\S]*?router\.refresh\(\)/);
    expect(source).not.toContain("getUserByEmail");
  });

  it("lets invitees reveal or hide the password while creating their staff account", () => {
    expect(source).toContain('import { CheckCircle2, Eye, EyeOff, Globe, LockKeyhole, Mail, ShieldCheck } from "lucide-react"');
    expect(source).toContain('type={showPassword ? "text" : "password"}');
    expect(source).toContain('aria-label={showPassword ? "Hide password" : "Show password"}');
  });

  it("prevents the token-bearing document URL from being sent as a referrer or indexed", () => {
    expect(layoutSource).toContain('referrer: "no-referrer"');
    expect(layoutSource).toContain("index: false");
  });
});
