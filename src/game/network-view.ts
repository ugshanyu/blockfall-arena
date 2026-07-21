import { decodeBoard } from "./codec";
import type { GameSnapshot, NetworkSnapshot } from "./types";

export function viewSnapshot(snapshot: NetworkSnapshot): GameSnapshot {
  const { board, rngState: _rng, bag: _bag, queue: _queue, garbage: _garbage, canHold: _hold, fallElapsed: _fall, lockElapsed: _lock, ...rest } = snapshot;
  return { ...rest, board: decodeBoard(board) };
}
