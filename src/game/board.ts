import { cells, PIECE_ID } from "./pieces";
import { BOARD_HEIGHT, BOARD_WIDTH, laneStart, type ActivePiece, type Cell, type LaneCount } from "./types";

export function emptyBoard(): Cell[][] {
  return Array.from({ length: BOARD_HEIGHT }, () => Array<Cell>(BOARD_WIDTH).fill(0));
}

export function collides(board: Cell[][], piece: ActivePiece, lanes: LaneCount = 10): boolean {
  const start = laneStart(lanes);
  return cells(piece.type, piece.rotation).some(([dx, dy]) => {
    const x = piece.x + dx;
    const y = piece.y + dy;
    return x < start || x >= start + lanes || y >= BOARD_HEIGHT || (y >= 0 && board[y]?.[x] !== 0);
  });
}

export function ghostY(board: Cell[][], piece: ActivePiece, lanes: LaneCount = 10): number {
  let y = piece.y;
  while (!collides(board, { ...piece, y: y + 1 }, lanes)) y += 1;
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

export function fullRows(board: Cell[][], lanes: LaneCount = 10): number[] {
  const start = laneStart(lanes);
  return board.flatMap((row, index) => row.slice(start, start + lanes).every(Boolean) ? [index] : []);
}

export function removeRows(board: Cell[][], rows: number[]): Cell[][] {
  const cleared = new Set(rows);
  const next = board.filter((_, index) => !cleared.has(index));
  while (next.length < BOARD_HEIGHT) next.unshift(Array<Cell>(BOARD_WIDTH).fill(0));
  return next;
}

export function addGarbageRows(board: Cell[][], holes: number[], lanes: LaneCount = 10): { board: Cell[][]; toppedOut: boolean } {
  const start = laneStart(lanes);
  const next = board.map((row) => [...row]);
  for (const hole of holes) {
    if (next.shift()?.some(Boolean)) return { board: next, toppedOut: true };
    next.push(Array.from({ length: BOARD_WIDTH }, (_, x) => (x >= start && x < start + lanes && x !== start + hole ? 8 : 0) as Cell));
  }
  return { board: next, toppedOut: false };
}
