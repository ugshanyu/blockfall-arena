import { describe, expect, it } from "vitest";
import { resolveGestureAxis } from "./input";

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
});
