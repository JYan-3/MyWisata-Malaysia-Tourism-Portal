export type WormSizes = {
  dot: number;
  pill: number;
  gap: number;
};

type WormIndicatorGeometry = {
  widths: number[];
  pillLeft: number;
  pillWidth: number;
};

export function wormIndicatorGeometry(
  progress: number,
  count: number,
  sizes: WormSizes,
): WormIndicatorGeometry {
  if (count <= 1) {
    return { widths: [sizes.pill], pillLeft: 0, pillWidth: sizes.pill };
  }

  const clampedProgress = Math.min(Math.max(progress, 0), count - 1);
  const index = Math.min(Math.floor(clampedProgress), count - 2);
  const transition = clampedProgress - index;
  const head = Math.min(1, transition * 2);
  const tail = Math.max(0, transition * 2 - 1);
  const widthDelta = sizes.pill - sizes.dot;
  const widths = Array.from({ length: count }, (_, itemIndex) => {
    if (itemIndex === index) return sizes.dot + widthDelta * (1 - transition);
    if (itemIndex === index + 1) return sizes.dot + widthDelta * transition;
    return sizes.dot;
  });
  const leftAt = (itemIndex: number) => widths
    .slice(0, itemIndex)
    .reduce((left, width) => left + width + sizes.gap, 0);
  const currentLeft = leftAt(index);
  const nextLeft = leftAt(index + 1);
  const currentRight = currentLeft + widths[index];
  const nextRight = nextLeft + widths[index + 1];
  const pillLeft = currentLeft + (nextLeft - currentLeft) * tail;
  const pillRight = currentRight + (nextRight - currentRight) * head;

  return { widths, pillLeft, pillWidth: pillRight - pillLeft };
}
