import type { GameEvent, LaneCount } from "./game/types";

export interface PlayerInfo { name: string; avatar: string }

export interface ArenaCallbacks {
  mode(active: boolean): void;
  event(playerId: string, event: GameEvent): void;
  countdown(seconds: number): void;
  roundStart(): void;
  roundEnd(winnerId: string | undefined, scores: Record<string, number>): void;
  waiting(): void;
  connection(state: string): void;
  error(message: string): void;
}

export interface CountdownMessage {
  roundId: number;
  startAt: number;
  seed: number;
  players: string[];
  lanes?: LaneCount;
}

export interface ArenaStartMessage extends CountdownMessage {
  targetId?: string;
}
