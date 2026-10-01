/** How hard the tuner searches: bigger populations, more generations and more restarts find cheaper designs, slower. */
export interface Effort {
  population: number;
  generations: number;
  patience: number;
  restarts: number;
  polishRounds: number;
  /** Share of the reference search's size given to each side search (bonus, requires). */
  side: number;
}

export const EFFORTS: Record<string, Effort> = {
  quick: { population: 32, generations: 40, patience: 12, restarts: 1, polishRounds: 25, side: 0.5 },
  normal: { population: 48, generations: 100, patience: 25, restarts: 3, polishRounds: 60, side: 0.5 },
  thorough: { population: 64, generations: 200, patience: 40, restarts: 5, polishRounds: 100, side: 0.6 },
  max: { population: 96, generations: 400, patience: 80, restarts: 8, polishRounds: 200, side: 0.75 },
};

export const DEFAULT_EFFORT = 'normal';
