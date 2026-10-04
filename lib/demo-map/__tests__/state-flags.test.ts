import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_STATES } from "@/lib/demo-map/data";
import { getStateFlagSrc } from "@/lib/demo-map/state-flags";

const expectedFlagCodes: Record<string, string> = {
  perlis: "pls",
  kedah: "kdh",
  penang: "png",
  perak: "prk",
  selangor: "sgr",
  "kuala-lumpur": "kul",
  putrajaya: "pjy",
  "negeri-sembilan": "nsn",
  melaka: "mlk",
  johor: "jhr",
  kelantan: "ktn",
  terengganu: "trg",
  pahang: "phg",
  sarawak: "swk",
  sabah: "sbh",
  labuan: "lbn",
};

describe("state flag assets", () => {
  it("maps every Malaysian state and federal territory to its matching local flag", () => {
    expect(DEMO_STATES).toHaveLength(16);

    for (const state of DEMO_STATES) {
      const expectedPath = `/flags/states/${expectedFlagCodes[state.id]}.svg`;

      expect(getStateFlagSrc(state.id), state.name).toBe(expectedPath);
      expect(existsSync(resolve(process.cwd(), "public", expectedPath.slice(1)))).toBe(true);
    }
  });

  it("falls back to the national flag for an unknown state id", () => {
    expect(getStateFlagSrc("unknown-state")).toBe("/flags/my.svg");
  });
});
