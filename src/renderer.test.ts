import { describe, expect, it } from "vitest";
import { previewPlacement } from "./renderer";

describe("piece preview placement", () => {
  it("centers wide and narrow held pieces inside the preview slot", () => {
    expect(previewPlacement("I", 96, 72)).toEqual({ x: 14, y: 10.5 });
    expect(previewPlacement("O", 96, 72)).toEqual({ x: 14, y: 19 });
  });
});
