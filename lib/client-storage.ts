type ClientStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Read a renamed client-storage key, copying legacy data before removing it. */
export function readMigratedClientStorageValue(
  storage: ClientStorage,
  currentKey: string,
  legacyKey: string,
): string | null {
  const currentValue = storage.getItem(currentKey);
  if (currentValue !== null) return currentValue;

  const legacyValue = storage.getItem(legacyKey);
  if (legacyValue === null) return null;

  try {
    storage.setItem(currentKey, legacyValue);
    storage.removeItem(legacyKey);
  } catch {
    // Keep returning the old value; a failed copy must not discard user data.
  }

  return legacyValue;
}
