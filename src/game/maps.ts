import { findShortestPath } from './pathfinding';
import { createRng } from './rng';
import type { GridCoord, MapDefinition, MapVariantId, TileKind } from './types';

const CHAR_TO_TILE: Record<string, TileKind> = {
  '#': 'abyss',
  '.': 'platform',
  '=': 'channel',
  '~': 'basin',
  S: 'spawn',
  C: 'citadel',
};

function parseAsciiMap(
  id: MapVariantId,
  name: string,
  subtitle: string,
  rowsSpec: readonly string[]
): MapDefinition {
  const rows = rowsSpec.length;
  const cols = rowsSpec[0].split(' ').length;
  const tiles: TileKind[][] = [];
  let spawn: GridCoord | null = null;
  let citadel: GridCoord | null = null;

  for (let r = 0; r < rows; r++) {
    const tokens = rowsSpec[r].trim().split(/\s+/);
    if (tokens.length !== cols) {
      throw new Error(`Invalid row width on map ${id} row ${r}`);
    }
    const rowTiles: TileKind[] = [];
    for (let c = 0; c < cols; c++) {
      const ch = tokens[c];
      const kind = CHAR_TO_TILE[ch];
      if (!kind) throw new Error(`Unknown map symbol "${ch}"`);
      if (kind === 'spawn') spawn = { col: c, row: r };
      if (kind === 'citadel') citadel = { col: c, row: r };
      rowTiles.push(kind);
    }
    tiles.push(rowTiles);
  }

  if (!spawn || !citadel) {
    throw new Error(`Map ${id} missing spawn or citadel`);
  }

  return { id, name, subtitle, cols, rows, tiles, spawn, citadel };
}

const ATOLL_LAYOUT = [
  '# # # # S # # # #',
  '# . . . = . . . #',
  '# . = = = . . . #',
  '# . = . . . . . #',
  '# . = ~ ~ ~ ~ . #',
  '# . ~ ~ . ~ ~ . #',
  '# . ~ ~ ~ ~ = . #',
  '# . . . . . = . #',
  '# . . = = = = . #',
  '# . . = . . . . #',
  '# . . = ~ ~ . . #',
  '# . . . ~ = . . #',
  '# # # # # C # # #',
];

const DETROIT_LAYOUT = [
  '# # # # S # # # #',
  '# . = = = = = . #',
  '# . = . . . = . #',
  '# . = . # . = . #',
  '# . ~ ~ ~ ~ ~ . #',
  '# . ~ ~ ~ ~ ~ . #',
  '# . ~ ~ . ~ ~ . #',
  '# . ~ ~ ~ ~ ~ . #',
  '# . ~ ~ ~ ~ ~ . #',
  '# . = . # . = . #',
  '# . = . . . = . #',
  '# . = = = = = . #',
  '# # # # C # # # #',
];

const FOSSE_LAYOUT = [
  '# # S # # # # # #',
  '# . = = = = = . #',
  '# . . . . . = . #',
  '# . = = ~ ~ = . #',
  '# . = . ~ . . . #',
  '# . = . ~ ~ ~ . #',
  '# . = . . . ~ . #',
  '# . = ~ ~ ~ ~ . #',
  '# . . . . . = . #',
  '# . = = = = = . #',
  '# . = . . . . . #',
  '# . = = = = = . #',
  '# # # # # # C # #',
];

export interface MapVariantMeta {
  id: MapVariantId;
  name: string;
  subtitle: string;
  badge: string;
}

export const MAP_VARIANTS: readonly MapVariantMeta[] = [
  {
    id: 'atoll',
    name: 'Atoll des Brisants',
    subtitle: 'Double courbe corallienne & bassin central',
    badge: 'Équilibrée',
  },
  {
    id: 'detroit',
    name: 'Détroit des Lanternes',
    subtitle: 'Double couloir & grande place à sculpter',
    badge: 'Labyrinthe',
  },
  {
    id: 'fosse',
    name: 'Fosse des Anciens',
    subtitle: 'Méandres profonds & raccourcis tactiques',
    badge: 'Tactique',
  },
  {
    id: 'seeded',
    name: 'Récif Aléatoire',
    subtitle: 'Architecture engloutie par graine reproductible',
    badge: 'Graine',
  },
];

export const DEFAULT_SEED = 'MAREE-42';

/**
 * Deterministically generates a 9x13 winding sunken reef map from a string seed.
 * Guarantees:
 * - A valid contiguous multi-turn route from top spawn to bottom citadel
 * - Both sacred non-buildable channels (`channel`) and navigable buildable plazas (`basin`)
 * - Plenty of reef pedestals (`platform`) along the route
 */
export function generateSeededMap(seedInput: string): MapDefinition {
  const seed = seedInput.trim().toUpperCase() || DEFAULT_SEED;
  const rng = createRng(seed);
  const cols = 9;
  const rows = 13;

  const tiles: TileKind[][] = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) return 'abyss';
      return 'platform';
    })
  );

  // Build 4 alternating horizontal waypoints across rows 1, 4, 7, 10 -> citadel at row 12
  const startLeft = rng.next() < 0.5;
  const spawnCol = rng.int(2, 6);
  const wp1Col = startLeft ? rng.int(1, 2) : rng.int(6, 7);
  const wp2Col = startLeft ? rng.int(6, 7) : rng.int(1, 2);
  const wp3Col = startLeft ? rng.int(1, 3) : rng.int(5, 7);
  const citadelCol = rng.int(2, 6);

  const bendRows = [
    rng.int(1, 2),
    rng.int(4, 5),
    rng.int(7, 8),
    rng.int(10, 11),
  ];

  const carveLine = (c0: number, r0: number, c1: number, r1: number, kind: TileKind) => {
    let c = c0;
    let r = r0;
    tiles[r][c] = kind;
    while (c !== c1) {
      c += c < c1 ? 1 : -1;
      tiles[r][c] = kind;
    }
    while (r !== r1) {
      r += r < r1 ? 1 : -1;
      tiles[r][c] = kind;
    }
  };

  // Trace the primary channel down through bends
  carveLine(spawnCol, 0, spawnCol, bendRows[0], 'channel');
  carveLine(spawnCol, bendRows[0], wp1Col, bendRows[0], 'channel');
  carveLine(wp1Col, bendRows[0], wp1Col, bendRows[1], 'channel');
  carveLine(wp1Col, bendRows[1], wp2Col, bendRows[1], 'channel');
  carveLine(wp2Col, bendRows[1], wp2Col, bendRows[2], 'channel');
  carveLine(wp2Col, bendRows[2], wp3Col, bendRows[2], 'channel');
  carveLine(wp3Col, bendRows[2], wp3Col, bendRows[3], 'channel');
  carveLine(wp3Col, bendRows[3], citadelCol, bendRows[3], 'channel');
  carveLine(citadelCol, bendRows[3], citadelCol, rows - 1, 'channel');

  // Open a navigable mazing basin in the middle band (rows bendRows[1]..bendRows[2])
  const basinLeft = Math.max(2, Math.min(wp1Col, wp2Col) + 1);
  const basinRight = Math.min(cols - 3, Math.max(wp1Col, wp2Col) - 1);
  const midRowTop = Math.min(bendRows[1], bendRows[2]);
  const midRowBot = Math.min(rows - 3, midRowTop + 2);
  for (let r = midRowTop; r <= midRowBot; r++) {
    for (let c = basinLeft; c <= basinRight; c++) {
      if (tiles[r][c] === 'channel' || tiles[r][c] === 'platform') {
        tiles[r][c] = 'basin';
      }
    }
  }

  // Keep a small central pedestal inside a wide basin for visual variety when safe
  const centerC = Math.floor((basinLeft + basinRight) / 2);
  const centerR = Math.floor((midRowTop + midRowBot) / 2);
  if (basinRight - basinLeft >= 2 && midRowBot - midRowTop >= 2) {
    tiles[centerR][centerC] = 'platform';
  }

  // Add 3-5 decorative sunken ruin pillars on platforms not adjacent to spawn/citadel
  let pillarsPlaced = 0;
  for (let tries = 0; tries < 24 && pillarsPlaced < 4; tries++) {
    const c = rng.int(1, cols - 2);
    const r = rng.int(2, rows - 3);
    if (tiles[r][c] !== 'platform') continue;
    // Keep pillars mostly near edges so plenty of inner build spots remain
    if (c > 2 && c < cols - 3 && rng.next() < 0.65) continue;
    tiles[r][c] = 'abyss';
    pillarsPlaced++;
  }

  const spawn: GridCoord = { col: spawnCol, row: 0 };
  const citadel: GridCoord = { col: citadelCol, row: rows - 1 };
  tiles[spawn.row][spawn.col] = 'spawn';
  tiles[citadel.row][citadel.col] = 'citadel';

  const map: MapDefinition = {
    id: 'seeded',
    name: `Récif ${seed}`,
    subtitle: `Graine ${seed}`,
    seed,
    cols,
    rows,
    tiles,
    spawn,
    citadel,
  };

  // Sanity guarantee: ensure a valid path exists
  const check = findShortestPath(map, spawn, citadel, new Set());
  if (!check) {
    // Fallback shouldn't trigger due to continuous carving, but guarantee safety
    return getMapDefinition('atoll');
  }

  return map;
}

export function getMapDefinition(variant: MapVariantId, seed: string = DEFAULT_SEED): MapDefinition {
  switch (variant) {
    case 'atoll':
      return parseAsciiMap('atoll', 'Atoll des Brisants', 'Double courbe corallienne & bassin central', ATOLL_LAYOUT);
    case 'detroit':
      return parseAsciiMap('detroit', 'Détroit des Lanternes', 'Double couloir & grande place à sculpter', DETROIT_LAYOUT);
    case 'fosse':
      return parseAsciiMap('fosse', 'Fosse des Anciens', 'Méandres profonds & raccourcis tactiques', FOSSE_LAYOUT);
    case 'seeded':
      return generateSeededMap(seed);
  }
}
