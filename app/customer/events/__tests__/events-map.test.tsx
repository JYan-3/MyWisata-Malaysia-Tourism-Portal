import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEMO_STATES } from "@/lib/demo-map/data";
import { getStateFlagSrc } from "@/lib/demo-map/state-flags";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("next/dynamic", () => ({ default: () => function DynamicMock() { return null; } }));
vi.mock("next/image", () => ({
  default: (props: { src: string; alt?: string; width?: number; height?: number; className?: string; "aria-hidden"?: boolean }) => (
    <span
      data-image-src={props.src}
      data-image-alt={props.alt ?? ""}
      data-image-width={props.width}
      data-image-height={props.height}
      data-image-class={props.className}
      data-image-aria-hidden={props["aria-hidden"]}
    />
  ),
}));

import { EventsMap } from "../events-map";

describe("Events state count flags", () => {
  it("shows each state flag decoratively beside its existing state-count row", () => {
    const markup = renderToStaticMarkup(<EventsMap campaigns={[]} />);

    expect(markup).not.toContain("ui.promotionCampaigns.map.stateCountsDescription");
    const stateRows = markup.match(/<button[^>]*aria-label="ui\.promotionCampaigns\.map\.stateCountLabel"[^>]*>[\s\S]*?<\/button>/g) ?? [];
    expect(stateRows).toHaveLength(16);

    for (const [index, state] of DEMO_STATES.entries()) {
      expect(stateRows[index]).toContain(`data-image-src="${getStateFlagSrc(state.id)}"`);
    }
    expect(markup).toContain('data-image-alt=""');
    expect(markup).toContain('data-image-aria-hidden="true"');
    expect(markup).toContain('data-image-width="32"');
    expect(markup).toContain('data-image-height="16"');
  });
});
