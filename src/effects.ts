import type { GameEvent } from "./game/types";

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export class AudioEffects {
  private context?: AudioContext;
  private muted = false;

  toggle(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  unlock(): void {
    if (this.muted) return;
    if (!("AudioContext" in window)) return;
    try { this.context ??= new AudioContext(); } catch { return; }
    if (this.context.state === "suspended") void this.context.resume();
  }

  move(): void {
    this.tone(110, 0.018, 0.018, "square");
  }

  rotate(): void {
    this.tone(360, 0.035, 0.025, "triangle", 80);
  }

  drop(distance = 8): void {
    this.tone(150 + Math.min(160, distance * 8), 0.08, 0.05, "sine", -80);
  }

  event(event: GameEvent): void {
    if (event.type === "clear") {
      const count = event.count ?? 1;
      [0, 4, 7, count === 4 ? 12 : 9].forEach((semi, index) => {
        window.setTimeout(() => this.tone(210 * Math.pow(2, semi / 12), 0.16, 0.06, "sine", 100), index * 30);
      });
      this.vibrate(count === 4 ? [18, 22, 28] : [12, 18]);
    } else if (event.type === "garbage") {
      this.tone(72, 0.15, 0.09, "sawtooth", -20);
      this.vibrate([24, 20, 16]);
    } else if (event.type === "game-over") {
      this.tone(180, 0.4, 0.07, "triangle", -120);
      this.vibrate(50);
    }
  }

  private tone(frequency: number, duration: number, volume: number, type: OscillatorType, glide = 0): void {
    if (this.muted) return;
    this.unlock();
    const context = this.context;
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, frequency + glide), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private vibrate(pattern: number | number[]): void {
    if (!this.muted && "vibrate" in navigator) {
      try { navigator.vibrate(pattern); } catch { /* Haptics are optional. */ }
    }
  }
}
