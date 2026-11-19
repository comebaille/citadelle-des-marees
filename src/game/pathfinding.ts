import type { Enemy, GridCoord, MapDefinition, PlacementCheckResult, TileKind, Tower } from './types';

export function coordKey(col: number, row: number): string {
  return `${col},${row}`;
}

export function isInBounds(map: MapDefinition, col: number, row: number): boolean {
  return col >= 0 && col < map.cols && row >= 0 && row < map.rows;
}

export function isTileWalkable(kind: TileKind): boolean {
  return kind === 'channel' || kind === 'basin' || kind === 'spawn' || kind === 'citadel';
}

export function isTileNaturallyBuildable(kind: TileKind): boolean {
  return kind === 'platform' || kind === 'basin';
}

const DIRS: readonly GridCoord[] = [
  { col: 0, row: 1 }, // prefer downward flow slightly on ties
  { col: 1, row: 0 },
  { col: -1, row: 0 },
  { col: 0, row: -1 },
];

/**
 * Shortest-path BFS on the navigable tiles (`spawn`, `citadel`, `channel`, `basin`),
 * avoiding any tile occupied by a tower (plus an optional candidate tile).
 * Uses a tiny tie-breaker preferring `channel` tiles over `basin` tiles when equal length
 * is achieved by using a weighted Dijkstra (channel cost 10, basin cost 11) so enemies
 * naturally follow sacred causeways cleanly while still taking genuine shortcuts across basins!
 */
export function findShortestPath(
  map: MapDefinition,
  start: GridCoord,
  goal: GridCoord,
  blockedKeys: ReadonlySet<string>
): GridCoord[] | null {
  if (!isInBounds(map, start.col, start.row) || !isInBounds(map, goal.col, goal.row)) {
    return null;
  }

  const startKey = coordKey(start.col, start.row);
  const goalKey = coordKey(goal.col, goal.row);

  if (blockedKeys.has(startKey) || blockedKeys.has(goalKey)) {
    return null;
  }
  if (!isTileWalkable(map.tiles[start.row][start.col]) || !isTileWalkable(map.tiles[goal.row][goal.col])) {
    return null;
  }

  // Dijkstra on small grid (9x13 = 117 nodes): ultra-fast and cleanly respects causeway preference
  const dist = new Map<string, number>();
  const prev = new Map<string, GridCoord>();
  const visited = new Set<string>();
  const queue: Array<{ coord: GridCoord; cost: number }> = [{ coord: start, cost: 0 }];
  dist.set(startKey, 0);

  while (queue.length > 0) {
    let bestIdx = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i].cost < queue[bestIdx].cost) {
        bestIdx = i;
      }
    }
    const current = queue.splice(bestIdx, 1)[0];
    const cKey = coordKey(current.coord.col, current.coord.row);
    if (visited.has(cKey)) continue;
    visited.add(cKey);

    if (cKey === goalKey) {
      const path: GridCoord[] = [];
      let cur: GridCoord | undefined = goal;
      while (cur) {
        path.push({ col: cur.col, row: cur.row });
        const pk = coordKey(cur.col, cur.row);
        if (pk === startKey) break;
        cur = prev.get(pk);
      }
      path.reverse();
      return path;
    }

    for (const d of DIRS) {
      const nc = current.coord.col + d.col;
      const nr = current.coord.row + d.row;
      if (!isInBounds(map, nc, nr)) continue;

      const nKey = coordKey(nc, nr);
      if (visited.has(nKey) || blockedKeys.has(nKey)) continue;

      const tileKind = map.tiles[nr][nc];
      if (!isTileWalkable(tileKind)) continue;

      // Channel cost 10, basin cost 10.05 (so shorter path ALWAYS wins, tie goes to channel)
      const stepCost = tileKind === 'basin' ? 10.05 : 10;
      const nextCost = current.cost + stepCost;
      const existing = dist.get(nKey);
      if (existing === undefined || nextCost < existing) {
        dist.set(nKey, nextCost);
        prev.set(nKey, current.coord);
        queue.push({ coord: { col: nc, row: nr }, cost: nextCost });
      }
    }
  }

  return null;
}

/**
 * Computes set of all tiles that can reach the citadel given blockedKeys (reverse BFS).
 * Used to quickly check that NO active enemy would be stranded by a new tower.
 */
export function computeReachableToCitadel(
  map: MapDefinition,
  blockedKeys: ReadonlySet<string>
): Set<string> {
  const reachable = new Set<string>();
  const goalKey = coordKey(map.citadel.col, map.citadel.row);
  if (blockedKeys.has(goalKey)) return reachable;

  const queue: GridCoord[] = [map.citadel];
  reachable.add(goalKey);

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (const d of DIRS) {
      const nc = cur.col + d.col;
      const nr = cur.row + d.row;
      if (!isInBounds(map, nc, nr)) continue;
      const nKey = coordKey(nc, nr);
      if (reachable.has(nKey) || blockedKeys.has(nKey)) continue;
      if (!isTileWalkable(map.tiles[nr][nc])) continue;
      reachable.add(nKey);
      queue.push({ col: nc, row: nr });
    }
  }
  return reachable;
}

export function buildTowerBlockSet(towers: readonly Tower[], extra?: GridCoord): Set<string> {
  const set = new Set<string>();
  for (const t of towers) {
    set.add(coordKey(t.col, t.row));
  }
  if (extra) {
    set.add(coordKey(extra.col, extra.row));
  }
  return set;
}

/**
 * Validates whether a tower can legally be placed at (col, row):
 * 1. Inside grid bounds
 * 2. Not on sacred channel (`channel`), spawn, citadel, or abyss
 * 3. Not already occupied by a tower
 * 4. Player has enough pearls (if cost provided)
 * 5. If placing on an open navigable `basin` tile:
 *    - Must not contain an active enemy
 *    - Must preserve a valid route from spawn to citadel
 *    - Must preserve a valid route from every living enemy's tile to citadel
 */
export function validateTowerPlacement(params: {
  map: MapDefinition;
  towers: readonly Tower[];
  enemies: readonly Enemy[];
  currentPath: readonly GridCoord[];
  col: number;
  row: number;
  pearls?: number;
  cost?: number;
}): PlacementCheckResult {
  const { map, towers, enemies, currentPath, col, row, pearls, cost } = params;

  if (!isInBounds(map, col, row)) {
    return { ok: false, reason: 'out_of_bounds', message: 'Hors de la carte.' };
  }

  const tile = map.tiles[row][col];
  if (tile === 'channel' || tile === 'spawn' || tile === 'citadel') {
    return {
      ok: false,
      reason: 'on_path',
      message: 'Placement interdit sur le courant sacré.',
    };
  }

  if (tile === 'abyss') {
    return {
      ok: false,
      reason: 'blocked_tile',
      message: 'Ruine engloutie : construction impossible.',
    };
  }

  if (towers.some((t) => t.col === col && t.row === row)) {
    return {
      ok: false,
      reason: 'occupied',
      message: 'Une tour occupe déjà cet emplacement.',
    };
  }

  if (pearls !== undefined && cost !== undefined && pearls < cost) {
    return {
      ok: false,
      reason: 'insufficient_pearls',
      message: `Perles insuffisantes (${cost} requises).`,
    };
  }

  // Elevated reef platforms are never walkable, so they cannot interfere with enemies or pathing
  if (tile === 'platform') {
    return { ok: true, nextPath: [...currentPath], reroutes: false };
  }

  // Navigable basin tile: check enemy occupancy and path preservation
  for (const enemy of enemies) {
    const eCol = Math.floor(enemy.x);
    const eRow = Math.floor(enemy.y);
    if (eCol === col && eRow === row) {
      return {
        ok: false,
        reason: 'enemy_present',
        message: 'Un ennemi traverse cette dalle.',
      };
    }
    // Also reject if enemy body overlaps the tile center closely
    const dx = enemy.x - (col + 0.5);
    const dy = enemy.y - (row + 0.5);
    if (dx * dx + dy * dy < 0.42 * 0.42) {
      return {
        ok: false,
        reason: 'enemy_present',
        message: 'Un ennemi est trop proche de cette dalle.',
      };
    }
  }

  const candidateBlocked = buildTowerBlockSet(towers, { col, row });
  const nextPath = findShortestPath(map, map.spawn, map.citadel, candidateBlocked);
  if (!nextPath) {
    return {
      ok: false,
      reason: 'blocks_path',
      message: 'Bloque tous les chemins vers la Citadelle !',
    };
  }

  // Ensure every living enemy still has a valid route to the citadel
  if (enemies.length > 0) {
    const reachable = computeReachableToCitadel(map, candidateBlocked);
    for (const enemy of enemies) {
      const eCol = Math.max(0, Math.min(map.cols - 1, Math.floor(enemy.x)));
      const eRow = Math.max(0, Math.min(map.rows - 1, Math.floor(enemy.y)));
      if (!reachable.has(coordKey(eCol, eRow))) {
        return {
          ok: false,
          reason: 'blocks_path',
          message: 'Cette tour piégerait un ennemi sans issue.',
        };
      }
    }
  }

  const reroutes = currentPath.some((p) => p.col === col && p.row === row);
  return { ok: true, nextPath, reroutes };
}

/**
 * Verifies a path is strictly contiguous (Manhattan distance 1 between consecutive tiles),
 * starts at `start`, ends at `goal`, and only steps on walkable, unblocked tiles.
 */
export function isPathValid(
  map: MapDefinition,
  path: readonly GridCoord[],
  blockedKeys: ReadonlySet<string> = new Set()
): boolean {
  if (path.length < 2) return false;
  const first = path[0];
  const last = path[path.length - 1];
  if (first.col !== map.spawn.col || first.row !== map.spawn.row) return false;
  if (last.col !== map.citadel.col || last.row !== map.citadel.row) return false;

  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (!isInBounds(map, p.col, p.row)) return false;
    if (!isTileWalkable(map.tiles[p.row][p.col])) return false;
    if (blockedKeys.has(coordKey(p.col, p.row))) return false;
    if (i > 0) {
      const prev = path[i - 1];
      const manhattan = Math.abs(p.col - prev.col) + Math.abs(p.row - prev.row);
      if (manhattan !== 1) return false;
    }
  }
  return true;
}
