import { BlockEngine } from "./game/engine";
import { SeededRandom } from "./game/random";
import type { Command, GameEvent, LaneCount, NetworkSnapshot } from "./game/types";

interface PlayerSimulation {
  engine: BlockEngine;
  lastInput: number;
}

export interface AuthorityEvent {
  playerId: string;
  event: GameEvent;
}
export interface AuthorityAttack { id: number; targetId: string; holes: number[] }

export class ArenaAuthority {
  private simulations = new Map<string, PlayerSimulation>();
  private events: AuthorityEvent[] = [];
  private attacks: AuthorityAttack[] = [];
  private attackId = 0;
  private random: SeededRandom;
  private didEnd = false;
  private startedWith: number;
  winnerId?: string;

  constructor(readonly playerIds: string[], seed: number, lanesOrLocal: LaneCount | { id: string; engine: BlockEngine } = 10, localArg?: { id: string; engine: BlockEngine }) {
    const lanes = typeof lanesOrLocal === "number" ? lanesOrLocal : 10;
    const local = typeof lanesOrLocal === "number" ? localArg : lanesOrLocal;
    this.random = new SeededRandom(seed ^ 0xa511e9b3);
    this.startedWith = playerIds.length;
    for (const id of playerIds.slice(0, 8)) {
      const engine = local?.id === id ? local.engine : new BlockEngine(seed, lanes);
      engine.reset(seed, lanes);
      this.simulations.set(id, { engine, lastInput: 0 });
    }
  }

  get ended(): boolean { return this.didEnd; }

  tick(deltaMs: number): void {
    if (this.didEnd) return;
    for (const [id, simulation] of this.simulations) {
      simulation.engine.tick(deltaMs);
      this.collect(id, simulation.engine);
    }
    this.checkWinner();
  }

  input(playerId: string, sequence: number, command: Command): boolean {
    const simulation = this.simulations.get(playerId);
    if (!simulation || this.didEnd || sequence <= simulation.lastInput) return false;
    simulation.lastInput = sequence;
    const applied = simulation.engine.command(command);
    this.collect(playerId, simulation.engine);
    this.checkWinner();
    return applied;
  }

  remove(playerId: string): void {
    this.simulations.delete(playerId);
    this.checkWinner();
  }

  engine(playerId: string): BlockEngine | undefined {
    return this.simulations.get(playerId)?.engine;
  }

  snapshots(): Record<string, NetworkSnapshot> {
    return Object.fromEntries([...this.simulations].map(([id, simulation]) => [id, simulation.engine.networkSnapshot()]));
  }

  scores(): Record<string, number> {
    return Object.fromEntries([...this.simulations].map(([id, simulation]) => [id, simulation.engine.score]));
  }

  drainEvents(): AuthorityEvent[] {
    return this.events.splice(0);
  }
  drainAttacks(): AuthorityAttack[] { return this.attacks.splice(0); }

  private collect(playerId: string, engine: BlockEngine): void {
    for (const event of engine.drainEvents()) {
      this.events.push({ playerId, event });
      if (event.type === "clear") this.attack(playerId, event.count ?? 0);
    }
  }

  private attack(sourceId: string, cleared: number): void {
    const amount = cleared === 2 ? 1 : cleared === 3 ? 2 : cleared >= 4 ? 4 : 0;
    if (!amount) return;
    const alive = this.playerIds.filter((id) => id !== sourceId && this.simulations.get(id)?.engine.phase !== "game-over");
    if (alive.length === 0) return;
    const sourceIndex = this.playerIds.indexOf(sourceId);
    const target = alive.sort((a, b) => {
      const distanceA = (this.playerIds.indexOf(a) - sourceIndex + this.playerIds.length) % this.playerIds.length;
      const distanceB = (this.playerIds.indexOf(b) - sourceIndex + this.playerIds.length) % this.playerIds.length;
      return distanceA - distanceB;
    })[0]!;
    const holes = Array.from({ length: amount }, () => Math.floor(this.random.next() * 10));
    this.simulations.get(target)?.engine.queueGarbage(amount, holes);
    this.attackId += 1;
    this.attacks.push({ id: this.attackId, targetId: target, holes });
  }

  private checkWinner(): void {
    if (this.didEnd || this.startedWith < 2) return;
    const alive = [...this.simulations].filter(([, simulation]) => simulation.engine.phase !== "game-over");
    if (alive.length > 1) return;
    this.didEnd = true;
    this.winnerId = alive[0]?.[0];
  }
}
