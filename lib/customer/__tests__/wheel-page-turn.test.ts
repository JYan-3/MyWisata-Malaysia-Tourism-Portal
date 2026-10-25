import { describe, expect, it } from "vitest";
import {
  decideWheelTurn,
  INITIAL_WHEEL_TURN_STATE,
  type WheelTurnState,
} from "@/lib/customer/wheel-page-turn";

function turnsFor(events: Array<{ deltaX?: number; deltaY?: number; now: number }>): Array<-1 | 1> {
  let state: WheelTurnState = INITIAL_WHEEL_TURN_STATE;
  const turns: Array<-1 | 1> = [];

  for (const event of events) {
    const result = decideWheelTurn(state, {
      deltaX: event.deltaX ?? 0,
      deltaY: event.deltaY ?? 0,
      now: event.now,
    });
    state = result.state;
    if (result.turn !== 0) turns.push(result.turn);
  }

  return turns;
}

describe("decideWheelTurn", () => {
  it("turns once for one swipe followed by decaying momentum", () => {
    expect(turnsFor([40, 38, 35, 30, 24, 18, 12, 8, 5, 3].map((deltaY, index) => ({ deltaY, now: index * 16 })))).toEqual([1]);
  });

  it("recognizes a deliberate second swipe during momentum", () => {
    const momentum = [40, 30, 22, 16, 12, 9, 7, 6, 5, 5, 4, 4, 4, 4, 4]
      .map((deltaY, index) => ({ deltaY, now: index * 16 }));

    expect(turnsFor([...momentum, { deltaY: 48, now: 240 }])).toEqual([1, 1]);
  });

  it("ignores a stronger movement too soon after a page turn", () => {
    expect(turnsFor([
      { deltaY: 40, now: 0 },
      { deltaY: 90, now: 100 },
    ])).toEqual([1]);
  });

  it("starts a new gesture after the quiet window", () => {
    expect(turnsFor([
      { deltaY: 40, now: 0 },
      { deltaY: 10, now: 200 },
    ])).toEqual([1, 1]);
  });

  it("ignores tiny deltas", () => {
    expect(turnsFor([
      { deltaY: 1, now: 0 },
      { deltaY: 1.5, now: 16 },
    ])).toEqual([]);
  });

  it("uses the dominant axis to choose the direction", () => {
    expect(turnsFor([{ deltaX: -30, deltaY: 5, now: 0 }])).toEqual([-1]);
  });
});
