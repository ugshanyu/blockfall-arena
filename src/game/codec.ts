import { BOARD_HEIGHT, BOARD_WIDTH, type Cell } from "./types";

export function encodeBoard(board: Cell[][]): string {
  let result = "";
  for (let y = 0; y < BOARD_HEIGHT; y += 1) {
    for (let x = 0; x < BOARD_WIDTH; x += 1) result += String(board[y]?.[x] ?? 0);
  }
  return result;
}

export function decodeBoard(value: string): Cell[][] {
  return Array.from({ length: BOARD_HEIGHT }, (_, y) =>
    Array.from({ length: BOARD_WIDTH }, (_, x) => {
      const cell = Number(value[y * BOARD_WIDTH + x]);
      return (Number.isInteger(cell) && cell >= 0 && cell <= 8 ? cell : 0) as Cell;
    })
  );
}
