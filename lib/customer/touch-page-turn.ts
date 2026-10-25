export function decideTouchPageTurn(input: {
  startPage: number;
  deltaX: number;
  thresholdPx: number;
  pageCount: number;
}): number {
  const lastPage = Math.max(0, Math.floor(input.pageCount) - 1);
  const startPage = Math.min(Math.max(Math.trunc(input.startPage), 0), lastPage);
  if (Math.abs(input.deltaX) < Math.max(0, input.thresholdPx)) return startPage;

  const direction = input.deltaX < 0 ? 1 : -1;
  return Math.min(Math.max(startPage + direction, 0), lastPage);
}
