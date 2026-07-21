import { describe, expect, it, vi } from "vitest";
import { ArenaSession } from "./arena-session";
import { UsionBridge, type UsionApi } from "./usion";

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
  return { mode: vi.fn(), event: vi.fn(), countdown: vi.fn(), roundStart: vi.fn(), roundEnd: vi.fn(), connection: vi.fn(), error: vi.fn() };
}

describe("ArenaSession platform lifecycle", () => {
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
    expect(events.mode).toHaveBeenCalledWith(true);
    expect(platform.game.join).not.toHaveBeenCalled();
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
