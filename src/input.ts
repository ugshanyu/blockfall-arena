import type { Command } from "./game/types";

interface BindOptions {
  canvas: HTMLCanvasElement;
  command: (command: Command) => void;
  pause: () => void;
  resume: () => void;
  unlockAudio: () => void;
  interacted: () => void;
}

export function bindInput(options: BindOptions): void {
  let pointerId = -1;
  let startX = 0;
  let startY = 0;
  let lastStep = 0;
  let startTime = 0;

  options.canvas.addEventListener("pointerdown", (event) => {
    if (pointerId >= 0) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    lastStep = 0;
    startTime = performance.now();
    options.canvas.setPointerCapture(pointerId);
    options.unlockAudio();
    options.interacted();
    event.preventDefault();
  });

  options.canvas.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId) return;
    const cellWidth = Math.max(24, options.canvas.getBoundingClientRect().width / 10 * 0.72);
    const step = Math.trunc((event.clientX - startX) / cellWidth);
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
      if (dy > Math.max(58, options.canvas.clientHeight * 0.09) && elapsed < 650) options.command("hard-drop");
      else if (Math.abs(dx) < 18 && Math.abs(dy) < 18) options.command("rotate-cw");
    }
    event.preventDefault();
  };

  options.canvas.addEventListener("pointerup", (event) => finish(event, false));
  options.canvas.addEventListener("pointercancel", (event) => finish(event, true));
  options.canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    let command: Command | undefined;
    if (event.key === "ArrowLeft") command = "left";
    else if (event.key === "ArrowRight") command = "right";
    else if (event.key === "ArrowDown") command = "soft-drop";
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
}
