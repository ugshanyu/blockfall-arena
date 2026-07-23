import { decodeBoard, encodeBoard } from "./codec";
import { addGarbageRows, collides, emptyBoard, fullRows, ghostY, lockPiece, removeRows } from "./board";
import { kicks, PIECES } from "./pieces";
import { SeededRandom } from "./random";
import { classicGravity } from "../classic-rules";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  type ActivePiece,
  type Cell,
  type Command,
  type GameEvent,
  type GamePhase,
  type GameSnapshot,
  parseLaneCount, type NetworkSnapshot, type LaneCount,
  type PieceType
} from "./types";

const CLEAR_MS = 230;
const LOCK_MS = 420;
const SCORES = [0, 100, 300, 500, 800];
export class BlockEngine {
  private board = emptyBoard();
  private active: ActivePiece | null = null;
  private holdPiece: PieceType | null = null;
  private canHold = true;
  private queue: PieceType[] = [];
  private bag: PieceType[] = [];
  private random: SeededRandom;
  private fallElapsed = 0;
  private lockElapsed = 0;
  private clearElapsed = 0;
  private clearRows: number[] = [];
  private garbageHoles: number[] = [];
  private events: GameEvent[] = [];
  private eventId = 0;
  private seed: number;
  private roundElapsed = 0;
  private classicArena = false;
  private combo = 0;

  score = 0;
  lines = 0;
  level = 1;
  phase: GamePhase = "playing";
  lanes: LaneCount;
  constructor(seed = Date.now(), lanes: LaneCount = 10) {
    this.lanes = lanes;
    this.seed = seed >>> 0;
    this.random = new SeededRandom(this.seed);
    this.reset(this.seed);
  }

  reset(seed = this.seed, lanes: LaneCount = this.lanes, classicArena = false): void {
    this.lanes = lanes;
    this.classicArena = classicArena;
    this.roundElapsed = 0;
    this.seed = seed >>> 0;
    this.random = new SeededRandom(this.seed);
    this.board = emptyBoard();
    this.active = null;
    this.holdPiece = null;
    this.canHold = true;
    this.queue = [];
    this.bag = [];
    this.garbageHoles = [];
    this.events = [];
    this.eventId = 0;
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.phase = "playing";
    this.fallElapsed = 0;
    this.lockElapsed = 0;
    this.clearElapsed = 0;
    this.clearRows = [];
    this.combo = 0;
    this.fillQueue();
    this.spawn();
  }

  tick(deltaMs: number): void {
    const dt = Math.min(100, Math.max(0, deltaMs));
    if (this.phase === "playing" || this.phase === "clearing") this.roundElapsed += dt;
    if (this.phase === "clearing") {
      this.clearElapsed += dt;
      if (this.clearElapsed >= CLEAR_MS) this.finishClear();
      return;
    }
    if (this.phase !== "playing" || !this.active) return;
    this.fallElapsed += dt;
    const interval = this.classicArena
      ? 1000 / (60 * classicGravity(this.roundElapsed))
      : Math.max(72, 820 * Math.pow(0.84, this.level - 1));
    while (this.fallElapsed >= interval && this.phase === "playing") {
      this.fallElapsed -= interval;
      if (!this.move(0, 1)) break;
    }
    if (!this.active || this.phase !== "playing") return;
    if (collides(this.board, { ...this.active, y: this.active.y + 1 }, this.lanes)) {
      this.lockElapsed += dt;
      if (this.lockElapsed >= LOCK_MS) this.lock();
    } else this.lockElapsed = 0;
  }

  command(command: Command): boolean {
    if (this.phase !== "playing" || !this.active) return false;
    if (command === "left") return this.move(-1, 0);
    if (command === "right") return this.move(1, 0);
    if (command === "soft-drop") {
      const moved = this.move(0, 1);
      if (moved) this.score += 1;
      return moved;
    }
    if (command === "rotate-cw") return this.rotate(1);
    if (command === "rotate-ccw") return this.rotate(-1);
    if (command === "hard-drop") return this.hardDrop();
    if (command === "hold") return this.hold();
    return false;
  }

  pause(): void {
    if (this.phase === "playing") this.phase = "paused";
  }

  resume(): void {
    if (this.phase === "paused") this.phase = "playing";
  }

  queueGarbage(count: number, holes?: number[]): void {
    for (let i = 0; i < Math.max(0, Math.min(8, count)); i += 1) {
      const requested = holes?.[i];
      this.garbageHoles.push(requested === undefined ? Math.floor(this.random.next() * this.lanes) : requested % this.lanes);
    }
  }

  drainEvents(): GameEvent[] {
    return this.events.splice(0);
  }
  configureLanes(lanes: LaneCount): void { this.lanes = lanes; }

  snapshot(): GameSnapshot {
    return {
      lanes: this.lanes,
      board: this.board.map((row) => [...row]),
      active: this.active ? { ...this.active } : null,
      ghostY: this.active ? ghostY(this.board, this.active, this.lanes) : 0,
      hold: this.holdPiece,
      next: this.queue.slice(0, 6),
      score: this.score,
      lines: this.lines,
      level: this.level,
      phase: this.phase,
      clearRows: [...this.clearRows],
      clearProgress: this.phase === "clearing" ? Math.min(1, this.clearElapsed / CLEAR_MS) : 0,
      pendingGarbage: this.garbageHoles.length,
      eventId: this.eventId
    };
  }

  networkSnapshot(): NetworkSnapshot {
    const snapshot = this.snapshot();
    return {
      ...snapshot,
      board: encodeBoard(snapshot.board),
      rngState: this.random.state,
      bag: [...this.bag],
      queue: [...this.queue],
      garbage: [...this.garbageHoles],
      canHold: this.canHold,
      fallElapsed: this.fallElapsed,
      lockElapsed: this.lockElapsed
    };
  }

  restore(snapshot: NetworkSnapshot): void {
    this.lanes = parseLaneCount(snapshot.lanes);
    this.board = decodeBoard(snapshot.board);
    this.active = snapshot.active ? { ...snapshot.active } : null;
    this.holdPiece = snapshot.hold;
    this.queue = [...snapshot.queue];
    this.bag = [...snapshot.bag];
    this.random.state = snapshot.rngState;
    this.score = snapshot.score;
    this.lines = snapshot.lines;
    this.level = snapshot.level;
    this.phase = snapshot.phase;
    this.clearRows = [...snapshot.clearRows];
    this.clearElapsed = snapshot.clearProgress * CLEAR_MS;
    this.garbageHoles = [...snapshot.garbage];
    this.canHold = snapshot.canHold;
    this.fallElapsed = snapshot.fallElapsed;
    this.lockElapsed = snapshot.lockElapsed;
    this.eventId = snapshot.eventId;
  }

  private fillQueue(): void {
    while (this.queue.length < 6) {
      if (this.bag.length === 0) {
        this.bag = [...PIECES];
        for (let i = this.bag.length - 1; i > 0; i -= 1) {
          const j = Math.floor(this.random.next() * (i + 1));
          [this.bag[i], this.bag[j]] = [this.bag[j]!, this.bag[i]!];
        }
      }
      this.queue.push(this.bag.shift()!);
    }
  }

  private spawn(type?: PieceType, applyGarbage = true): void {
    if (applyGarbage) this.applyGarbage();
    if (this.phase === "game-over") return;
    this.fillQueue();
    const next = type ?? this.queue.shift()!;
    this.fillQueue();
    this.active = { type: next, rotation: 0, x: 3, y: -1 };
    this.canHold = true;
    this.fallElapsed = 0;
    this.lockElapsed = 0;
    if (collides(this.board, this.active, this.lanes)) this.endGame();
  }

  private move(dx: number, dy: number): boolean {
    if (!this.active) return false;
    const moved = { ...this.active, x: this.active.x + dx, y: this.active.y + dy };
    if (collides(this.board, moved, this.lanes)) return false;
    this.active = moved;
    if (dx !== 0) this.lockElapsed = 0;
    return true;
  }

  private rotate(direction: 1 | -1): boolean {
    if (!this.active || this.active.type === "O") return true;
    const rotation = (this.active.rotation + direction + 4) % 4;
    for (const [x, y] of kicks(this.active.type)) {
      const candidate = { ...this.active, rotation, x: this.active.x + x, y: this.active.y + y };
      if (!collides(this.board, candidate, this.lanes)) {
        this.active = candidate;
        this.lockElapsed = 0;
        return true;
      }
    }
    return false;
  }

  private hardDrop(): boolean {
    if (!this.active) return false;
    const fromY = this.active.y;
    const piece = { ...this.active };
    let distance = 0;
    while (this.move(0, 1)) distance += 1;
    this.score += distance * 2;
    this.pushEvent({ type: "hard-drop", fromY, toY: this.active.y, piece: piece.type, x: piece.x, rotation: piece.rotation });
    this.lock();
    return true;
  }

  private hold(): boolean {
    if (!this.active || !this.canHold) return false;
    const outgoing = this.active.type;
    const incoming = this.holdPiece;
    this.holdPiece = outgoing;
    this.canHold = false;
    this.active = null;
    if (incoming) this.spawn(incoming, false);
    else this.spawn(undefined, false);
    this.canHold = false;
    return true;
  }

  private lock(): void {
    if (!this.active) return;
    const toppedOut = lockPiece(this.board, this.active);
    this.active = null;
    if (toppedOut) return this.endGame();
    this.clearRows = fullRows(this.board, this.lanes);
    if (this.clearRows.length > 0) {
      this.combo += 1;
      this.phase = "clearing";
      this.clearElapsed = 0;
      this.pushEvent({ type: "clear", rows: [...this.clearRows], count: this.clearRows.length, combo: this.combo });
    } else {
      this.combo = 0;
      this.spawn();
    }
  }

  private finishClear(): void {
    const count = this.clearRows.length;
    this.board = removeRows(this.board, this.clearRows);
    this.lines += count;
    this.score += (SCORES[count] ?? 1200) * this.level;
    this.level = 1 + Math.floor(this.lines / 10);
    this.pushEvent({ type: "collapse", count });
    this.clearRows = [];
    this.clearElapsed = 0;
    this.phase = "playing";
    this.spawn();
  }

  private applyGarbage(): void {
    if (this.garbageHoles.length === 0) return;
    const holes = this.garbageHoles.splice(0);
    const result = addGarbageRows(this.board, holes, this.lanes);
    this.board = result.board;
    if (result.toppedOut) return this.endGame();
    this.pushEvent({ type: "garbage", count: holes.length });
  }

  private endGame(): void {
    this.active = null;
    this.phase = "game-over";
    this.pushEvent({ type: "game-over" });
  }

  private pushEvent(event: Omit<GameEvent, "id">): void {
    this.eventId += 1;
    this.events.push({ ...event, id: this.eventId });
  }
}
