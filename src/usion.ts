import type { Command, GameEvent, NetworkSnapshot } from "./game/types";

export interface LeaderboardEntry {
  user_id: string;
  name?: string | null;
  avatar?: string | null;
  score: number;
  rank: number;
  is_me: boolean;
}

export interface UsionConfig {
  userId?: string;
  userName?: string;
  userAvatar?: string;
  language?: string;
  theme?: "light" | "dark";
  roomId?: string;
  playerIds?: string[];
  mode?: "single" | "multiplayer";
}

export interface RealtimeMessage {
  player_id: string;
  action_type: string;
  action_data: unknown;
}

interface UsionGameApi {
  connect(): Promise<unknown>;
  join(roomId: string): Promise<Record<string, unknown>>;
  realtime(type: string, data?: unknown): void;
  onJoined(callback: (data: Record<string, unknown>) => void): () => void;
  onPlayerJoined(callback: (data: { player_id?: string; player_ids?: string[] }) => void): () => void;
  onPlayerLeft(callback: (data: { player_id?: string; player_ids?: string[] }) => void): () => void;
  onRealtime(callback: (message: RealtimeMessage) => void): () => void;
  onRoomAssigned(callback: (data: { roomId: string }) => void): () => void;
  onConnectionState(callback: (state: string) => void): () => void;
  onReconnected(callback: (info: Record<string, unknown>) => void): () => void;
  onError(callback: (error: { code?: string; message?: string }) => void): () => void;
  saveState(state: unknown): boolean;
  loadState<T>(): T | null;
}

export interface UsionApi {
  init(options?: { timeout?: number }): Promise<UsionConfig>;
  config: UsionConfig;
  getLanguage(): string;
  getTheme(): "light" | "dark";
  getLaunchParams(): { roomId?: string; mode?: "single" | "multiplayer" };
  user: { getId(): string; getName(): string; getAvatar(): string };
  storage: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<unknown> };
  leaderboard: {
    submit(score: number, metadata?: Record<string, unknown>): Promise<{ success: boolean; best: number; rank: number }>;
    friends(options?: { limit?: number }): Promise<LeaderboardEntry[]>;
    top(options?: { limit?: number }): Promise<LeaderboardEntry[]>;
    me(): Promise<{ score: number | null; rank: number | null; total: number }>;
  };
  game: UsionGameApi;
}

declare global {
  interface Window {
    Usion?: UsionApi;
    ReactNativeWebView?: { postMessage(message: string): void };
  }
}

export function isUsionHosted(framed: boolean, hasNativeBridge: boolean): boolean {
  return framed || hasNativeBridge;
}

export interface SavedRun {
  friends: LeaderboardEntry[];
  global: LeaderboardEntry[];
  best: number;
  rank?: number;
}

export class UsionBridge {
  readonly playerId: string;
  readonly playerName: string;
  readonly playerAvatar: string;
  readonly language: string;
  readonly theme: "light" | "dark";

  constructor(readonly config: UsionConfig, readonly api?: UsionApi) {
    this.playerId = api?.user.getId?.() || config.userId || "solo";
    this.playerName = api?.user.getName?.() || config.userName || "You";
    this.playerAvatar = api?.user.getAvatar?.() || config.userAvatar || "";
    this.language = api?.getLanguage?.() || config.language || navigator.language;
    this.theme = api?.getTheme?.() || config.theme || "dark";
  }

  isMultiplayer(): boolean {
    return (this.api?.getLaunchParams?.().mode ?? this.config.mode) === "multiplayer";
  }

  roomId(): string | undefined {
    return this.api?.getLaunchParams?.().roomId || this.config.roomId;
  }

  loadBest(): number {
    try { return Math.max(0, Number(localStorage.getItem("blockfall-best")) || 0); } catch { return 0; }
  }

  saveBest(score: number): void {
    try { localStorage.setItem("blockfall-best", String(score)); } catch { /* Play remains available without storage. */ }
    if (this.api) void this.api.storage.set("blockfall-best", score).catch(() => undefined);
  }

  async loadPlatformBest(): Promise<number> {
    if (!this.api?.leaderboard) return this.loadBest();
    try { return Math.max(this.loadBest(), Number((await this.api.leaderboard.me()).score) || 0); } catch { return this.loadBest(); }
  }

  async submitScore(score: number, metadata: { mode: string; lanes?: number; lines: number; level: number }): Promise<SavedRun> {
    let best = Math.max(score, this.loadBest());
    let rank: number | undefined;
    this.saveBest(best);
    if (!this.api?.leaderboard) return { friends: [], global: [], best };
    try {
      const result = await this.api.leaderboard.submit(score, metadata);
      best = Math.max(best, result.best);
      rank = result.rank;
    } catch { /* Records still load when submission is temporarily unavailable. */ }
    const [friends, global] = await Promise.all([
      this.api.leaderboard.friends({ limit: 8 }).catch(() => []),
      this.api.leaderboard.top({ limit: 10 }).catch(() => [])
    ]);
    return { friends, global, best, rank };
  }
}

export async function initializeUsion(): Promise<UsionBridge> {
  const hasNativeBridge = typeof window.ReactNativeWebView?.postMessage === "function";
  if (!isUsionHosted(window.self !== window.top, hasNativeBridge)) {
    return new UsionBridge({ language: navigator.language, theme: "dark", mode: "single" });
  }
  const api = window.Usion;
  if (!api) throw new Error("Usion SDK is unavailable");
  const config = await api.init({ timeout: 8000 });
  return new UsionBridge(config, api);
}

export interface ArenaWireInput { seq: number; command: Command }
export interface ArenaWireState { roundId: number; players: Record<string, NetworkSnapshot>; ended: boolean; winnerId?: string }
export interface ArenaWireEffect { roundId: number; playerId: string; event: GameEvent }
