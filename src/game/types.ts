export const BOARD_WIDTH = 10;
export const BOARD_HEIGHT = 20;
export type LaneCount = 4 | 10;
export function laneStart(lanes: LaneCount): number { return lanes === 4 ? 3 : 0; }

export type PieceType = "I" | "O" | "T" | "S" | "Z" | "J" | "L";
export type Cell = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type GamePhase = "playing" | "clearing" | "paused" | "game-over";
export type Command = "left" | "right" | "soft-drop" | "hard-drop" | "rotate-cw" | "rotate-ccw" | "hold";

export interface ActivePiece {
  type: PieceType;
  rotation: number;
  x: number;
  y: number;
}

export interface GameEvent {
  id: number;
  type: "clear" | "collapse" | "hard-drop" | "game-over" | "garbage";
  rows?: number[];
  count?: number;
  fromY?: number;
  toY?: number;
  piece?: PieceType;
  x?: number;
  rotation?: number;
}

export interface GameSnapshot {
  lanes: LaneCount;
  board: Cell[][];
  active: ActivePiece | null;
  ghostY: number;
  hold: PieceType | null;
  next: PieceType[];
  score: number;
  lines: number;
  level: number;
  phase: GamePhase;
  clearRows: number[];
  clearProgress: number;
  pendingGarbage: number;
  eventId: number;
}

export interface NetworkSnapshot extends Omit<GameSnapshot, "board"> {
  board: string;
  rngState: number;
  bag: PieceType[];
  queue: PieceType[];
  garbage: number[];
  canHold: boolean;
  fallElapsed: number;
  lockElapsed: number;
}
