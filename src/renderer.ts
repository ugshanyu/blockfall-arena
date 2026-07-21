import { cells, PIECE_ID } from "./game/pieces";
import { BOARD_HEIGHT, BOARD_WIDTH, type Cell, type GameEvent, type GameSnapshot, type PieceType } from "./game/types";
import type { Particle } from "./effects";

const WIDTH = 300;
const HEIGHT = 600;
const CELL = WIDTH / BOARD_WIDTH;
const COLORS = ["", "#42ddff", "#ffd95d", "#c98cff", "#55e6a5", "#ff647c", "#6f8cff", "#ff9d54", "#737b96"];

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable");
  return context;
}

export class GameRenderer {
  private ctx: CanvasRenderingContext2D;
  private tiles = new Map<number, HTMLCanvasElement>();
  private particles: Particle[] = [];
  private visual?: { type: PieceType; rotation: number; x: number; y: number };
  private lastTime = performance.now();
  private shake = 0;
  private flash = 0;
  private clearRows: number[] = [];
  private collapseAge = 1;
  private trail?: { type: PieceType; rotation: number; x: number; fromY: number; toY: number; age: number };

  constructor(private canvas: HTMLCanvasElement, private holdCanvas: HTMLCanvasElement, private nextCanvas: HTMLCanvasElement) {
    this.ctx = context2d(canvas);
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  effect(event: GameEvent, snapshot: GameSnapshot): void {
    if (event.type === "clear") {
      this.clearRows = [...(event.rows ?? [])];
      this.shake = 3 + (event.count ?? 1) * 1.8;
      this.flash = 0.8;
      for (const row of this.clearRows) {
        for (let x = 0; x < BOARD_WIDTH; x += 1) {
          const color = COLORS[snapshot.board[row]?.[x] ?? 1] ?? "#fff";
          for (let n = 0; n < 2; n += 1) this.spawnParticle(x * CELL + CELL / 2, row * CELL + CELL / 2, color);
        }
      }
    } else if (event.type === "collapse") this.collapseAge = 0;
    else if (event.type === "hard-drop" && event.piece) {
      this.trail = { type: event.piece, rotation: event.rotation ?? 0, x: event.x ?? 3, fromY: event.fromY ?? 0, toY: event.toY ?? 0, age: 0 };
      this.shake = 2.2;
    } else if (event.type === "garbage") {
      this.shake = 8;
      this.flash = 0.35;
    }
  }

  render(snapshot: GameSnapshot, now = performance.now()): void {
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.update(dt);
    const ctx = this.ctx;
    const sx = this.shake > 0.2 ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake > 0.2 ? (Math.random() - 0.5) * this.shake : 0;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.save();
    ctx.translate(sx, sy);
    this.drawWell(ctx);
    this.drawBoard(ctx, snapshot);
    this.drawGhost(ctx, snapshot);
    this.drawActive(ctx, snapshot, dt);
    this.drawTrail(ctx);
    this.drawParticles(ctx);
    if (this.flash > 0.01) {
      ctx.fillStyle = `rgba(220,235,255,${this.flash * 0.17})`;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
    ctx.restore();
    this.drawPreview(this.holdCanvas, snapshot.hold ? [snapshot.hold] : []);
    this.drawPreview(this.nextCanvas, snapshot.next.slice(0, 3));
  }

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = WIDTH * dpr;
    this.canvas.height = HEIGHT * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.tiles.clear();
  }

  private update(dt: number): void {
    this.shake *= Math.exp(-18 * dt);
    this.flash *= Math.exp(-9 * dt);
    this.collapseAge = Math.min(1, this.collapseAge + dt / 0.26);
    if (this.trail) {
      this.trail.age += dt / 0.22;
      if (this.trail.age >= 1) this.trail = undefined;
    }
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 260 * dt;
      p.vx *= Math.exp(-2.8 * dt);
    }
    this.particles = this.particles.filter((p) => p.life > 0).slice(-140);
  }

  private drawWell(ctx: CanvasRenderingContext2D): void {
    const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    gradient.addColorStop(0, "rgba(4,7,23,.92)");
    gradient.addColorStop(1, "rgba(8,10,29,.98)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.strokeStyle = "rgba(132,151,230,.07)";
    ctx.lineWidth = 1;
    for (let x = 1; x < BOARD_WIDTH; x += 1) { ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, HEIGHT); ctx.stroke(); }
    for (let y = 1; y < BOARD_HEIGHT; y += 1) { ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(WIDTH, y * CELL); ctx.stroke(); }
  }

  private drawBoard(ctx: CanvasRenderingContext2D, snapshot: GameSnapshot): void {
    for (let y = 0; y < BOARD_HEIGHT; y += 1) {
      const clearing = snapshot.clearRows.includes(y);
      const offset = this.collapseOffset(y) * (1 - this.easeOut(this.collapseAge));
      for (let x = 0; x < BOARD_WIDTH; x += 1) {
        const value = snapshot.board[y]?.[x] ?? 0;
        if (!value) continue;
        if (clearing) {
          const scale = Math.max(0.08, 1 - snapshot.clearProgress * 0.9);
          this.drawTile(ctx, value, x * CELL + CELL * (1 - scale) / 2, y * CELL + CELL * (1 - scale) / 2, scale, 1 - snapshot.clearProgress * 0.75);
        } else this.drawTile(ctx, value, x * CELL, y * CELL - offset, 1, 1);
      }
    }
    if (snapshot.phase === "clearing") {
      const reach = Math.sin(snapshot.clearProgress * Math.PI) * WIDTH * 0.55;
      ctx.fillStyle = `rgba(255,255,255,${Math.sin(snapshot.clearProgress * Math.PI) * 0.65})`;
      for (const row of snapshot.clearRows) ctx.fillRect(WIDTH / 2 - reach, row * CELL + CELL * 0.42, reach * 2, CELL * 0.16);
    }
  }

  private drawGhost(ctx: CanvasRenderingContext2D, snapshot: GameSnapshot): void {
    if (!snapshot.active) return;
    ctx.save();
    ctx.globalAlpha = 0.23;
    for (const [dx, dy] of cells(snapshot.active.type, snapshot.active.rotation)) this.drawTile(ctx, PIECE_ID[snapshot.active.type], (snapshot.active.x + dx) * CELL, (snapshot.ghostY + dy) * CELL, 0.88, 0.7);
    ctx.restore();
  }

  private drawActive(ctx: CanvasRenderingContext2D, snapshot: GameSnapshot, dt: number): void {
    if (!snapshot.active) { this.visual = undefined; return; }
    if (!this.visual || this.visual.type !== snapshot.active.type || this.visual.rotation !== snapshot.active.rotation) this.visual = { ...snapshot.active };
    const blend = 1 - Math.exp(-28 * dt);
    this.visual.x += (snapshot.active.x - this.visual.x) * blend;
    this.visual.y += (snapshot.active.y - this.visual.y) * blend;
    this.visual.rotation = snapshot.active.rotation;
    for (const [dx, dy] of cells(snapshot.active.type, snapshot.active.rotation)) this.drawTile(ctx, PIECE_ID[snapshot.active.type], (this.visual.x + dx) * CELL, (this.visual.y + dy) * CELL, 1, 1);
  }

  private drawTrail(ctx: CanvasRenderingContext2D): void {
    if (!this.trail) return;
    const alpha = (1 - this.trail.age) * 0.22;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = COLORS[PIECE_ID[this.trail.type]]!;
    for (const [dx, dy] of cells(this.trail.type, this.trail.rotation)) ctx.fillRect((this.trail.x + dx) * CELL + 5, (this.trail.fromY + dy) * CELL, CELL - 10, (this.trail.toY - this.trail.fromY + 1) * CELL);
    ctx.restore();
  }

  private drawTile(ctx: CanvasRenderingContext2D, id: number, x: number, y: number, scale: number, alpha: number): void {
    const tile = this.tile(id);
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.drawImage(tile, x + 1, y + 1, (CELL - 2) * scale, (CELL - 2) * scale);
    ctx.restore();
  }

  private tile(id: number): HTMLCanvasElement {
    const cached = this.tiles.get(id);
    if (cached) return cached;
    const tile = document.createElement("canvas");
    tile.width = tile.height = 60;
    const ctx = context2d(tile);
    const gradient = ctx.createLinearGradient(0, 0, 60, 60);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.13, COLORS[id] ?? "#80889e");
    gradient.addColorStop(1, "#11162d");
    ctx.fillStyle = gradient;
    ctx.beginPath(); ctx.roundRect(2, 2, 56, 56, 11); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.32)"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.2)"; ctx.beginPath(); ctx.roundRect(9, 8, 40, 12, 6); ctx.fill();
    this.tiles.set(id, tile);
    return tile;
  }

  private drawPreview(canvas: HTMLCanvasElement, pieces: PieceType[]): void {
    const ctx = context2d(canvas);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach((piece, index) => {
      for (const [x, y] of cells(piece, 0)) ctx.drawImage(this.tile(PIECE_ID[piece]), 10 + x * 17, 5 + index * 70 + y * 17, 16, 16);
    });
  }

  private spawnParticle(x: number, y: number, color: string): void {
    const angle = Math.random() * Math.PI * 2;
    const speed = 70 + Math.random() * 150;
    this.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 35, life: 0.45 + Math.random() * 0.35, maxLife: 0.8, color, size: 2 + Math.random() * 4 });
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  private collapseOffset(y: number): number {
    for (let offset = this.clearRows.length; offset > 0; offset -= 1) {
      const oldY = y - offset;
      if (this.clearRows.filter((row) => row > oldY).length === offset) return offset * CELL;
    }
    return 0;
  }

  private easeOut(value: number): number { return 1 - Math.pow(1 - value, 3); }
}

export function drawMiniBoard(canvas: HTMLCanvasElement, snapshot: GameSnapshot): void {
  const ctx = context2d(canvas);
  const width = canvas.width;
  const cell = width / BOARD_WIDTH;
  ctx.clearRect(0, 0, width, canvas.height);
  ctx.fillStyle = "rgba(3,5,17,.9)";
  ctx.fillRect(0, 0, width, canvas.height);
  for (let y = 0; y < BOARD_HEIGHT; y += 1) for (let x = 0; x < BOARD_WIDTH; x += 1) {
    const value = snapshot.board[y]?.[x] as Cell;
    if (!value) continue;
    ctx.fillStyle = COLORS[value] ?? "#7a8196";
    ctx.fillRect(x * cell + 0.5, y * cell + 0.5, cell - 1, cell - 1);
  }
}
