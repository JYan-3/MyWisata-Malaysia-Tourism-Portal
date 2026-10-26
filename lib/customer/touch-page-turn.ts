/**
 * A touch swipe on the home destination rail may move at most one page. The browser scrolls the rail natively;
 * if a hard fling settles further than one page from where the finger started, the rail is pulled back to start ± 1.
 */
export function limitSwipeToOnePage(input: {
  startPage: number;
  settledPage: number;
  pageCount: number;
}): number {
  const lastPage = Math.max(0, Math.floor(input.pageCount) - 1);
  const clamp = (page: number) => Math.min(Math.max(Math.trunc(page), 0), lastPage);
  const startPage = clamp(input.startPage);
  return clamp(Math.min(Math.max(input.settledPage, startPage - 1), startPage + 1));
}
