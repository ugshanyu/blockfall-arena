export const CLASSIC_RULES = {
  gravity: 0.02,
  gravityIncrease: 0.00125,
  gravityMarginMs: 30_000,
  garbageMultiplier: 1,
  garbageMarginMs: 180_000,
  garbageIncrease: 0.008
} as const;

export function classicGravity(elapsedMs: number): number {
  const seconds = Math.max(0, elapsedMs - CLASSIC_RULES.gravityMarginMs) / 1000;
  return Math.min(20, CLASSIC_RULES.gravity + seconds * CLASSIC_RULES.gravityIncrease);
}

export function classicGarbageMultiplier(elapsedMs: number): number {
  const seconds = Math.max(0, elapsedMs - CLASSIC_RULES.garbageMarginMs) / 1000;
  return CLASSIC_RULES.garbageMultiplier + seconds * CLASSIC_RULES.garbageIncrease;
}

export function classicAttackLines(base: number, elapsedMs: number): number {
  return Math.min(8, Math.max(0, Math.floor(base * classicGarbageMultiplier(elapsedMs))));
}
