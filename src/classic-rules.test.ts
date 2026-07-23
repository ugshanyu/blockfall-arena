import { describe, expect, it } from "vitest";
import { classicAttackLines, classicGarbageMultiplier, classicGravity } from "./classic-rules";

describe("classic arena progression", () => {
  it("holds gravity for thirty seconds, then increases at half rate", () => {
    expect(classicGravity(29_999)).toBe(0.02);
    expect(classicGravity(30_000)).toBe(0.02);
    expect(classicGravity(31_000)).toBeCloseTo(0.02125);
  });

  it("holds garbage at 1x for three minutes, then increases", () => {
    expect(classicGarbageMultiplier(179_999)).toBe(1);
    expect(classicGarbageMultiplier(190_000)).toBeCloseTo(1.08);
    expect(classicAttackLines(4, 220_000)).toBe(5);
  });
});
