import { ArenaAuthority } from "../arena-authority";
import { describe, expect, it } from "vitest";
import { decodeBoard, encodeBoard } from "./codec";
import { BlockEngine } from "./engine";
import type { Cell, NetworkSnapshot } from "./types";

function withGap(engine: BlockEngine, rowCount: number): NetworkSnapshot {
  const state = engine.networkSnapshot();
  const board = decodeBoard(state.board);
  for (let y = 20 - rowCount; y < 20; y += 1) {
    board[y] = [0, 2, 2, 2, 2, 2, 2, 2, 2, 2] as Cell[];
  }
  return {
    ...state,
    board: encodeBoard(board),
    active: { type: "I", rotation: 1, x: -2, y: 16 },
    phase: "playing",
    clearRows: [],
    clearProgress: 0
  };
}

describe("BlockEngine", () => {
  it("uses a deterministic seven-piece bag", () => {
    const first = new BlockEngine(42).networkSnapshot();
    const second = new BlockEngine(42).networkSnapshot();
    expect(first.queue).toEqual(second.queue);
    expect(first.bag).toEqual(second.bag);
    expect(new Set([first.active!.type, ...first.queue, ...first.bag])).toHaveLength(7);
  });

  it("keeps pieces inside the playfield", () => {
    const engine = new BlockEngine(9);
    for (let i = 0; i < 20; i += 1) engine.command("left");
    const piece = engine.snapshot().active!;
    expect(piece.x).toBeGreaterThanOrEqual(-2);
    expect(engine.command("hard-drop")).toBe(true);
    expect(engine.snapshot().board.flat().filter(Boolean)).toHaveLength(4);
  });

  it("moves exactly one row for a soft drop", () => {
    const engine = new BlockEngine(10);
    const before = engine.snapshot().active!.y;
    expect(engine.command("soft-drop")).toBe(true);
    expect(engine.snapshot().active!.y).toBe(before + 1);
    expect(engine.snapshot().board.flat().filter(Boolean)).toHaveLength(0);
  });

  it("holds a complete row for the clear animation before collapsing", () => {
    const engine = new BlockEngine(11);
    engine.restore(withGap(engine, 1));
    engine.command("hard-drop");
    expect(engine.phase).toBe("clearing");
    expect(engine.snapshot().clearRows).toEqual([19]);
    expect(engine.drainEvents().some((event) => event.type === "clear")).toBe(true);
    engine.tick(120);
    expect(engine.phase).toBe("clearing");
    engine.tick(120);
    expect(engine.phase).toBe("clearing");
    engine.tick(120);
    expect(engine.phase).toBe("playing");
    expect(engine.lines).toBe(1);
    expect(engine.score).toBeGreaterThanOrEqual(100);
  });

  it("marks only consecutive clears as combos", () => {
    const engine = new BlockEngine(31);
    engine.restore(withGap(engine, 1));
    engine.command("hard-drop");
    expect(engine.drainEvents().find((event) => event.type === "clear")?.combo).toBe(1);
    engine.tick(300);
    engine.restore(withGap(engine, 1));
    engine.command("hard-drop");
    expect(engine.drainEvents().find((event) => event.type === "clear")?.combo).toBe(2);
  });

  it("round-trips compact board snapshots", () => {
    const engine = new BlockEngine(73);
    engine.command("hard-drop");
    const encoded = encodeBoard(engine.snapshot().board);
    expect(encodeBoard(decodeBoard(encoded))).toBe(encoded);
    expect(encoded).toHaveLength(200);
  });

  it("lands incoming attacks at the bottom as normally clearable garbage", () => {
    const engine = new BlockEngine(17);
    engine.queueGarbage(1, [0]);
    engine.command("hard-drop");
    expect(engine.snapshot().board[19]).toEqual([0, 8, 8, 8, 8, 8, 8, 8, 8, 8]);
    expect(engine.drainEvents()).toEqual(expect.arrayContaining([expect.objectContaining({ type: "garbage", count: 1 })]));

    const state = engine.networkSnapshot();
    const board = Array.from({ length: 20 }, () => Array<Cell>(10).fill(0));
    board[19] = [0, 8, 8, 8, 8, 8, 8, 8, 8, 8];
    engine.restore({ ...state, board: encodeBoard(board), active: { type: "I", rotation: 1, x: -2, y: 16 }, phase: "playing", clearRows: [], clearProgress: 0 });
    engine.command("hard-drop");
    expect(engine.snapshot().clearRows).toEqual([19]);
    engine.tick(100);
    engine.tick(100);
    engine.tick(100);
    expect(engine.snapshot().board.flat()).not.toContain(8);
  });
});

describe("ArenaAuthority", () => {
  it("keeps four-lane simulations synchronized", () => {
    const authority = new ArenaAuthority(["host", "guest"], 22, 4);
    expect(authority.engine("host")?.snapshot().lanes).toBe(4);
    expect(authority.engine("guest")?.snapshot().lanes).toBe(4);
  });

  it("keeps eight-lane simulations synchronized", () => {
    const authority = new ArenaAuthority(["host", "guest"], 22, 8);
    expect(authority.engine("host")?.snapshot().lanes).toBe(8);
    expect(authority.engine("guest")?.snapshot().lanes).toBe(8);
  });

  it("uses one clean garbage hole throughout an arena attack", () => {
    const hostEngine = new BlockEngine(22);
    const authority = new ArenaAuthority(["host", "guest"], 22, { id: "host", engine: hostEngine });
    hostEngine.restore(withGap(hostEngine, 4));
    authority.input("host", 1, "hard-drop");
    const attack = authority.drainAttacks()[0];
    expect(new Set(attack?.holes).size).toBe(1);
  });
  it("deduplicates input and sends four garbage rows for a four-line clear", () => {
    const hostEngine = new BlockEngine(22);
    const authority = new ArenaAuthority(["host", "guest"], 22, { id: "host", engine: hostEngine });
    hostEngine.restore(withGap(hostEngine, 4));
    expect(authority.input("host", 1, "hard-drop")).toBe(true);
    expect(authority.input("host", 1, "left")).toBe(false);
    expect(authority.engine("guest")?.snapshot().pendingGarbage).toBe(4);
    const clear = authority.drainEvents().find((item) => item.playerId === "host" && item.event.type === "clear");
    expect(clear?.event.count).toBe(4);
  });

  it("keeps an eight-player state broadcast under the relay payload cap", () => {
    const players = Array.from({ length: 8 }, (_, index) => `player-${index}`);
    const authority = new ArenaAuthority(players, 91);
    const state = JSON.stringify({ roundId: 1, players: authority.snapshots(), ended: false });
    expect(Object.keys(authority.snapshots())).toHaveLength(8);
    expect(new TextEncoder().encode(state).byteLength).toBeLessThan(8192);
  });

  it("declares the remaining player after rivals leave", () => {
    const authority = new ArenaAuthority(["a", "b", "c"], 12);
    authority.remove("b");
    authority.remove("c");
    expect(authority.ended).toBe(true);
    expect(authority.winnerId).toBe("a");
  });

  it("cancels a false elimination when a current checkpoint arrives", () => {
    const authority = new ArenaAuthority(["host", "guest"], 12);
    const guest = authority.engine("guest")!;
    const live = guest.networkSnapshot();
    guest.restore({ ...live, active: null, phase: "game-over" });
    authority.tick(300);
    expect(authority.ended).toBe(false);
    expect(authority.reconcile("guest", 1, live)).toBe(true);
    authority.tick(700);
    expect(authority.ended).toBe(false);
    expect(authority.reconcile("guest", 1, { ...live, score: 999 })).toBe(false);
  });
});
