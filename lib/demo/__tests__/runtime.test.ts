import { describe, expect, it } from "vitest";
import { isDemoToolRuntimeEnabled } from "@/lib/demo/runtime";

describe("Demo tool runtime isolation", () => {
  it("requires an explicit opt-in", () => {
    expect(isDemoToolRuntimeEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(isDemoToolRuntimeEnabled({ NODE_ENV: "development", MYLAWATAN_DEMO_TOOLS: "true" })).toBe(true);
    expect(isDemoToolRuntimeEnabled({ NODE_ENV: "development", MYWISATA_DEMO_TOOLS: "true" })).toBe(true);
  });

  it("cannot be enabled in production", () => {
    expect(isDemoToolRuntimeEnabled({
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      MYLAWATAN_DEMO_TOOLS: "true",
    })).toBe(false);
    expect(isDemoToolRuntimeEnabled({
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      MYWISATA_DEMO_TOOLS: "true",
    })).toBe(false);
    expect(isDemoToolRuntimeEnabled({
      NODE_ENV: "development",
      MYWISATA_ENV: "production",
      MYWISATA_DEMO_TOOLS: "true",
    })).toBe(false);
    expect(isDemoToolRuntimeEnabled({
      NODE_ENV: "development",
      MYLAWATAN_ENV: "production",
      MYLAWATAN_DEMO_TOOLS: "true",
    })).toBe(false);
  });

  it("allows an explicitly opted-in preview or staging deployment", () => {
    expect(isDemoToolRuntimeEnabled({
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      MYLAWATAN_DEMO_TOOLS: "true",
    })).toBe(true);
    expect(isDemoToolRuntimeEnabled({
      NODE_ENV: "production",
      MYLAWATAN_ENV: "staging",
      MYLAWATAN_DEMO_TOOLS: "true",
    })).toBe(true);
    expect(isDemoToolRuntimeEnabled({
      NODE_ENV: "production",
      MYWISATA_ENV: "staging",
      MYWISATA_DEMO_TOOLS: "true",
    })).toBe(true);
  });

  it("gives the renamed environment variables precedence over legacy values", () => {
    expect(isDemoToolRuntimeEnabled({
      NODE_ENV: "development",
      MYLAWATAN_DEMO_TOOLS: "false",
      MYWISATA_DEMO_TOOLS: "true",
    })).toBe(false);
    expect(isDemoToolRuntimeEnabled({
      NODE_ENV: "production",
      MYLAWATAN_ENV: "production",
      MYWISATA_ENV: "staging",
      MYLAWATAN_DEMO_TOOLS: "true",
    })).toBe(false);
  });
});
