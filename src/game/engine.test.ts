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

  it("round-trips compact board snapshots", () => {
    const engine = new BlockEngine(73);
    engine.command("hard-drop");
    const encoded = encodeBoard(engine.snapshot().board);
    expect(encodeBoard(decodeBoard(encoded))).toBe(encoded);
    expect(encoded).toHaveLength(200);
  });
});

describe("ArenaAuthority", () => {
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
});
