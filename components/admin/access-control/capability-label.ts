import type { TFunction } from "i18next";

export function capabilityLabel(key: string, t: TFunction<"admin">): string {
  const translationKey = `accessControl.capabilityNames.${key.replaceAll(".", "_")}`;
  const label = t(translationKey);
  if (label !== translationKey) return label;
  const words = key.replace(/[._]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
