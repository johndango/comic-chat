// The original client leaned on the MSVC C runtime's rand()/srand() for every
// layout decision, and reseeded it per panel so a panel always re-lays out the
// same way. Reproducing the exact generator keeps layouts stable across
// re-renders and makes them comparable with the Windows build.

export const RAND_MAX = 0x7fff;

export class MsvcRand {
  private state: number;

  constructor(seed = 1) {
    this.state = seed >>> 0;
  }

  srand(seed: number): void {
    this.state = seed >>> 0;
  }

  rand(): number {
    this.state = (Math.imul(this.state, 214013) + 2531011) >>> 0;
    return (this.state >>> 16) & RAND_MAX;
  }

  /** balloon.cpp randfloat(): uniform in [0, 1]. */
  randfloat(): number {
    return this.rand() / RAND_MAX;
  }
}
