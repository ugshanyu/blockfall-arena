import type { GameSnapshot } from "./game/types";
import { t } from "./i18n";
import { drawMiniBoard } from "./renderer";

interface PlayerInfo { name: string; avatar: string }
interface Card { root: HTMLElement; canvas: HTMLCanvasElement; name: HTMLElement; score: HTMLElement }

export class OpponentGrid {
  private cards = new Map<string, Card>();

  constructor(private root: HTMLElement) {}

  update(snapshots: Map<string, GameSnapshot>, players: Map<string, PlayerInfo>, readyIds: string[] = []): void {
    const visible = new Set([...readyIds, ...snapshots.keys()]);
    for (const id of [...this.cards.keys()]) if (!visible.has(id)) {
      this.cards.get(id)?.root.remove();
      this.cards.delete(id);
    }
    for (const id of visible) {
      const snapshot = snapshots.get(id);
      const card = this.cards.get(id) ?? this.create(id);
      const player = players.get(id);
      card.name.textContent = player?.name || "Player";
      card.score.textContent = snapshot ? snapshot.score.toLocaleString() : t("ready");
      card.root.classList.toggle("is-ready", !snapshot);
      card.root.classList.toggle("is-out", snapshot?.phase === "game-over");
      drawMiniBoard(card.canvas, snapshot);
    }
  }

  pulse(playerId: string): void {
    const root = this.cards.get(playerId)?.root;
    if (!root) return;
    root.classList.remove("pulse");
    void root.offsetWidth;
    root.classList.add("pulse");
  }

  private create(id: string): Card {
    const root = document.createElement("article");
    root.className = "opponent-card";
    root.dataset.playerId = id;
    const canvas = document.createElement("canvas");
    canvas.width = 50;
    canvas.height = 100;
    const info = document.createElement("div");
    const name = document.createElement("b");
    const score = document.createElement("span");
    info.append(name, score);
    root.append(canvas, info);
    this.root.append(root);
    const card = { root, canvas, name, score };
    this.cards.set(id, card);
    return card;
  }
}
