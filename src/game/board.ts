import { cells, PIECE_ID } from "./pieces";
import { BOARD_HEIGHT, BOARD_WIDTH, type ActivePiece, type Cell } from "./types";

export function emptyBoard(): Cell[][] {
  return Array.from({ length: BOARD_HEIGHT }, () => Array<Cell>(BOARD_WIDTH).fill(0));
}

export function collides(board: Cell[][], piece: ActivePiece): boolean {
  return cells(piece.type, piece.rotation).some(([dx, dy]) => {
    const x = piece.x + dx;
    const y = piece.y + dy;
    return x < 0 || x >= BOARD_WIDTH || y >= BOARD_HEIGHT || (y >= 0 && board[y]?.[x] !== 0);
  });
}

export function ghostY(board: Cell[][], piece: ActivePiece): number {
  let y = piece.y;
  while (!collides(board, { ...piece, y: y + 1 })) y += 1;
  return y;
}

export function lockPiece(board: Cell[][], piece: ActivePiece): boolean {
  let toppedOut = false;
  const id = PIECE_ID[piece.type];
  for (const [dx, dy] of cells(piece.type, piece.rotation)) {
    const x = piece.x + dx;
    const y = piece.y + dy;
    if (y < 0) toppedOut = true;
    else if (board[y]) board[y]![x] = id;
  }
  return toppedOut;
}

export function fullRows(board: Cell[][]): number[] {
  return board.flatMap((row, index) => row.every(Boolean) ? [index] : []);
}

export function removeRows(board: Cell[][], rows: number[]): Cell[][] {
  const cleared = new Set(rows);
  const next = board.filter((_, index) => !cleared.has(index));
  while (next.length < BOARD_HEIGHT) next.unshift(Array<Cell>(BOARD_WIDTH).fill(0));
  return next;
}

export function addGarbageRows(board: Cell[][], holes: number[]): { board: Cell[][]; toppedOut: boolean } {
  const next = board.map((row) => [...row]);
  for (const hole of holes) {
    if (next.shift()?.some(Boolean)) return { board: next, toppedOut: true };
    next.push(Array.from({ length: BOARD_WIDTH }, (_, x) => (x === hole ? 0 : 8) as Cell));
  }
  return { board: next, toppedOut: false };
}
