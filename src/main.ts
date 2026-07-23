import { ArenaSession } from "./arena-session";
import { AudioEffects } from "./effects";
import { decodeBoard, encodeBoard } from "./game/codec";
import { LANE_COUNTS, laneStart, type Command, type GameEvent, type GameSnapshot, type LaneCount } from "./game/types";
import { applyTranslations, setLanguage, t } from "./i18n";
import { bindActionButton, bindInput } from "./input";
import { OpponentGrid } from "./opponents";
import { RecordsView } from "./records";
import { GameRenderer } from "./renderer";
import { initializeUsion, type UsionBridge } from "./usion";
import "./styles.css";
import "./responsive.css";

function required<T extends HTMLElement>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing ${selector}`);
  return value;
}

const canvas = required<HTMLCanvasElement>("#game-canvas");
const boardWrap = required<HTMLElement>("#board-wrap");
const score = required<HTMLElement>("#score");
const level = required<HTMLElement>("#level");
const callout = required<HTMLElement>("#callout");
const pauseOverlay = required<HTMLElement>("#pause-overlay");
const endOverlay = required<HTMLElement>("#end-overlay");
const waitingOverlay = required<HTMLElement>("#waiting-overlay");
const waitingCount = required<HTMLElement>("#waiting-count");
const arenaStatus = required<HTMLElement>("#arena-status");
const opponentRoot = required<HTMLElement>("#opponents");
const reconnecting = required<HTMLElement>("#connection-overlay");
const restartButton = required<HTMLButtonElement>("#restart");
const soloLanes = required<HTMLButtonElement>("#solo-lanes");
const arena10 = required<HTMLButtonElement>("#arena-10");
const arena8 = required<HTMLButtonElement>("#arena-8");
const arena4 = required<HTMLButtonElement>("#arena-4");
const arenaPlay = required<HTMLButtonElement>("#arena-play");

let announceTimer = 0;
let recordRequest = 0;
let endShown = false;
let previousPhase = "playing";
let previousPendingGarbage = 0;
let bridge: UsionBridge;
let previewOpponents: Map<string, GameSnapshot> | undefined;
let previewReadyIds: string[] | undefined;
let previewWaiting = false;
let previewPlayerCount: number | undefined;

function show(element: HTMLElement, visible: boolean): void { element.classList.toggle("is-hidden", !visible); }

function announce(message: string, strong = false): void {
  window.clearTimeout(announceTimer);
  callout.textContent = message;
  callout.classList.toggle("strong", strong);
  callout.classList.add("visible");
  announceTimer = window.setTimeout(() => callout.classList.remove("visible"), strong ? 1500 : 900);
}

async function boot(): Promise<void> {
  bridge = await initializeUsion();
  setLanguage(bridge.language);
  applyTranslations();
  document.documentElement.dataset.usionTheme = bridge.theme;

  const audio = new AudioEffects();
  const renderer = new GameRenderer(canvas, required<HTMLCanvasElement>("#hold-canvas"), required<HTMLCanvasElement>("#next-canvas"));
  const opponents = new OpponentGrid(opponentRoot);
  const records = new RecordsView();

  const session = new ArenaSession(bridge, {
    mode(active) {
      show(arenaStatus, active);
      show(opponentRoot, active);
      show(waitingOverlay, active);
      show(soloLanes, !active);
      if (active) announce(t("waiting"));
    },
    event(playerId, event) {
      const snapshot = session.snapshot();
      if (playerId === bridge.playerId) {
        renderer.effect(event, snapshot);
        audio.event(event);
        if (event.type === "game-over" && session.isRoundActive()) announce(t("eliminated"), true);
      } else if (event.type === "clear") opponents.pulse(playerId);
    },
    countdown(seconds) {
      show(endOverlay, false);
      show(waitingOverlay, false);
      endShown = false;
      announce(t("countdown", { count: seconds || 1 }), true);
    },
    roundStart() {
      show(endOverlay, false);
      show(waitingOverlay, false);
      endShown = false;
      recordRequest += 1;
      announce("GO", true);
    },
    roundEnd(winnerId, scores) {
      const localScore = Number(scores[bridge.playerId] ?? session.snapshot().score);
      finishRun(session.snapshot(), records, winnerId === bridge.playerId ? t("winner") : t("eliminated"), localScore, true);
    },
    waiting() { show(endOverlay, false); endShown = false; },
    connection(state) { show(reconnecting, state === "disconnected" || state === "rejoining"); },
    error(message) { announce(message, true); }
  });

  session.start();
  const updateLaneControls = (): void => {
    const lanes = session.laneCount();
    soloLanes.textContent = `${lanes} lanes`;
    arena10.classList.toggle("active", lanes === 10);
    arena8.classList.toggle("active", lanes === 8);
    arena4.classList.toggle("active", lanes === 4);
    arena10.disabled = arena8.disabled = arena4.disabled = session.isArena() && !session.isHost();
  };
  const chooseLanes = (lanes: LaneCount): void => { if (session.setLanes(lanes)) { endShown = false; show(endOverlay, false); updateLaneControls(); } };
  soloLanes.addEventListener("click", () => {
    const current = LANE_COUNTS.indexOf(session.laneCount());
    chooseLanes(LANE_COUNTS[(current + 1) % LANE_COUNTS.length]!);
  });
  arena10.addEventListener("click", () => chooseLanes(10));
  arena8.addEventListener("click", () => chooseLanes(8));
  arena4.addEventListener("click", () => chooseLanes(4));
  arenaPlay.addEventListener("click", () => session.startArena());
  updateLaneControls();
  installDevTools(session);
  bindControls(session, audio);

  let last = performance.now();
  let opponentsElapsed = 0;
  const frame = (now: number): void => {
    const delta = Math.min(100, now - last);
    last = now;
    session.update(delta);
    const snapshot = session.snapshot();
    updateLaneControls();
    show(waitingOverlay, previewWaiting || session.isWaiting());
    waitingCount.textContent = t("readyCount", { count: previewPlayerCount ?? session.playerCount(), max: 8 });
    show(arenaPlay, session.isHost());
    arenaPlay.disabled = session.playerCount() < 2;
    if (session.isRoundActive() && snapshot.pendingGarbage > previousPendingGarbage) {
      announce(t("incoming", { count: snapshot.pendingGarbage - previousPendingGarbage }), true);
    }
    previousPendingGarbage = snapshot.pendingGarbage;
    renderer.render(snapshot, now);
    updateHud(snapshot, session);
    if (!session.isArena() && snapshot.phase === "game-over" && previousPhase !== "game-over") {
      finishRun(snapshot, records, t("runComplete"), snapshot.score, false);
    }
    previousPhase = snapshot.phase;
    opponentsElapsed += delta;
    if (opponentsElapsed >= 120) {
      opponentsElapsed = 0;
      opponents.update(previewOpponents ?? session.opponents(), session.players, previewReadyIds ?? session.readyOpponentIds());
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  void bridge.loadPlatformBest();

  function finishRun(snapshot: GameSnapshot, view: RecordsView, label: string, finalScore: number, arena: boolean): void {
    if (endShown) return;
    endShown = true;
    show(pauseOverlay, false);
    show(endOverlay, true);
    required<HTMLElement>("#end-label").textContent = label;
    required<HTMLElement>("#end-title").textContent = finalScore.toLocaleString(bridge.language);
    required<HTMLElement>("#end-copy").textContent = arena ? t("nextRound") : t("stackAgain");
    restartButton.classList.toggle("is-hidden", arena);
    show(required<HTMLElement>(".record-tabs"), !arena);
    show(required<HTMLElement>("#records"), !arena);
    if (arena) return;
    view.loading();
    const request = ++recordRequest;
    void bridge.submitScore(finalScore, { mode: "solo", lanes: snapshot.lanes, lines: snapshot.lines, level: snapshot.level }).then((data) => {
      if (request !== recordRequest) return;
      view.show(data);
      const best = t("best", { score: data.best.toLocaleString(bridge.language) });
      required<HTMLElement>("#end-copy").textContent = best;
    });
  }
}

function installDevTools(session: ArenaSession): void {
  if (!import.meta.env.DEV) return;
  const button = document.createElement("button");
  button.id = "dev-prepare-clear";
  button.setAttribute("aria-label", "Prepare clear demo");
  button.style.cssText = "position:fixed;inset:0 auto auto 0;width:2px;height:2px;opacity:.001;overflow:hidden;z-index:9999";
  button.addEventListener("click", () => {
    const state = session.local.networkSnapshot();
    const board = decodeBoard(state.board);
    const gap = laneStart(state.lanes);
    for (let y = 16; y < 20; y += 1) {
      board[y] = board[y]!.map((_, x) => (x >= gap && x < gap + state.lanes && x !== gap ? 2 : 0));
    }
    session.local.restore({
      ...state,
      board: encodeBoard(board),
      active: { type: "I", rotation: 1, x: gap - 2, y: 16 },
      phase: "playing",
      clearRows: [],
      clearProgress: 0
    });
  });
  document.body.append(button);

  const arenaButton = document.createElement("button");
  arenaButton.id = "dev-preview-arena";
  arenaButton.setAttribute("aria-label", "Preview full arena");
  arenaButton.style.cssText = "position:fixed;inset:0 auto auto 3px;width:2px;height:2px;opacity:.001;overflow:hidden;z-index:9999";
  arenaButton.addEventListener("click", () => {
    session.setLanes(4);
    previewWaiting = false;
    previewPlayerCount = 8;
    previewOpponents = new Map();
    const base = session.snapshot();
    for (let index = 1; index <= 7; index += 1) {
      const id = `rival-${index}`;
      session.players.set(id, { name: `Rival ${index}`, avatar: "" });
      previewOpponents.set(id, { ...base, board: base.board.map((row) => [...row]), score: index * 1240, lines: index * 3 });
    }
    previewReadyIds = [...previewOpponents.keys()];
    show(soloLanes, false);
    show(opponentRoot, true);
    show(arenaStatus, true);
  });
  document.body.append(arenaButton);

  const waitingButton = document.createElement("button");
  waitingButton.id = "dev-preview-waiting";
  waitingButton.setAttribute("aria-label", "Preview arena waiting");
  waitingButton.style.cssText = "position:fixed;inset:0 auto auto 20px;width:6px;height:6px;opacity:.001;overflow:hidden;z-index:9999";
  waitingButton.addEventListener("click", () => {
    session.setLanes(4);
    previewWaiting = true;
    previewPlayerCount = 2;
    previewOpponents = new Map();
    previewReadyIds = ["rival-ready"];
    session.players.set("rival-ready", { name: "Rival ready", avatar: "" });
    waitingCount.textContent = t("readyCount", { count: 2, max: 8 });
    show(soloLanes, false);
    show(opponentRoot, true);
    show(arenaStatus, true);
    show(waitingOverlay, true);
  });
  document.body.append(waitingButton);

  const garbageButton = document.createElement("button");
  garbageButton.id = "dev-preview-garbage";
  garbageButton.setAttribute("aria-label", "Preview incoming garbage");
  garbageButton.style.cssText = "position:fixed;inset:0 auto auto 30px;width:6px;height:6px;opacity:.001;overflow:hidden;z-index:9999";
  garbageButton.addEventListener("click", () => session.local.queueGarbage(4, [0, 3, 6, 8]));
  document.body.append(garbageButton);

  const endButton = document.createElement("button");
  endButton.setAttribute("aria-label", "Preview game over");
  endButton.style.cssText = "position:fixed;inset:0 auto auto 40px;width:6px;height:6px;opacity:.001;overflow:hidden;z-index:9999";
  endButton.addEventListener("click", () => {
    const state = session.local.networkSnapshot();
    session.local.restore({ ...state, active: null, phase: "game-over", score: 12400, lines: 28, level: 3 });
  });
  document.body.append(endButton);
}

function bindControls(session: ArenaSession, audio: AudioEffects): void {
  const command = (value: Command): void => {
    const before = session.snapshot();
    if (!session.command(value)) return;
    if (value === "rotate-cw" || value === "rotate-ccw") audio.rotate();
    else if (value === "hard-drop") audio.drop(Math.max(1, before.ghostY - (before.active?.y ?? 0)));
    else audio.move();
  };
  const interacted = (): void => undefined;
  bindInput({ canvas, command, lanes: () => session.laneCount(), unlockAudio: () => audio.unlock(), interacted, pause: () => togglePause(session), resume: () => resume(session) });
  bindActionButton(required<HTMLButtonElement>("#hold"), () => { audio.unlock(); interacted(); command("hold"); });
  bindActionButton(required<HTMLButtonElement>("#drop"), () => { audio.unlock(); interacted(); command("soft-drop"); });
  required<HTMLButtonElement>("#resume").addEventListener("click", () => resume(session));
  restartButton.addEventListener("click", () => {
    recordRequest += 1;
    endShown = false;
    show(endOverlay, false);
    session.restartSolo();
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden && !session.isArena()) togglePause(session, true); });
}

function togglePause(session: ArenaSession, force = false): void {
  if (session.isArena()) return;
  if (force || session.local.phase === "playing") session.local.pause();
  else session.local.resume();
  show(pauseOverlay, session.local.phase === "paused");
}

function resume(session: ArenaSession): void { session.local.resume(); show(pauseOverlay, false); }

function updateHud(snapshot: GameSnapshot, session: ArenaSession): void {
  score.textContent = snapshot.score.toLocaleString(bridge.language);
  level.textContent = String(snapshot.level);
  const status = arenaStatus.querySelector("span");
  if (status) status.textContent = `Arena · ${previewPlayerCount ?? session.playerCount()}/8`;
  boardWrap.classList.toggle("danger", snapshot.board.slice(0, 5).some((row) => row.some(Boolean)));
}

void boot().catch((error) => {
  console.error(error);
  callout.textContent = error instanceof Error ? error.message : "Could not start the game";
  callout.classList.add("visible", "strong");
});
