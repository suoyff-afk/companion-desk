import { describe, expect, it } from "vitest";
import {
  completeOrTick,
  createFocusState,
  end,
  pause,
  resume,
  start,
} from "./focusMachine";

describe("focusMachine", () => {
  it("does not consume time while paused", () => {
    const paused = pause(start(createFocusState(3_000), 1_000), 1_500);

    expect(paused.remainingMs).toBe(2_500);
    expect(completeOrTick(paused, 2_500).remainingMs).toBe(2_500);
  });

  it("resumes from the paused remainder", () => {
    const paused = pause(start(createFocusState(3_000), 1_000), 1_500);
    const running = resume(paused, 5_000);

    expect(completeOrTick(running, 5_750).remainingMs).toBe(1_750);
  });

  it("marks a session complete at zero", () => {
    const running = start(createFocusState(1_000), 2_000);
    const completed = completeOrTick(running, 3_250);

    expect(completed.status).toBe("completed");
    expect(completed.remainingMs).toBe(0);
  });

  it("supports an explicit end without recording completion", () => {
    const ended = end(start(createFocusState(5_000), 1_000), 1_500);

    expect(ended.status).toBe("ended");
    expect(ended.remainingMs).toBe(4_500);
  });
});
