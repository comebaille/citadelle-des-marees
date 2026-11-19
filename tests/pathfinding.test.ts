import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/game/engine';
import { generateSeededMap, getMapDefinition } from '../src/game/maps';
import { buildTowerBlockSet, findShortestPath, isPathValid } from '../src/game/pathfinding';
import type { MapVariantId } from '../src/game/types';

describe('Cartes, génération par graine et recherche de chemin', () => {
  it('produit une route valide et continue pour les 3 cartes fixes', () => {
    const fixedMaps: MapVariantId[] = ['atoll', 'detroit', 'fosse'];
    for (const id of fixedMaps) {
      const map = getMapDefinition(id);
      const path = findShortestPath(map, map.spawn, map.citadel, new Set());
      expect(path, `Chemin manquant sur ${id}`).not.toBeNull();
      expect(isPathValid(map, path!)).toBe(true);
      expect(path!.length).toBeGreaterThanOrEqual(13);
    }
  });

  it('génère des cartes reproductibles à partir de la même graine et variées pour des graines distinctes', () => {
    const mapA1 = generateSeededMap('MAREE-42');
    const mapA2 = generateSeededMap('maree-42');
    const mapB = generateSeededMap('ABYSSE-99');

    expect(mapA1.tiles).toEqual(mapA2.tiles);
    expect(mapA1.spawn).toEqual(mapA2.spawn);
    expect(mapA1.citadel).toEqual(mapA2.citadel);

    // Different seeds should produce different geometry
    expect(JSON.stringify(mapA1.tiles)).not.toEqual(JSON.stringify(mapB.tiles));

    // Stress-test 25 distinct seeds: every single one must have a valid path
    for (let i = 1; i <= 25; i++) {
      const m = generateSeededMap(`TEST-SEED-${i}`);
      const path = findShortestPath(m, m.spawn, m.citadel, new Set());
      expect(path, `Graine TEST-SEED-${i} sans chemin`).not.toBeNull();
      expect(isPathValid(m, path!)).toBe(true);
    }
  });

  it('interdit le placement sur le chemin sacré (channel), spawn, citadelle et ruines (abyss)', () => {
    const engine = new GameEngine('atoll');
    engine.startNewGame();
    engine.pearls = 500;

    // (4,1) is channel on atoll, (4,0) is spawn, (5,12) is citadel, (0,0) is abyss
    const onChannel = engine.placeTower('harpon', 4, 1);
    expect(onChannel.ok).toBe(false);
    if (!onChannel.ok) expect(onChannel.reason).toBe('on_path');

    const onSpawn = engine.placeTower('harpon', engine.map.spawn.col, engine.map.spawn.row);
    expect(onSpawn.ok).toBe(false);
    if (!onSpawn.ok) expect(onSpawn.reason).toBe('on_path');

    const onCitadel = engine.placeTower('harpon', engine.map.citadel.col, engine.map.citadel.row);
    expect(onCitadel.ok).toBe(false);
    if (!onCitadel.ok) expect(onCitadel.reason).toBe('on_path');

    const onAbyss = engine.placeTower('harpon', 0, 0);
    expect(onAbyss.ok).toBe(false);
    if (!onAbyss.ok) expect(onAbyss.reason).toBe('blocked_tile');

    expect(engine.towers.length).toBe(0);
  });

  it('permet de dévier le chemin dans un bassin navigable mais interdit de bloquer toutes les issues', () => {
    // On 'detroit', row 5 has 5 open navigable basin tiles: cols 2, 3, 4, 5, 6 (with abyss/platform framing)
    const engine = new GameEngine('detroit');
    engine.startNewGame();
    engine.pearls = 1000;

    // Block cols 2, 3, 4, 5 across row 5 -> col 6 still leaves a valid open route!
    for (const col of [2, 3, 4, 5]) {
      const placed = engine.placeTower('harpon', col, 5);
      expect(placed.ok, `Placement devrait réussir sur (${col},5)`).toBe(true);
    }

    const blockedSet = buildTowerBlockSet(engine.towers);
    expect(isPathValid(engine.map, engine.currentPath, blockedSet)).toBe(true);
    // The recomputed path MUST pass through the remaining opening (6, 5)
    expect(engine.currentPath.some((p) => p.col === 6 && p.row === 5)).toBe(true);

    // Attempting to close the final opening (6, 5) must be REJECTED!
    const sealingAttempt = engine.placeTower('harpon', 6, 5);
    expect(sealingAttempt.ok).toBe(false);
    if (!sealingAttempt.ok) {
      expect(sealingAttempt.reason).toBe('blocks_path');
    }
    expect(engine.towers.length).toBe(4);
  });

  it('empêche de poser une tour sur la dalle occupée par un ennemi actif ou de le piéger', () => {
    const engine = new GameEngine('detroit');
    engine.startNewGame();
    engine.pearls = 1000;
    engine.startNextWave();

    // Advance until first enemy enters the open basin (row 4..8)
    for (let i = 0; i < 400; i++) {
      engine.step(0.03);
      if (engine.enemies.some((e) => engine.map.tiles[Math.floor(e.y)][Math.floor(e.x)] === 'basin')) {
        break;
      }
    }

    const enemyInBasin = engine.enemies.find(
      (e) => engine.map.tiles[Math.floor(e.y)][Math.floor(e.x)] === 'basin'
    );
    expect(enemyInBasin).toBeDefined();

    const col = Math.floor(enemyInBasin!.x);
    const row = Math.floor(enemyInBasin!.y);
    const attempt = engine.placeTower('harpon', col, row);
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) {
      expect(attempt.reason).toBe('enemy_present');
    }
  });
});
