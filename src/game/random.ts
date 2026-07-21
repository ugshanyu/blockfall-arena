export class SeededRandom {
  private value: number;

  constructor(seed: number) {
    this.value = seed >>> 0 || 0x6d2b79f5;
  }

  next(): number {
    let x = this.value;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.value = x >>> 0;
    return this.value / 0x100000000;
  }

  get state(): number {
    return this.value;
  }

  set state(value: number) {
    this.value = value >>> 0 || 0x6d2b79f5;
  }
}
