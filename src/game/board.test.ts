import { describe, expect, it } from "vitest";
import { addGarbageRows, collides, emptyBoard, fullRows } from "./board";

describe("four-lane board", () => {
  it("uses only the centered four columns", () => {
    const board = emptyBoard();
    expect(collides(board, { type: "I", rotation: 0, x: 2, y: 0 }, 4)).toBe(true);
    expect(collides(board, { type: "O", rotation: 0, x: 3, y: 0 }, 4)).toBe(false);
    board[19]!.splice(3, 4, 1, 1, 1, 1);
    expect(fullRows(board, 4)).toEqual([19]);
  });

  it("adds garbage only inside the four-lane well", () => {
    const result = addGarbageRows(emptyBoard(), [1], 4).board[19]!;
    expect(result).toEqual([0, 0, 0, 8, 0, 8, 8, 0, 0, 0]);
  });
});
