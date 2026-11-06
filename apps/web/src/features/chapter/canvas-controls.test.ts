import { describe, expect, it } from "vitest";
import { zoomLabel } from "./canvas-controls.tsx";

describe("zoom button label", () => {
  it("says the current state and what a click does", () => {
    expect(zoomLabel(62, false)).toBe("Đang vừa khung (62%). Bấm để xem cỡ thật 100%");
    expect(zoomLabel(100, true)).toBe("Đang 100%. Bấm để vừa khung");
    // Zoom tuỳ ý (Ctrl+cuộn): bấm đưa về 100%.
    expect(zoomLabel(150, true)).toBe("Đang 150%. Bấm để xem cỡ thật 100%");
  });
});
