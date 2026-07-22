import { cells, PIECE_ID } from "./game/pieces";
import { BOARD_HEIGHT, BOARD_WIDTH, laneStart, type Cell, type GameEvent, type GameSnapshot, type PieceType } from "./game/types";
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
  private garbageLift = 0;
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
      this.shake = 3 + (event.count ?? 1) * 1.8 + Math.max(0, (event.combo ?? 1) - 1) * 1.5;
      this.flash = 0.8;
      for (const row of this.clearRows) {
        for (let x = 0; x < BOARD_WIDTH; x += 1) {
          const color = COLORS[snapshot.board[row]?.[x] ?? 1] ?? "#fff";
          for (let n = 0; n < 2 + Math.min(2, Math.max(0, (event.combo ?? 1) - 1)); n += 1) this.spawnParticle(x * CELL + CELL / 2, row * CELL + CELL / 2, color);
        }
      }
    } else if (event.type === "collapse") this.collapseAge = 0;
    else if (event.type === "hard-drop" && event.piece) {
      this.trail = { type: event.piece, rotation: event.rotation ?? 0, x: event.x ?? 3, fromY: event.fromY ?? 0, toY: event.toY ?? 0, age: 0 };
      this.shake = 3.2;
      this.flash = Math.max(this.flash, 0.3);
      const color = COLORS[PIECE_ID[event.piece]] ?? "#fff";
      for (const [dx, dy] of cells(event.piece, event.rotation ?? 0)) {
        for (let n = 0; n < 3; n += 1) this.spawnParticle(((event.x ?? 3) + dx) * CELL + CELL / 2, ((event.toY ?? 0) + dy) * CELL + CELL / 2, color);
      }
    } else if (event.type === "garbage") {
      this.shake = 8;
      this.flash = 0.35;
      this.garbageLift = Math.min(8, event.count ?? 1) * CELL;
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
    this.drawWell(ctx, snapshot);
    this.drawBoard(ctx, snapshot);
    this.drawPendingGarbage(ctx, snapshot.pendingGarbage, now);
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
    this.garbageLift *= Math.exp(-13 * dt);
    if (this.garbageLift < 0.1) this.garbageLift = 0;
    if (this.trail) {
      this.trail.age += dt / 0.3;
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

  private drawWell(ctx: CanvasRenderingContext2D, snapshot: GameSnapshot): void {
    const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    gradient.addColorStop(0, "rgba(4,7,23,.92)");
    gradient.addColorStop(1, "rgba(8,10,29,.98)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    if (snapshot.lanes === 4) {
      const start = laneStart(4) * CELL;
      ctx.fillStyle = "rgba(1,2,10,.78)";
      ctx.fillRect(0, 0, start, HEIGHT);
      ctx.fillRect(start + 4 * CELL, 0, WIDTH - start - 4 * CELL, HEIGHT);
      ctx.strokeStyle = "rgba(255,224,122,.34)";
      ctx.strokeRect(start, 0, 4 * CELL, HEIGHT);
    }
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
        } else this.drawTile(ctx, value, x * CELL, y * CELL - offset + this.garbageLift, 1, 1);
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

  private drawPendingGarbage(ctx: CanvasRenderingContext2D, count: number, now: number): void {
    const rows = Math.min(8, count);
    if (!rows) return;
    const pulse = 0.09 + (Math.sin(now / 150) + 1) * 0.035;
    ctx.save();
    ctx.fillStyle = `rgba(255,137,96,${pulse})`;
    ctx.strokeStyle = "rgba(255,179,112,.7)";
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 6]);
    for (let index = 0; index < rows; index += 1) {
      const y = HEIGHT - (index + 1) * CELL;
      ctx.fillRect(1, y + 1, WIDTH - 2, CELL - 2);
      ctx.strokeRect(3, y + 3, WIDTH - 6, CELL - 6);
    }
    ctx.setLineDash([]);
    ctx.fillStyle = "#ffd18a";
    ctx.font = "900 15px ui-sans-serif, sans-serif";
    ctx.fillText(`▲ ${count}`, 9, HEIGHT - rows * CELL + 20);
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
    const life = 1 - this.trail.age;
    const id = PIECE_ID[this.trail.type];
    const color = COLORS[id] ?? "#fff";
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    for (const [dx, dy] of cells(this.trail.type, this.trail.rotation)) {
      const x = (this.trail.x + dx) * CELL;
      const top = Math.max(0, (this.trail.fromY + dy) * CELL);
      const landingY = (this.trail.toY + dy) * CELL;
      const bottom = landingY + CELL;
      const gradient = ctx.createLinearGradient(0, top, 0, bottom);
      gradient.addColorStop(0, "rgba(255,255,255,0)");
      gradient.addColorStop(0.45, color);
      gradient.addColorStop(1, "#fff");
      ctx.globalAlpha = life * 0.55;
      ctx.fillStyle = gradient;
      ctx.fillRect(x + 5, top, CELL - 10, Math.max(CELL, bottom - top));
      ctx.globalAlpha = Math.min(1, life * 1.35);
      this.drawTile(ctx, id, x, landingY, 1, 1);
      ctx.strokeStyle = `rgba(255,255,255,${life * 0.9})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 2, landingY + 2, CELL - 4, CELL - 4);
    }
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
    if (id === 8) {
      ctx.strokeStyle = "rgba(255,220,190,.72)";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(20, 17); ctx.lineTo(29, 29); ctx.lineTo(23, 38); ctx.lineTo(35, 48); ctx.stroke();
      ctx.fillStyle = "rgba(255,174,112,.8)";
      ctx.beginPath(); ctx.arc(44, 42, 3, 0, Math.PI * 2); ctx.fill();
    }
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

export function drawMiniBoard(canvas: HTMLCanvasElement, snapshot?: GameSnapshot): void {
  const ctx = context2d(canvas);
  const width = canvas.width;
  const cell = width / BOARD_WIDTH;
  ctx.clearRect(0, 0, width, canvas.height);
  ctx.fillStyle = "rgba(3,5,17,.9)";
  ctx.fillRect(0, 0, width, canvas.height);
  ctx.strokeStyle = "rgba(130,148,220,.08)";
  ctx.lineWidth = 0.5;
  for (let y = 1; y < BOARD_HEIGHT; y += 1) { ctx.beginPath(); ctx.moveTo(0, y * cell); ctx.lineTo(width, y * cell); ctx.stroke(); }
  if (!snapshot) return;
  if (snapshot.lanes === 4) {
    ctx.fillStyle = "rgba(1,2,10,.78)";
    ctx.fillRect(0, 0, laneStart(4) * cell, canvas.height);
    ctx.fillRect((laneStart(4) + 4) * cell, 0, laneStart(4) * cell, canvas.height);
  }
  for (let y = 0; y < BOARD_HEIGHT; y += 1) for (let x = 0; x < BOARD_WIDTH; x += 1) {
    const value = snapshot.board[y]?.[x] as Cell;
    if (!value) continue;
    ctx.fillStyle = COLORS[value] ?? "#7a8196";
    ctx.fillRect(x * cell + 0.5, y * cell + 0.5, cell - 1, cell - 1);
  }
  if (snapshot.active) {
    ctx.fillStyle = COLORS[PIECE_ID[snapshot.active.type]]!;
    for (const [dx, dy] of cells(snapshot.active.type, snapshot.active.rotation)) {
      const x = snapshot.active.x + dx;
      const y = snapshot.active.y + dy;
      if (y >= 0) ctx.fillRect(x * cell + 0.5, y * cell + 0.5, cell - 1, cell - 1);
    }
  }
  if (snapshot.pendingGarbage) {
    ctx.fillStyle = "#ff9d70";
    ctx.fillRect(0, canvas.height - Math.min(8, snapshot.pendingGarbage) * cell, 1.5, Math.min(8, snapshot.pendingGarbage) * cell);
  }
}
