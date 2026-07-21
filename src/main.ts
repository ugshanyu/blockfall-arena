import { ArenaSession } from "./arena-session";
import { AudioEffects } from "./effects";
import { decodeBoard, encodeBoard } from "./game/codec";
import type { Command, GameEvent, GameSnapshot } from "./game/types";
import { applyTranslations, setLanguage, t } from "./i18n";
import { bindInput } from "./input";
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
const lines = required<HTMLElement>("#lines");
const level = required<HTMLElement>("#level");
const callout = required<HTMLElement>("#callout");
const gestureHint = required<HTMLElement>("#gesture-hint");
const pauseOverlay = required<HTMLElement>("#pause-overlay");
const endOverlay = required<HTMLElement>("#end-overlay");
const arenaStatus = required<HTMLElement>("#arena-status");
const opponentRoot = required<HTMLElement>("#opponents");
const reconnecting = required<HTMLElement>("#connection-overlay");
const pauseButton = required<HTMLButtonElement>("#pause");
const restartButton = required<HTMLButtonElement>("#restart");
const soundButton = required<HTMLButtonElement>("#sound");

let announceTimer = 0;
let recordRequest = 0;
let endShown = false;
let previousPhase = "playing";
let bridge: UsionBridge;
let previewOpponents: Map<string, GameSnapshot> | undefined;

function show(element: HTMLElement, visible: boolean): void { element.classList.toggle("is-hidden", !visible); }

function announce(message: string, strong = false): void {
  window.clearTimeout(announceTimer);
  callout.textContent = message;
  callout.classList.toggle("strong", strong);
  callout.classList.add("visible");
  announceTimer = window.setTimeout(() => callout.classList.remove("visible"), strong ? 1500 : 900);
}

function clearMessage(count: number): string {
  return t((count >= 4 ? "clear4" : count === 3 ? "clear3" : count === 2 ? "clear2" : "clear1") as "clear1");
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
      pauseButton.disabled = active;
      if (active) announce(t("waiting"));
    },
    event(playerId, event) {
      const snapshot = session.snapshot();
      if (playerId === bridge.playerId) {
        renderer.effect(event, snapshot);
        audio.event(event);
        if (event.type === "clear") announce(clearMessage(event.count ?? 1), true);
        if (event.type === "game-over" && session.isRoundActive()) announce(t("eliminated"), true);
      } else if (event.type === "clear") opponents.pulse(playerId);
    },
    countdown(seconds) {
      show(endOverlay, false);
      endShown = false;
      announce(t("countdown", { count: seconds || 1 }), true);
    },
    roundStart() {
      show(endOverlay, false);
      endShown = false;
      recordRequest += 1;
      announce("GO", true);
    },
    roundEnd(winnerId, scores) {
      const localScore = Number(scores[bridge.playerId] ?? session.snapshot().score);
      finishRun(session.snapshot(), records, winnerId === bridge.playerId ? t("winner") : t("eliminated"), localScore, true);
    },
    connection(state) { show(reconnecting, state === "disconnected" || state === "rejoining"); },
    error(message) { announce(message, true); }
  });

  session.start();
  installDevTools(session);
  bindControls(session, audio);

  let last = performance.now();
  let opponentsElapsed = 0;
  const frame = (now: number): void => {
    const delta = Math.min(100, now - last);
    last = now;
    session.update(delta);
    const snapshot = session.snapshot();
    renderer.render(snapshot, now);
    updateHud(snapshot, session);
    if (!session.isArena() && snapshot.phase === "game-over" && previousPhase !== "game-over") {
      finishRun(snapshot, records, t("runComplete"), snapshot.score, false);
    }
    previousPhase = snapshot.phase;
    opponentsElapsed += delta;
    if (opponentsElapsed >= 120) {
      opponentsElapsed = 0;
      opponents.update(previewOpponents ?? session.opponents(), session.players);
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
    view.loading();
    const request = ++recordRequest;
    void bridge.submitScore(finalScore, { mode: arena ? "arena" : "solo", lines: snapshot.lines, level: snapshot.level }).then((data) => {
      if (request !== recordRequest) return;
      view.show(data);
      const best = t("best", { score: data.best.toLocaleString(bridge.language) });
      required<HTMLElement>("#end-copy").textContent = arena ? `${t("nextRound")} · ${best}` : best;
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
    for (let y = 16; y < 20; y += 1) board[y] = [0, 2, 2, 2, 2, 2, 2, 2, 2, 2];
    session.local.restore({
      ...state,
      board: encodeBoard(board),
      active: { type: "I", rotation: 1, x: -2, y: 16 },
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
    previewOpponents = new Map();
    const base = session.snapshot();
    for (let index = 1; index <= 7; index += 1) {
      const id = `rival-${index}`;
      session.players.set(id, { name: `Rival ${index}`, avatar: "" });
      previewOpponents.set(id, { ...base, board: base.board.map((row) => [...row]), score: index * 1240, lines: index * 3 });
    }
    show(opponentRoot, true);
    show(arenaStatus, true);
  });
  document.body.append(arenaButton);

  const endButton = document.createElement("button");
  endButton.setAttribute("aria-label", "Preview game over");
  endButton.style.cssText = "position:fixed;inset:0 auto auto 6px;width:2px;height:2px;opacity:.001;overflow:hidden;z-index:9999";
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
  const interacted = (): void => gestureHint.classList.add("dismissed");
  bindInput({ canvas, command, unlockAudio: () => audio.unlock(), interacted, pause: () => togglePause(session), resume: () => resume(session) });
  required<HTMLButtonElement>("#hold").addEventListener("click", () => { audio.unlock(); interacted(); command("hold"); });
  required<HTMLButtonElement>("#rotate").addEventListener("click", () => { audio.unlock(); interacted(); command("rotate-cw"); });
  required<HTMLButtonElement>("#drop").addEventListener("click", () => { audio.unlock(); interacted(); command("hard-drop"); });
  pauseButton.addEventListener("click", () => togglePause(session));
  required<HTMLButtonElement>("#resume").addEventListener("click", () => resume(session));
  restartButton.addEventListener("click", () => {
    recordRequest += 1;
    endShown = false;
    show(endOverlay, false);
    session.restartSolo();
  });
  soundButton.addEventListener("click", () => {
    const muted = audio.toggle();
    soundButton.textContent = muted ? "×" : "♪";
    announce(t(muted ? "muted" : "unmuted"));
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
  lines.textContent = String(snapshot.lines);
  level.textContent = String(snapshot.level);
  pauseButton.textContent = snapshot.phase === "paused" ? "▶" : "Ⅱ";
  const status = arenaStatus.querySelector("span");
  if (status) status.textContent = `Arena · ${session.playerCount()}/8`;
  boardWrap.classList.toggle("danger", snapshot.board.slice(0, 5).some((row) => row.some(Boolean)));
}

void boot().catch((error) => {
  console.error(error);
  callout.textContent = error instanceof Error ? error.message : "Could not start the game";
  callout.classList.add("visible", "strong");
});
