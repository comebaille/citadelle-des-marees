import type { MapVariantId } from './types';

const STORAGE_KEY = 'citadelle_des_marees_v1';

export interface SavedData {
  bestScore: number;
  bestByMap: Partial<Record<MapVariantId, number>>;
  muted: boolean;
  tutorialSeen: boolean;
}

const DEFAULT_DATA: SavedData = {
  bestScore: 0,
  bestByMap: {},
  muted: false,
  tutorialSeen: false,
};

function safeStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Private mode or blocked storage
  }
  return null;
}

export function loadSavedData(): SavedData {
  const store = safeStorage();
  if (!store) return { ...DEFAULT_DATA, bestByMap: {} };
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DATA, bestByMap: {} };
    const parsed = JSON.parse(raw) as Partial<SavedData>;
    return {
      bestScore: typeof parsed.bestScore === 'number' && Number.isFinite(parsed.bestScore) ? parsed.bestScore : 0,
      bestByMap: parsed.bestByMap && typeof parsed.bestByMap === 'object' ? { ...parsed.bestByMap } : {},
      muted: Boolean(parsed.muted),
      tutorialSeen: Boolean(parsed.tutorialSeen),
    };
  } catch {
    return { ...DEFAULT_DATA, bestByMap: {} };
  }
}

export function saveData(data: SavedData): void {
  const store = safeStorage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore quota errors
  }
}

export function recordScore(score: number, mapId: MapVariantId): { isNewRecord: boolean; data: SavedData } {
  const data = loadSavedData();
  const prevBest = data.bestScore;
  const prevMapBest = data.bestByMap[mapId] ?? 0;

  let changed = false;
  let isNewRecord = false;
  if (score > prevBest) {
    data.bestScore = score;
    isNewRecord = true;
    changed = true;
  }
  if (score > prevMapBest) {
    data.bestByMap[mapId] = score;
    changed = true;
  }

  if (changed) saveData(data);
  return { isNewRecord, data };
}

export function setMutedPreference(muted: boolean): void {
  const data = loadSavedData();
  data.muted = muted;
  saveData(data);
}

export function setTutorialSeen(): void {
  const data = loadSavedData();
  data.tutorialSeen = true;
  saveData(data);
}
