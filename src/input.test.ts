import { describe, expect, it } from "vitest";
import { controlDragSteps, horizontalDragDistance, horizontalRepeatDelay, isHardDropGesture, resolveGestureAxis } from "./input";

describe("touch gesture intent", () => {
  it("locks a downward swipe before incidental horizontal drift can move the piece", () => {
    let axis = resolveGestureAxis("pending", 16, 2);
    axis = resolveGestureAxis(axis, 18, 72, false);
    expect(axis).toBe("vertical");
  });

  it("keeps an intentional horizontal drag locked when the finger later moves down", () => {
    let axis = resolveGestureAxis("pending", 28, 4);
    axis = resolveGestureAxis(axis, 32, 70, true);
    expect(axis).toBe("horizontal");
  });

  it("rejects a slight downward gesture", () => {
    expect(isHardDropGesture(8, 74, 260, 700)).toBe(false);
  });

  it("accepts a deliberate long vertical swipe", () => {
    expect(isHardDropGesture(12, 140, 420, 700)).toBe(true);
  });

  it("requires a deliberate horizontal drag before moving a lane", () => {
    expect(horizontalDragDistance(320, 4)).toBeCloseTo(67.2);
    expect(horizontalDragDistance(320, 10)).toBeCloseTo(28);
  });

  it("keeps small movement on the Hold control as a tap", () => {
    expect(controlDragSteps(17, 17)).toEqual({ horizontal: 0, down: 0 });
  });

  it("turns a Hold-control drag into horizontal and downward cell steps", () => {
    expect(controlDragSteps(48, 63)).toEqual({ horizontal: 2, down: 3 });
    expect(controlDragSteps(-48, 63)).toEqual({ horizontal: -2, down: 3 });
  });
});

describe("keyboard horizontal acceleration", () => {
  it("accelerates repeat speed the longer a side key is held", () => {
    expect(horizontalRepeatDelay(200)).toBe(45);
    expect(horizontalRepeatDelay(600)).toBe(30);
    expect(horizontalRepeatDelay(1000)).toBe(18);
  });
});
