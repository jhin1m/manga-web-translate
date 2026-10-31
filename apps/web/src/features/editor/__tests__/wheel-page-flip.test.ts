import { describe, expect, it } from "vitest";
import {
  FLIP_COOLDOWN_MS,
  FLIP_LOCK_MAX_MS,
  FLIP_PAUSE_MS,
  FLIP_THRESHOLD,
  type FlipState,
  initialFlip,
  stepFlip,
  type WheelInput,
} from "../wheel-page-flip.ts";

const base: WheelInput = {
  t: 1000,
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  modified: false,
  atTop: false,
  atBottom: true,
  hasPrev: true,
  hasNext: true,
  busy: false,
  frameH: 800,
};

/** Chạy chuỗi sự kiện; trả quyết định cuối + trạng thái. */
function run(events: Partial<WheelInput>[], from: FlipState = initialFlip) {
  let state = from;
  const flips: number[] = [];
  for (const e of events) {
    const r = stepFlip(state, { ...base, ...e });
    state = r.state;
    flips.push(r.flip);
  }
  return { state, flips };
}

describe("stepFlip", () => {
  it("single small wheel at the edge does not flip", () => {
    expect(run([{ deltaY: 40 }]).flips).toEqual([0]);
  });

  it("accumulated overscroll past the threshold flips to the next page", () => {
    const step = FLIP_THRESHOLD / 2;
    const { flips } = run([
      { t: 1000, deltaY: step },
      { t: 1016, deltaY: step },
    ]);
    expect(flips).toEqual([0, 1]);
  });

  it("scrolling up past the top flips to the previous page", () => {
    const { flips } = run([{ deltaY: -FLIP_THRESHOLD, atTop: true, atBottom: false }]);
    expect(flips).toEqual([-1]);
  });

  it("inertia right after a flip is ignored until the cooldown and a pause end", () => {
    const first = run([{ t: 1000, deltaY: FLIP_THRESHOLD }]);
    expect(first.flips).toEqual([1]);
    const tail = run(
      [
        { t: 1016, deltaY: FLIP_THRESHOLD },
        { t: 1100, deltaY: FLIP_THRESHOLD },
        { t: 1300, deltaY: FLIP_THRESHOLD },
        { t: 1550, deltaY: FLIP_THRESHOLD },
        { t: 1000 + FLIP_COOLDOWN_MS + 10, deltaY: FLIP_THRESHOLD }, // quán tính vẫn chạy → vẫn chặn
      ],
      first.state,
    );
    expect(tail.flips).toEqual([0, 0, 0, 0, 0]);
    const later = run([{ t: tail.state.last + FLIP_PAUSE_MS + 1, deltaY: FLIP_THRESHOLD }], tail.state);
    expect(later.flips).toEqual([1]);
  });

  it("changing direction resets the accumulator", () => {
    const { flips } = run([
      { t: 1000, deltaY: FLIP_THRESHOLD - 10 },
      { t: 1010, deltaY: -50, atTop: true, atBottom: true },
      { t: 1020, deltaY: 50 },
    ]);
    expect(flips).toEqual([0, 0, 0]);
  });

  it("scrolling away from the edge resets the accumulator", () => {
    const { flips } = run([
      { t: 1000, deltaY: FLIP_THRESHOLD - 10 },
      { t: 1010, deltaY: 30, atBottom: false },
      { t: 1020, deltaY: 30 },
    ]);
    expect(flips).toEqual([0, 0, 0]);
  });

  it("a pause resets the accumulator", () => {
    const { flips } = run([
      { t: 1000, deltaY: FLIP_THRESHOLD - 10 },
      { t: 1000 + FLIP_PAUSE_MS + 1, deltaY: 30 },
    ]);
    expect(flips).toEqual([0, 0]);
  });

  it("ignores zoom / modified wheel", () => {
    expect(run([{ deltaY: FLIP_THRESHOLD * 3, modified: true }]).flips).toEqual([0]);
  });

  it("never flips while a box is dragged or a button is held", () => {
    const r = run([{ deltaY: FLIP_THRESHOLD * 3, busy: true }]);
    expect(r.flips).toEqual([0]);
    expect(r.state).toEqual(initialFlip);
  });

  it("reports locked for the flip and its inertia, not for a fresh gesture after the pause", () => {
    let st = initialFlip;
    const locked: boolean[] = [];
    for (const t of [1000, 1100, 1300, 1500]) {
      const r = stepFlip(st, { ...base, t, deltaY: FLIP_THRESHOLD });
      st = r.state;
      locked.push(r.locked);
    }
    expect(locked).toEqual([true, true, true, true]);
    expect(stepFlip(st, { ...base, t: st.last + FLIP_PAUSE_MS + 1, deltaY: 10, atBottom: false }).locked).toBe(false);
    // Zoom / ngang trong lúc khoá không bị nuốt.
    expect(stepFlip(st, { ...base, t: st.last + 10, deltaY: 10, modified: true }).locked).toBe(false);
  });

  it("while locked, opposite-direction wheel scrolls (not locked) and cannot flip", () => {
    const first = stepFlip(initialFlip, { ...base, t: 1000, deltaY: FLIP_THRESHOLD });
    const back = stepFlip(first.state, { ...base, t: 1050, deltaY: -FLIP_THRESHOLD * 2, atTop: true });
    expect(back.flip).toBe(0);
    expect(back.locked).toBe(false);
    // Vẫn khoá theo hướng cũ.
    expect(stepFlip(back.state, { ...base, t: 1100, deltaY: 30 }).locked).toBe(true);
  });

  it("caps the lock at FLIP_LOCK_MAX_MS even if wheel events never pause", () => {
    let st = stepFlip(initialFlip, { ...base, t: 1000, deltaY: FLIP_THRESHOLD }).state;
    for (let t = 1100; t < 1000 + FLIP_LOCK_MAX_MS; t += 100) {
      const r = stepFlip(st, { ...base, t, deltaY: 40 });
      expect(r.locked).toBe(true);
      st = r.state;
    }
    const after = stepFlip(st, { ...base, t: 1000 + FLIP_LOCK_MAX_MS + 50, deltaY: 40 });
    expect(after.locked).toBe(false);
  });

  it("ignores horizontal-dominant wheel", () => {
    expect(run([{ deltaX: FLIP_THRESHOLD * 3, deltaY: 20 }]).flips).toEqual([0]);
  });

  it("does nothing on the last page going down or the first page going up", () => {
    expect(run([{ deltaY: FLIP_THRESHOLD * 3, hasNext: false }]).flips).toEqual([0]);
    expect(run([{ deltaY: -FLIP_THRESHOLD * 3, atTop: true, hasPrev: false }]).flips).toEqual([0]);
  });

  it("normalizes line and page delta modes", () => {
    expect(run([{ deltaY: 10, deltaMode: 1 }]).flips).toEqual([1]); // 10 dòng ≥ ngưỡng
    expect(run([{ deltaY: 1, deltaMode: 2 }]).flips).toEqual([1]); // 1 trang = frameH
    expect(run([{ deltaY: 1, deltaMode: 1 }]).flips).toEqual([0]);
  });
});
