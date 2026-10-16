import { describe, expect, it } from "vitest";
import { readMigratedClientStorageValue } from "./client-storage";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe("readMigratedClientStorageValue", () => {
  it("moves a legacy value to the current key before removing the legacy key", () => {
    const storage = memoryStorage({ old: "saved draft" });

    expect(readMigratedClientStorageValue(storage, "current", "old")).toBe("saved draft");
    expect(storage.values.get("current")).toBe("saved draft");
    expect(storage.values.has("old")).toBe(false);
  });

  it("prefers the current value when both keys exist", () => {
    const storage = memoryStorage({ current: "new draft", old: "old draft" });

    expect(readMigratedClientStorageValue(storage, "current", "old")).toBe("new draft");
    expect(storage.values.get("old")).toBe("old draft");
  });

  it("keeps and returns the legacy value when copying it fails", () => {
    const storage = memoryStorage({ old: "saved draft" });
    storage.setItem = () => { throw new Error("storage unavailable"); };

    expect(readMigratedClientStorageValue(storage, "current", "old")).toBe("saved draft");
    expect(storage.values.has("old")).toBe(true);
  });
});
