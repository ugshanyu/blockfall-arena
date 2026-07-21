const translations = {
  en: {
    score: "Score", lines: "Lines", level: "Level", hold: "Hold", next: "Next", rotate: "Rotate", drop: "Down",
    gestureHint: "Drag to move · Tap to rotate · Swipe down to drop", reconnecting: "Reconnecting…",
    pausedLabel: "Stack frozen", paused: "Paused", resume: "Resume", runComplete: "Run complete",
    stackAgain: "Ready for another stack?", friends: "Friends", global: "Global", playAgain: "Play again",
    nextRound: "Next round", waiting: "Waiting for a rival…", ready: "READY", readyCount: "{count}/{max} players ready", incoming: "+{count} incoming", countdown: "Arena in {count}", hostLeft: "The arena host left", clear1: "Clean!",
    clear2: "Double!", clear3: "Triple!", clear4: "BLOCKFALL!", winner: "Arena winner", eliminated: "Stack broken",
    recordsEmpty: "No records yet", recordsLoading: "Loading records…", muted: "Sound off", unmuted: "Sound on", best: "Best {score}"
  },
  mn: {
    score: "Оноо", lines: "Мөр", level: "Түвшин", hold: "Хадгалах", next: "Дараагийн", rotate: "Эргүүлэх", drop: "Доош",
    gestureHint: "Чирж хөдөлгө · Товшиж эргүүл · Доош шударч унага", reconnecting: "Дахин холбогдож байна…",
    pausedLabel: "Өрөлт зогслоо", paused: "Түр зогсов", resume: "Үргэлжлүүлэх", runComplete: "Тоглолт дууслаа",
    stackAgain: "Дахин өрөх үү?", friends: "Найзууд", global: "Дэлхий", playAgain: "Дахин тоглох",
    nextRound: "Дараагийн үе", waiting: "Өрсөлдөгч хүлээж байна…", ready: "БЭЛЭН", readyCount: "{count}/{max} тоглогч бэлэн", incoming: "+{count} мөр ирж байна", countdown: "Тулаан {count}", hostLeft: "Тулааны эзэн гарлаа", clear1: "Цэвэр!",
    clear2: "Хос!", clear3: "Гурав!", clear4: "BLOCKFALL!", winner: "Тулааны ялагч", eliminated: "Өрөлт нурлаа",
    recordsEmpty: "Одоогоор рекорд алга", recordsLoading: "Рекорд ачаалж байна…", muted: "Дуу хаалттай", unmuted: "Дуу нээлттэй", best: "Шилдэг {score}"
  }
} as const;

type Key = keyof typeof translations.en;
let language: keyof typeof translations = "en";

export function setLanguage(value: string): void {
  language = value.toLowerCase().startsWith("mn") ? "mn" : "en";
  document.documentElement.lang = language;
}

export function t(key: Key, data?: Record<string, string | number>): string {
  let value: string = translations[language][key] ?? translations.en[key];
  for (const [name, replacement] of Object.entries(data ?? {})) value = value.replace(`{${name}}`, String(replacement));
  return value;
}

export function applyTranslations(): void {
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n as Key;
    if (key in translations.en) element.textContent = t(key);
  });
}
