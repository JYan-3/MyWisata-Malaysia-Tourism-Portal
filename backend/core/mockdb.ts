export function resetDemo(): void {
  // This console helper may run outside a React tree, so it has no App Router instance.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  if (typeof window !== "undefined") window.location.href = "/login";
}
