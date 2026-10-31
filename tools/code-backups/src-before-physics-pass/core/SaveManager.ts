import { CONFIG, type DeckChoice } from './config';

export interface SaveData {
  bestScores: number[];
  unlockedLevels: number;
  bestCombos: number[];
  settings: {
    musicVolume: number;
    soundVolume: number;
    cameraDistance: number;
    tutorial: boolean;
    deck: DeckChoice;
  };
}

const DEFAULT_SAVE: SaveData = {
  bestScores: [0, 0, 0, 0, 0],
  unlockedLevels: 1,
  bestCombos: [0, 0, 0, 0, 0],
  settings: {
    musicVolume: CONFIG.audio.defaultMusicVolume,
    soundVolume: CONFIG.audio.defaultSoundVolume,
    cameraDistance: CONFIG.camera.distance,
    tutorial: true,
    deck: 1,
  },
};

export class SaveManager {
  readonly key = 'kickflip-city-save-v1';
  data: SaveData = structuredClone(DEFAULT_SAVE);

  constructor() {
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SaveData>;
        this.data = {
          ...structuredClone(DEFAULT_SAVE),
          ...parsed,
          settings: { ...DEFAULT_SAVE.settings, ...parsed.settings },
          bestScores: DEFAULT_SAVE.bestScores.map((fallback, index) => parsed.bestScores?.[index] ?? fallback),
          bestCombos: DEFAULT_SAVE.bestCombos.map((fallback, index) => parsed.bestCombos?.[index] ?? fallback),
        };
      }
    } catch (error) {
      console.warn('Save data unavailable; using defaults.', error);
    }
  }

  write(): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.data));
    } catch (error) {
      console.warn('Could not save Kickflip City data.', error);
    }
  }

  recordScore(level: number, score: number, combo: number): boolean {
    const highScore = score > (this.data.bestScores[level] ?? 0);
    this.data.bestScores[level] = Math.max(score, this.data.bestScores[level] ?? 0);
    this.data.bestCombos[level] = Math.max(combo, this.data.bestCombos[level] ?? 0);
    this.write();
    return highScore;
  }

  unlock(levelCount: number): void {
    this.data.unlockedLevels = Math.min(levelCount, this.data.unlockedLevels + 1);
    this.write();
  }
}
