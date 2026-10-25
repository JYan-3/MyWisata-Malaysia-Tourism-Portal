export type WheelTurnState = {
  locked: boolean;
  lastAbs: number;
  lastEventAt: number;
  lastTurnAt: number;
};

export const INITIAL_WHEEL_TURN_STATE: WheelTurnState = {
  locked: false,
  lastAbs: 0,
  lastEventAt: -Infinity,
  lastTurnAt: -Infinity,
};

const MIN_DELTA = 2;
const QUIET_WINDOW_MS = 140;
const DELIBERATE_TURN_DELAY_MS = 220;

export function decideWheelTurn(
  state: WheelTurnState,
  input: { deltaX: number; deltaY: number; now: number },
): { turn: -1 | 0 | 1; state: WheelTurnState } {
  const delta = Math.abs(input.deltaX) > Math.abs(input.deltaY) ? input.deltaX : input.deltaY;
  const magnitude = Math.abs(delta);

  if (magnitude < MIN_DELTA) return { turn: 0, state };

  const quietSinceLastEvent = input.now - state.lastEventAt >= QUIET_WINDOW_MS;
  const deliberateNewSwipe = input.now - state.lastTurnAt >= DELIBERATE_TURN_DELAY_MS
    && magnitude > state.lastAbs * 1.5 + 6;
  const isNewGesture = !state.locked || quietSinceLastEvent || deliberateNewSwipe;

  if (!isNewGesture) {
    return {
      turn: 0,
      state: { ...state, lastAbs: magnitude, lastEventAt: input.now },
    };
  }

  return {
    turn: delta < 0 ? -1 : 1,
    state: {
      locked: true,
      lastAbs: magnitude,
      lastEventAt: input.now,
      lastTurnAt: input.now,
    },
  };
}
