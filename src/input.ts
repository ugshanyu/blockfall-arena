import type { Command } from "./game/types";

interface BindOptions {
  canvas: HTMLCanvasElement;
  command: (command: Command) => void;
  pause: () => void;
  resume: () => void;
  unlockAudio: () => void;
  interacted: () => void;
  lanes?: () => number;
}

export type GestureAxis = "pending" | "horizontal" | "vertical";

export function resolveGestureAxis(axis: GestureAxis, dx: number, dy: number, hasMoved = false): GestureAxis {
  const threshold = 12;
  const vertical = dy > threshold && dy > Math.abs(dx) * 1.15;
  if (vertical && (axis === "pending" || (axis === "horizontal" && !hasMoved))) return "vertical";
  if (axis !== "pending") return axis;
  if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy) * 1.35) return "horizontal";
  return "pending";
}

export function isHardDropGesture(dx: number, dy: number, elapsedMs: number, canvasHeight: number): boolean {
  const distance = Math.max(96, canvasHeight * 0.16);
  return elapsedMs < 650 && dy > distance && dy > Math.abs(dx) * 1.4;
}

export function horizontalRepeatDelay(elapsedMs: number): number {
  if (elapsedMs >= 900) return 18;
  if (elapsedMs >= 450) return 30;
  return 45;
}

export function bindInput(options: BindOptions): void {
  let pointerId = -1;
  let startX = 0;
  let startY = 0;
  let lastStep = 0;
  let startTime = 0;
  let axis: GestureAxis = "pending";
  let horizontalTimer: number | undefined;
  let horizontalHeld: "left" | "right" | undefined;
  let horizontalStarted = 0;

  const stopHorizontal = (): void => {
    if (horizontalTimer !== undefined) window.clearTimeout(horizontalTimer);
    horizontalTimer = undefined;
    horizontalHeld = undefined;
  };
  const repeatHorizontal = (): void => {
    if (!horizontalHeld) return;
    options.command(horizontalHeld);
    horizontalTimer = window.setTimeout(repeatHorizontal, horizontalRepeatDelay(performance.now() - horizontalStarted));
  };
  const startHorizontal = (command: "left" | "right"): void => {
    stopHorizontal();
    horizontalHeld = command;
    horizontalStarted = performance.now();
    options.command(command);
    horizontalTimer = window.setTimeout(repeatHorizontal, 145);
  };

  options.canvas.addEventListener("pointerdown", (event) => {
    if (pointerId >= 0) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    lastStep = 0;
    startTime = performance.now();
    axis = "pending";
    options.canvas.focus?.({ preventScroll: true });
    options.canvas.setPointerCapture(pointerId);
    options.unlockAudio();
    options.interacted();
    event.preventDefault();
  });

  options.canvas.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    axis = resolveGestureAxis(axis, dx, dy, lastStep !== 0);
    if (axis !== "horizontal") { event.preventDefault(); return; }
    const cellWidth = Math.max(24, options.canvas.getBoundingClientRect().width / (options.lanes?.() ?? 10) * 0.72);
    const step = Math.trunc(dx / cellWidth);
    while (lastStep < step) { options.command("right"); lastStep += 1; }
    while (lastStep > step) { options.command("left"); lastStep -= 1; }
    event.preventDefault();
  });

  const finish = (event: PointerEvent, cancelled: boolean): void => {
    if (event.pointerId !== pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    const elapsed = performance.now() - startTime;
    pointerId = -1;
    if (!cancelled) {
      if (isHardDropGesture(dx, dy, elapsed, options.canvas.clientHeight)) options.command("hard-drop");
      else if (Math.abs(dx) < 18 && Math.abs(dy) < 18) options.command("rotate-cw");
    }
    event.preventDefault();
  };

  options.canvas.addEventListener("pointerup", (event) => finish(event, false));
  options.canvas.addEventListener("pointercancel", (event) => finish(event, true));
  options.canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      if (event.repeat) return;
      options.unlockAudio();
      options.interacted();
      startHorizontal(event.key === "ArrowLeft" ? "left" : "right");
      return;
    }
    let command: Command | undefined;
    if (event.key === "ArrowDown") command = "soft-drop";
    else if (event.key === "ArrowUp" || key === "x") command = "rotate-cw";
    else if (key === "z") command = "rotate-ccw";
    else if (key === "c" || event.key === "Shift") command = "hold";
    else if (event.code === "Space") command = "hard-drop";
    else if (key === "p" || event.key === "Escape") { options.pause(); event.preventDefault(); return; }
    else if (event.key === "Enter") { options.resume(); event.preventDefault(); return; }
    if (!command) return;
    options.unlockAudio();
    options.interacted();
    options.command(command);
    event.preventDefault();
  });
  window.addEventListener("keyup", (event) => {
    if ((event.key === "ArrowLeft" && horizontalHeld === "left") || (event.key === "ArrowRight" && horizontalHeld === "right")) stopHorizontal();
  });
  window.addEventListener("blur", stopHorizontal);
}
