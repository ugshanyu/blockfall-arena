import { describe, expect, it } from "vitest";
import { CLEAR_VISUALS, clearShake, previewPlacement } from "./renderer";

describe("piece preview placement", () => {
  it("centers wide and narrow held pieces inside the preview slot", () => {
    expect(previewPlacement("I", 96, 72)).toEqual({ x: 14, y: 10.5 });
    expect(previewPlacement("O", 96, 72)).toEqual({ x: 14, y: 19 });
  });
});

describe("line-clear visuals", () => {
  it("keeps flashes, particles, and shake restrained", () => {
    expect(CLEAR_VISUALS.flash * CLEAR_VISUALS.overlayAlpha).toBeLessThan(0.02);
    expect(CLEAR_VISUALS.sweepAlpha).toBeLessThanOrEqual(0.2);
    expect(CLEAR_VISUALS.particlesPerCell).toBe(1);
    expect(clearShake(4, 4)).toBeLessThan(2);
  });
});
