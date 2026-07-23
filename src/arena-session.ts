import { ArenaAuthority } from "./arena-authority";
import type { ArenaCallbacks, ArenaStartMessage, CountdownMessage, PlayerInfo } from "./arena-types";
import { BlockEngine } from "./game/engine";
import { viewSnapshot } from "./game/network-view";
import { parseLaneCount, type Command, type GameEvent, type GameSnapshot, type LaneCount, type NetworkSnapshot } from "./game/types";
import { t } from "./i18n";
import type { ArenaWireCheckpoint, ArenaWireEffect, ArenaWireGarbage, ArenaWireInput, ArenaWireState, RealtimeMessage, UsionBridge } from "./usion";

const SOLO_DEFAULT_LANES: LaneCount = 8;
const ARENA_DEFAULT_LANES: LaneCount = 4;

export class ArenaSession {
  readonly local: BlockEngine;
  readonly players = new Map<string, PlayerInfo>();
  private remote = new Map<string, NetworkSnapshot>();
  private present = new Set<string>();
  private authority?: ArenaAuthority;
  private countdown?: CountdownMessage;
  private activeRound?: CountdownMessage;
  private roundId = 0;
  private inputSequence = 0;
  private broadcastElapsed = 0;
  private arenaMode = false;
  private roundActive = false;
  private roundEnded = false;
  private endAnnounced = false;
  private nextRoundAt = 0;
  private host = false;
  private hostId = "";
  private connected = true;
  private lastCountdownSecond = -1;
  private seenEvents = new Map<string, number>();
  private seenAttack = 0;
  private checkpointElapsed = 0;
  private checkpointSequence = 0;
  constructor(private bridge: UsionBridge, private callbacks: ArenaCallbacks) {
    this.local = new BlockEngine(Date.now(), bridge.isMultiplayer() ? ARENA_DEFAULT_LANES : SOLO_DEFAULT_LANES, true);
    this.players.set(bridge.playerId, { name: bridge.playerName, avatar: bridge.playerAvatar });
    this.present.add(bridge.playerId);
    this.hostId = (bridge.api?.config.playerIds ?? bridge.config.playerIds ?? [])[0] ?? "";
    this.host = this.hostId === bridge.playerId;
  }

  start(): void {
    const game = this.bridge.api?.game;
    if (!game) return;
    game.onJoined((data) => this.onJoined(data));
    game.onPlayerJoined((data) => this.onPlayerJoined(data.player_id, data.player_ids));
    game.onPlayerLeft((data) => this.onPlayerLeft(data.player_id, data.player_ids));
    game.onRealtime((message) => this.onRealtime(message));
    game.onRoomAssigned(() => this.promote(true));
    game.onConnectionState((state) => { this.connected = state === "connected" || state === "reconnected"; this.callbacks.connection(state); });
    game.onReconnected(() => this.sendHello());
    game.onError((error) => this.callbacks.error(error.message || error.code || "Arena error"));
    if (this.bridge.isMultiplayer()) this.promote(false);
  }
  update(deltaMs: number): void {
    if (this.countdown) {
      const remaining = Math.max(0, Math.ceil((this.countdown.startAt - Date.now()) / 1000));
      if (remaining !== this.lastCountdownSecond) {
        this.lastCountdownSecond = remaining;
        this.callbacks.countdown(remaining);
      }
      if (Date.now() >= this.countdown.startAt) {
        const message = this.countdown;
        if (this.host) this.beginRound(message);
        else this.beginGuest(message);
      }
    }
    if (!this.arenaMode) {
      this.local.tick(deltaMs);
      this.emitLocalEvents();
      return;
    }
    if (!this.roundActive) return;
    if (this.host && this.authority) {
      this.authority.tick(deltaMs);
      this.broadcastElapsed += deltaMs;
      for (const item of this.authority.drainEvents()) {
        this.emit(item.playerId, item.event);
        this.send("arena_fx", { roundId: this.roundId, playerId: item.playerId, event: item.event } satisfies ArenaWireEffect);
      }
      for (const attack of this.authority.drainAttacks()) {
        this.send("arena_garbage", { roundId: this.roundId, ...attack } satisfies ArenaWireGarbage);
      }
      if (this.broadcastElapsed >= 160 || this.authority.ended) {
        this.broadcastElapsed = 0;
        this.broadcastState();
      }
      if (this.authority.ended && !this.endAnnounced) this.finishHostRound();
    } else if (!this.host && !this.roundEnded) {
      this.local.tick(deltaMs);
      this.emitLocalEvents();
      this.checkpointElapsed += deltaMs;
      if (this.checkpointElapsed >= 150) this.sendCheckpoint();
    }
    if (this.host && this.roundEnded && this.nextRoundAt && Date.now() >= this.nextRoundAt) {
      this.authority = undefined;
      this.roundActive = false;
      this.roundEnded = false;
      this.endAnnounced = false;
      this.nextRoundAt = 0;
      this.callbacks.waiting();
    }
  }
  command(command: Command): boolean {
    if (!this.connected || this.local.phase === "game-over") return false;
    if (this.arenaMode && !this.roundActive) return false;
    this.inputSequence += 1;
    if (this.arenaMode && this.roundActive) {
      if (this.host && this.authority) return this.authority.input(this.bridge.playerId, this.inputSequence, command);
      const applied = this.local.command(command);
      this.send("arena_input", { seq: this.inputSequence, command } satisfies ArenaWireInput);
      this.emitLocalEvents();
      return applied;
    }
    const applied = this.local.command(command);
    this.emitLocalEvents();
    return applied;
  }
  restartSolo(): void {
    if (!this.arenaMode) this.local.reset(Date.now());
  }
  laneCount(): LaneCount { return this.local.lanes; }
  setLanes(lanes: LaneCount): boolean {
    if (this.roundActive || (this.arenaMode && !this.host)) return false;
    if (this.arenaMode) {
      this.local.configureLanes(lanes);
      this.send("arena_rules", { lanes });
    } else this.local.reset(Date.now(), lanes);
    return true;
  }
  startArena(): boolean {
    if (!this.arenaMode || !this.host || this.roundActive || this.countdown || this.present.size < 2) return false;
    this.scheduleCountdown(2200);
    return true;
  }

  isArena(): boolean { return this.arenaMode; }
  isWaiting(): boolean { return this.arenaMode && !this.countdown && !this.roundActive; }
  isRoundActive(): boolean { return this.roundActive && !this.roundEnded; }
  isHost(): boolean { return this.host; }
  playerCount(): number { return this.present.size; }
  readyOpponentIds(): string[] { return [...this.present].filter((id) => id !== this.bridge.playerId); }
  snapshot(): GameSnapshot {
    const snapshot = this.local.snapshot();
    if (!this.arenaMode || this.roundActive) return snapshot;
    return { ...snapshot, board: snapshot.board.map((row) => row.map(() => 0)), active: null, ghostY: 0, hold: null, next: [], score: 0, lines: 0, level: 1, phase: "paused" };
  }
  opponents(): Map<string, GameSnapshot> {
    const result = new Map<string, GameSnapshot>();
    const snapshots = this.host && this.authority ? this.authority.snapshots() : Object.fromEntries(this.remote);
    for (const [id, snapshot] of Object.entries(snapshots)) if (id !== this.bridge.playerId) result.set(id, viewSnapshot(snapshot));
    return result;
  }
  private promote(alreadyJoining: boolean): void {
    if (!this.arenaMode) {
      this.arenaMode = true;
      this.local.reset(Date.now(), ARENA_DEFAULT_LANES);
      this.callbacks.mode(true);
    }
    const roster = this.bridge.api?.config.playerIds ?? this.bridge.config.playerIds ?? [];
    if (alreadyJoining) this.hostId = this.bridge.playerId;
    else if (!this.hostId) this.hostId = roster[0] ?? "";
    this.host = this.hostId === this.bridge.playerId;
    if (alreadyJoining) return;
    const roomId = this.bridge.roomId();
    if (!roomId || !this.bridge.api) return this.callbacks.error("Arena room is unavailable");
    void this.bridge.api.game.connect()
      .then(() => this.bridge.api!.game.join(roomId))
      .catch((error: unknown) => this.callbacks.error(error instanceof Error ? error.message : "Could not join arena"));
  }
  private onJoined(data: Record<string, unknown>): void {
    this.present.add(this.bridge.playerId);
    const ids = Array.isArray(data.player_ids) ? data.player_ids.map(String) : [];
    if (!this.hostId && ids[0]) this.hostId = ids[0];
    this.host = this.hostId === this.bridge.playerId;
    this.sendHello();
  }
  private onPlayerJoined(playerId?: string, roster?: string[]): void {
    if (!this.hostId && roster?.[0]) this.hostId = roster[0];
    this.host = this.hostId === this.bridge.playerId;
    // A chat-card tap joins the socket before the friend's iframe is ready.
    // Only arena_hello marks a player ready, otherwise the countdown can be lost.
    this.sendHello();
  }
  private onPlayerLeft(playerId?: string, roster?: string[]): void {
    if (playerId) { this.present.delete(String(playerId)); this.remote.delete(String(playerId)); this.authority?.remove(String(playerId)); }
    if (playerId === this.hostId && this.bridge.playerId !== this.hostId) {
      this.callbacks.error(t("hostLeft"));
      if (this.roundActive && !this.roundEnded) {
        this.roundEnded = true;
        this.callbacks.roundEnd(undefined, { [this.bridge.playerId]: this.local.score });
      }
    }
    void roster;
  }
  private onRealtime(message: RealtimeMessage): void {
    const data = message.action_data as Record<string, unknown> | undefined;
    if (!data) return;
    if (message.action_type === "arena_hello") {
      this.present.add(message.player_id);
      this.players.set(message.player_id, { name: String(data.name || "Player"), avatar: String(data.avatar || "") });
      if (this.host) {
        this.sendRoster();
        this.send("arena_rules", { lanes: this.local.lanes });
        if (this.roundActive && this.activeRound) {
          this.send("arena_start", { ...this.activeRound, targetId: message.player_id } satisfies ArenaStartMessage);
        } else {
          this.refreshCountdown();
        }
      }
    } else if (message.action_type === "arena_roster") this.receiveRoster(data);
    else if (message.action_type === "arena_rules" && !this.host && !this.roundActive && message.player_id === this.hostId) {
      this.local.configureLanes(parseLaneCount(data.lanes));
    }
    else if (message.action_type === "arena_garbage" && !this.host) this.receiveGarbage(data as unknown as ArenaWireGarbage);
    else if (message.action_type === "arena_countdown") this.receiveCountdown(data as unknown as CountdownMessage);
    else if (message.action_type === "arena_start" && !this.host) {
      const start = data as unknown as ArenaStartMessage;
      if (!start.targetId || start.targetId === this.bridge.playerId) this.beginGuest(start);
    }
    else if (message.action_type === "arena_input" && this.host && this.authority) {
      const input = data as unknown as ArenaWireInput;
      this.authority.input(message.player_id, Number(input.seq), input.command);
    } else if (message.action_type === "arena_checkpoint" && this.host && this.authority) {
      const checkpoint = data as unknown as ArenaWireCheckpoint;
      if (checkpoint.roundId === this.roundId) this.authority.reconcile(message.player_id, Number(checkpoint.seq), checkpoint.snapshot);
    } else if (message.action_type === "arena_state" && !this.host) this.receiveState(data as unknown as ArenaWireState);
    else if (message.action_type === "arena_fx") {
      const effect = data as unknown as ArenaWireEffect;
      if (effect.roundId === this.roundId) this.emit(effect.playerId, effect.event);
    } else if (message.action_type === "arena_end") this.receiveEnd(data);
  }
  private scheduleCountdown(delay: number): void {
    const players = [...this.present].slice(0, 8);
    if (players.length < 2) return;
    this.countdown = { roundId: this.roundId + 1, startAt: Date.now() + delay, seed: (Date.now() ^ (this.roundId + 1) * 2654435761) >>> 0, players, lanes: this.local.lanes };
    this.lastCountdownSecond = -1;
    this.send("arena_countdown", this.countdown);
  }
  private refreshCountdown(): void {
    if (!this.countdown || this.roundActive) return;
    this.countdown.players = [...this.present].slice(0, 8);
    this.send("arena_countdown", this.countdown);
  }
  private receiveCountdown(message: CountdownMessage): void {
    if (!message.players?.includes(this.bridge.playerId)) return;
    this.countdown = { ...message, lanes: parseLaneCount(message.lanes) };
    this.roundEnded = false;
  }
  private beginRound(message: CountdownMessage): void {
    this.roundId = message.roundId;
    this.countdown = undefined;
    this.lastCountdownSecond = -1;
    this.roundActive = true;
    this.roundEnded = false;
    this.activeRound = message;
    this.inputSequence = 0;
    this.seenEvents.clear();
    this.seenAttack = 0;
    this.checkpointElapsed = 0;
    this.checkpointSequence = 0;
    const lanes = parseLaneCount(message.lanes);
    this.authority = new ArenaAuthority(message.players, message.seed, lanes, { id: this.bridge.playerId, engine: this.local });
    this.send("arena_start", message);
    this.callbacks.roundStart();
  }
  private beginGuest(message: CountdownMessage): void {
    if (!message.players.includes(this.bridge.playerId) || message.roundId < this.roundId) return;
    this.roundId = message.roundId;
    this.countdown = undefined;
    this.lastCountdownSecond = -1;
    this.roundActive = true;
    this.roundEnded = false;
    this.activeRound = message;
    this.inputSequence = 0;
    this.seenEvents.clear();
    this.seenAttack = 0;
    this.checkpointElapsed = 0;
    this.checkpointSequence = 0;
    this.local.reset(message.seed, parseLaneCount(message.lanes), true);
    this.callbacks.roundStart();
  }
  private broadcastState(): void {
    if (!this.authority) return;
    const state: ArenaWireState = { roundId: this.roundId, players: this.authority.snapshots(), ended: this.authority.ended, winnerId: this.authority.winnerId };
    this.send("arena_state", state);
    this.remote = new Map(Object.entries(state.players).filter(([id]) => id !== this.bridge.playerId));
  }

  private receiveState(state: ArenaWireState): void {
    if (state.roundId !== this.roundId) return;
    // The guest simulates its own inputs immediately. Restoring a delayed host
    // snapshot here visibly rolls the active piece backward on every packet.
    this.remote = new Map(Object.entries(state.players).filter(([id]) => id !== this.bridge.playerId));
    if (state.ended && !this.roundEnded) this.receiveEnd({ winnerId: state.winnerId, scores: Object.fromEntries(Object.entries(state.players).map(([id, item]) => [id, item.score])) });
  }

  private receiveGarbage(attack: ArenaWireGarbage): void {
    if (attack.roundId !== this.roundId || attack.targetId !== this.bridge.playerId || attack.id <= this.seenAttack) return;
    this.seenAttack = attack.id;
    this.local.queueGarbage(attack.holes.length, attack.holes);
  }

  private sendCheckpoint(): void {
    this.checkpointElapsed = 0;
    this.checkpointSequence += 1;
    this.send("arena_checkpoint", { roundId: this.roundId, seq: this.checkpointSequence, snapshot: this.local.networkSnapshot() } satisfies ArenaWireCheckpoint);
  }

  private finishHostRound(): void {
    if (!this.authority) return;
    this.endAnnounced = true;
    this.roundEnded = true;
    this.nextRoundAt = Date.now() + 8000;
    const data = { winnerId: this.authority.winnerId, scores: this.authority.scores(), nextAt: this.nextRoundAt };
    this.send("arena_end", data);
    this.callbacks.roundEnd(data.winnerId, data.scores);
  }

  private receiveEnd(data: Record<string, unknown>): void {
    if (this.roundEnded) return;
    this.roundEnded = true;
    this.roundActive = true;
    this.nextRoundAt = Number(data.nextAt) || 0;
    this.callbacks.roundEnd(data.winnerId ? String(data.winnerId) : undefined, (data.scores ?? {}) as Record<string, number>);
  }

  private sendHello(): void { this.send("arena_hello", { name: this.bridge.playerName, avatar: this.bridge.playerAvatar }); }

  private sendRoster(): void {
    this.send("arena_roster", { ids: [...this.present], players: Object.fromEntries(this.players) });
  }

  private receiveRoster(data: Record<string, unknown>): void {
    if (Array.isArray(data.ids)) this.present = new Set(data.ids.map(String));
    if (data.players && typeof data.players === "object") for (const [id, value] of Object.entries(data.players)) {
      const item = value as PlayerInfo;
      this.players.set(id, { name: String(item.name || "Player"), avatar: String(item.avatar || "") });
    }
  }

  private emitLocalEvents(): void { for (const event of this.local.drainEvents()) this.emit(this.bridge.playerId, event); }

  private emit(playerId: string, event: GameEvent): void {
    if ((this.seenEvents.get(playerId) ?? 0) >= event.id) return;
    this.seenEvents.set(playerId, event.id);
    this.callbacks.event(playerId, event);
  }

  private send(type: string, data: unknown): void { if (this.arenaMode) this.bridge.api?.game.realtime(type, data); }
}
