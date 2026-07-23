import { afterEach, describe, expect, it, vi } from "vitest";
import { ArenaSession } from "./arena-session";
import { initializeUsion, UsionBridge, type UsionApi } from "./usion";

function mockPlatform(mode: "single" | "multiplayer" = "multiplayer", playerId = "host") {
  const handlers: Record<string, (data: never) => void> = {};
  const game = {
    connect: vi.fn(async () => ({})),
    join: vi.fn(async () => ({ player_id: playerId, player_ids: ["host", "guest"] })),
    realtime: vi.fn(),
    onJoined: vi.fn((callback) => { handlers.joined = callback; return () => undefined; }),
    onPlayerJoined: vi.fn((callback) => { handlers.playerJoined = callback; return () => undefined; }),
    onPlayerLeft: vi.fn((callback) => { handlers.playerLeft = callback; return () => undefined; }),
    onRealtime: vi.fn((callback) => { handlers.realtime = callback; return () => undefined; }),
    onRoomAssigned: vi.fn((callback) => { handlers.roomAssigned = callback; return () => undefined; }),
    onConnectionState: vi.fn((callback) => { handlers.connection = callback; return () => undefined; }),
    onReconnected: vi.fn((callback) => { handlers.reconnected = callback; return () => undefined; }),
    onError: vi.fn((callback) => { handlers.error = callback; return () => undefined; }),
    saveState: vi.fn(() => true),
    loadState: vi.fn(() => null)
  };
  const api = {
    config: { userId: playerId, userName: playerId === "host" ? "Host" : "Guest", language: "en", theme: "dark", roomId: "room-1", playerIds: ["host", "guest"], mode },
    init: vi.fn(), getLanguage: () => "en", getTheme: () => "dark", getLaunchParams: () => ({ roomId: "room-1", mode }),
    user: { getId: () => playerId, getName: () => playerId === "host" ? "Host" : "Guest", getAvatar: () => "" },
    storage: { get: vi.fn(), set: vi.fn() },
    leaderboard: { submit: vi.fn(), friends: vi.fn(), top: vi.fn(), me: vi.fn() },
    game
  } as unknown as UsionApi;
  return { api, game, handlers };
}

function callbacks() {
  return { mode: vi.fn(), event: vi.fn(), countdown: vi.fn(), roundStart: vi.fn(), roundEnd: vi.fn(), waiting: vi.fn(), connection: vi.fn(), error: vi.fn() };
}

afterEach(() => vi.unstubAllGlobals());

describe("ArenaSession platform lifecycle", () => {
  it("starts solo with eight lanes and multiplayer waiting rooms with four lanes", () => {
    const solo = mockPlatform("single", "host");
    const soloSession = new ArenaSession(new UsionBridge(solo.api.config, solo.api), callbacks());
    expect(soloSession.laneCount()).toBe(8);

    const arena = mockPlatform("multiplayer", "host");
    const arenaSession = new ArenaSession(new UsionBridge(arena.api.config, arena.api), callbacks());
    expect(arenaSession.laneCount()).toBe(4);
  });

  it("initializes multiplayer inside a top-level React Native WebView", async () => {
    const platform = mockPlatform("multiplayer", "guest");
    const init = vi.fn(async () => platform.api.config);
    platform.api.init = init;
    const documentWindow = {};
    vi.stubGlobal("window", {
      self: documentWindow,
      top: documentWindow,
      ReactNativeWebView: { postMessage: vi.fn() },
      Usion: platform.api
    });
    vi.stubGlobal("navigator", { language: "en" });

    const bridge = await initializeUsion();

    expect(init).toHaveBeenCalledWith({ timeout: 8000 });
    expect(bridge.isMultiplayer()).toBe(true);
  });

  it("registers every multiplayer handler before connecting and joins the assigned room", async () => {
    const platform = mockPlatform();
    const session = new ArenaSession(new UsionBridge(platform.api.config, platform.api), callbacks());
    session.start();
    expect(platform.game.onPlayerJoined).toHaveBeenCalledOnce();
    expect(platform.game.onPlayerLeft).toHaveBeenCalledOnce();
    expect(platform.game.onRealtime).toHaveBeenCalledOnce();
    expect(platform.game.onRoomAssigned).toHaveBeenCalledOnce();
    expect(platform.game.onConnectionState).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(platform.game.join).toHaveBeenCalledWith("room-1"));
  });

  it("can promote an already-running solo game without adding an in-game room UI", () => {
    const platform = mockPlatform("single");
    const events = callbacks();
    const session = new ArenaSession(new UsionBridge(platform.api.config, platform.api), events);
    session.start();
    expect(session.isArena()).toBe(false);
    platform.handlers.roomAssigned?.({ roomId: "room-1" } as never);
    expect(session.isArena()).toBe(true);
    expect(session.laneCount()).toBe(4);
    expect(events.mode).toHaveBeenCalledWith(true);
    expect(platform.game.join).not.toHaveBeenCalled();
  });

  it("waits for the host to press Play after the friend's game is ready", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T00:00:00Z"));
    const platform = mockPlatform("multiplayer", "host");
    const session = new ArenaSession(new UsionBridge(platform.api.config, platform.api), callbacks());
    session.start();
    platform.handlers.joined?.({ player_id: "host", player_ids: ["host", "guest"] } as never);
    platform.handlers.playerJoined?.({ player_id: "guest", player_ids: ["host", "guest"] } as never);
    vi.advanceTimersByTime(3000);
    session.update(3000);
    expect(session.isRoundActive()).toBe(false);
    expect(platform.game.realtime).not.toHaveBeenCalledWith("arena_countdown", expect.anything());

    platform.handlers.realtime?.({
      player_id: "guest",
      action_type: "arena_hello",
      action_data: { name: "Guest", avatar: "" }
    } as never);
    expect(platform.game.realtime).not.toHaveBeenCalledWith("arena_countdown", expect.anything());
    expect(session.startArena()).toBe(true);
    expect(platform.game.realtime).toHaveBeenCalledWith("arena_countdown", expect.objectContaining({
      roundId: 1, players: ["host", "guest"]
    }));

    vi.advanceTimersByTime(3000);
    session.update(3000);
    expect(session.isRoundActive()).toBe(true);
    vi.useRealTimers();
  });

  it("freezes input while waiting and exposes ready rivals for mini boards", () => {
    const platform = mockPlatform("multiplayer", "host");
    const session = new ArenaSession(new UsionBridge(platform.api.config, platform.api), callbacks());
    session.start();
    const x = session.snapshot().active?.x;
    expect(session.isWaiting()).toBe(true);
    expect(session.command("left")).toBe(false);
    expect(session.snapshot().active?.x).toBe(x);
    platform.handlers.realtime?.({ player_id: "guest", action_type: "arena_hello", action_data: { name: "Guest" } } as never);
    expect(session.readyOpponentIds()).toEqual(["guest"]);
  });

  it("keeps the board inert when the host selects waiting-room lanes", () => {
    const platform = mockPlatform("multiplayer", "host");
    const session = new ArenaSession(new UsionBridge(platform.api.config, platform.api), callbacks());
    session.start();
    expect(session.setLanes(8)).toBe(true);
    const snapshot = session.snapshot();
    expect(snapshot.lanes).toBe(8);
    expect(snapshot.active).toBeNull();
    expect(snapshot.board.flat().every((cell) => cell === 0)).toBe(true);
    expect(platform.game.realtime).toHaveBeenCalledWith("arena_rules", { lanes: 8 });
  });

  it("applies the host's eight-lane waiting-room rule on guests", () => {
    const platform = mockPlatform("multiplayer", "guest");
    const session = new ArenaSession(new UsionBridge(platform.api.config, platform.api), callbacks());
    session.start();
    platform.handlers.realtime?.({
      player_id: "host",
      action_type: "arena_rules",
      action_data: { lanes: 8 }
    } as never);
    expect(session.laneCount()).toBe(8);
  });

  it("resends an active round when a participating friend's iframe remounts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T00:00:00Z"));
    const platform = mockPlatform("multiplayer", "host");
    const session = new ArenaSession(new UsionBridge(platform.api.config, platform.api), callbacks());
    session.start();
    platform.handlers.joined?.({ player_id: "host", player_ids: ["host", "guest"] } as never);
    platform.handlers.realtime?.({ player_id: "guest", action_type: "arena_hello", action_data: { name: "Guest" } } as never);
    expect(session.startArena()).toBe(true);
    vi.advanceTimersByTime(3000);
    session.update(3000);
    platform.game.realtime.mockClear();
    platform.handlers.realtime?.({ player_id: "guest", action_type: "arena_hello", action_data: { name: "Guest" } } as never);

    expect(platform.game.realtime).toHaveBeenCalledWith("arena_start", expect.objectContaining({
      roundId: 1, targetId: "guest", players: ["host", "guest"]
    }));
    vi.useRealTimers();
  });

  it("ignores a late-join start intended for a different player", () => {
    const platform = mockPlatform("multiplayer", "guest");
    const events = callbacks();
    const session = new ArenaSession(new UsionBridge(platform.api.config, platform.api), events);
    session.start();
    platform.handlers.realtime?.({
      player_id: "host",
      action_type: "arena_start",
      action_data: { roundId: 1, startAt: Date.now(), seed: 7, players: ["host", "guest"], targetId: "other" }
    } as never);
    expect(session.isRoundActive()).toBe(false);

    platform.handlers.realtime?.({
      player_id: "host",
      action_type: "arena_start",
      action_data: { roundId: 1, startAt: Date.now(), seed: 7, players: ["host", "guest"], targetId: "guest" }
    } as never);
    expect(session.isRoundActive()).toBe(true);
    expect(events.roundStart).toHaveBeenCalledOnce();
  });

  it("never rolls back guest input when a delayed host snapshot arrives", () => {
    const platform = mockPlatform("multiplayer", "guest");
    const session = new ArenaSession(new UsionBridge(platform.api.config, platform.api), callbacks());
    session.start();
    platform.handlers.realtime?.({
      player_id: "host", action_type: "arena_start",
      action_data: { roundId: 1, startAt: Date.now(), seed: 7, players: ["host", "guest"], lanes: 10 }
    } as never);
    const stale = session.local.networkSnapshot();
    expect(session.command("right")).toBe(true);
    const predictedX = session.snapshot().active?.x;
    platform.handlers.realtime?.({
      player_id: "host", action_type: "arena_state",
      action_data: { roundId: 1, players: { guest: stale }, ended: false }
    } as never);
    expect(session.snapshot().active?.x).toBe(predictedX);
  });

  it("delivers authoritative garbage without replacing guest movement", () => {
    const platform = mockPlatform("multiplayer", "guest");
    const session = new ArenaSession(new UsionBridge(platform.api.config, platform.api), callbacks());
    session.start();
    platform.handlers.realtime?.({
      player_id: "host", action_type: "arena_start",
      action_data: { roundId: 1, startAt: Date.now(), seed: 7, players: ["host", "guest"], lanes: 10 }
    } as never);
    platform.handlers.realtime?.({
      player_id: "host", action_type: "arena_garbage",
      action_data: { roundId: 1, id: 1, targetId: "guest", holes: [2, 4] }
    } as never);
    expect(session.snapshot().pendingGarbage).toBe(2);
  });

  it("sends compact guest checkpoints so the host mini-board stays current", () => {
    const platform = mockPlatform("multiplayer", "guest");
    const session = new ArenaSession(new UsionBridge(platform.api.config, platform.api), callbacks());
    session.start();
    platform.handlers.realtime?.({
      player_id: "host", action_type: "arena_start",
      action_data: { roundId: 1, startAt: Date.now(), seed: 7, players: ["host", "guest"], lanes: 10 }
    } as never);
    platform.game.realtime.mockClear();
    session.update(150);
    expect(platform.game.realtime).toHaveBeenCalledWith("arena_checkpoint", expect.objectContaining({
      roundId: 1, seq: 1, snapshot: expect.objectContaining({ board: expect.any(String) })
    }));
  });

  it("ends gracefully instead of migrating authority when the host leaves", () => {
    const platform = mockPlatform("multiplayer", "guest");
    const events = callbacks();
    const session = new ArenaSession(new UsionBridge(platform.api.config, platform.api), events);
    session.start();
    platform.handlers.playerLeft?.({ player_id: "host", player_ids: ["guest"] } as never);
    expect(session.isHost()).toBe(false);
    expect(events.error).toHaveBeenCalledWith("The arena host left");
  });
});
