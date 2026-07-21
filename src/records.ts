import { t } from "./i18n";
import type { LeaderboardEntry, SavedRun } from "./usion";

function required<T extends HTMLElement>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing ${selector}`);
  return value;
}

export class RecordsView {
  private container = required<HTMLElement>("#records");
  private friendsButton = required<HTMLButtonElement>("#friends-tab");
  private globalButton = required<HTMLButtonElement>("#global-tab");
  private data: SavedRun = { friends: [], global: [], best: 0 };
  private mode: "friends" | "global" = "friends";

  constructor() {
    this.friendsButton.addEventListener("click", () => this.select("friends"));
    this.globalButton.addEventListener("click", () => this.select("global"));
  }

  loading(): void {
    this.container.innerHTML = `<div class="records-empty">${t("recordsLoading")}</div>`;
  }

  show(data: SavedRun): void {
    this.data = data;
    this.render();
  }

  private select(mode: "friends" | "global"): void {
    this.mode = mode;
    this.friendsButton.classList.toggle("active", mode === "friends");
    this.globalButton.classList.toggle("active", mode === "global");
    this.render();
  }

  private render(): void {
    const entries = this.mode === "friends" ? this.data.friends : this.data.global;
    this.container.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "records-empty";
      empty.textContent = t("recordsEmpty");
      this.container.append(empty);
      return;
    }
    entries.slice(0, 8).forEach((entry) => this.container.append(this.row(entry)));
  }

  private row(entry: LeaderboardEntry): HTMLElement {
    const row = document.createElement("div");
    row.className = `record-row${entry.is_me ? " is-me" : ""}`;
    const rank = document.createElement("span"); rank.textContent = `#${entry.rank}`;
    const avatar = document.createElement(entry.avatar ? "img" : "i");
    if (avatar instanceof HTMLImageElement) { avatar.src = entry.avatar!; avatar.alt = ""; }
    else avatar.textContent = (entry.name || "?").slice(0, 1).toUpperCase();
    const name = document.createElement("b"); name.textContent = entry.name || "Player";
    const score = document.createElement("strong"); score.textContent = entry.score.toLocaleString();
    row.append(rank, avatar, name, score);
    return row;
  }
}
