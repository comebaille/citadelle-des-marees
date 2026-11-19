import { describe, expect, it } from 'vitest';
import { SELL_REFUND_RATIO, STARTING_LIVES, STARTING_PEARLS, TOTAL_WAVES, TOWER_CONFIGS } from '../src/game/config';
import { GameEngine } from '../src/game/engine';
import { isTileWalkable } from '../src/game/pathfinding';

describe('Économie, tours, combat et conditions de victoire/défaite', () => {
  it('gère l’achat, l’amélioration jusqu’au niveau 3 et la vente avec remboursement exact', () => {
    const engine = new GameEngine('atoll');
    engine.startNewGame();
    expect(engine.pearls).toBe(STARTING_PEARLS);

    // Place a Harpon on a valid platform pedestal (3,3)
    const placeRes = engine.placeTower('harpon', 3, 3);
    expect(placeRes.ok).toBe(true);
    if (!placeRes.ok) return;

    const harpon = placeRes.tower;
    const baseCost = TOWER_CONFIGS.harpon.cost;
    expect(engine.pearls).toBe(STARTING_PEARLS - baseCost);

    // Upgrade to Level 2
    const upg2Cost = TOWER_CONFIGS.harpon.upgradeCosts[0];
    const upg2 = engine.upgradeTower(harpon.id);
    expect(upg2.ok).toBe(true);
    expect(harpon.level).toBe(2);
    expect(engine.pearls).toBe(STARTING_PEARLS - baseCost - upg2Cost);

    // Insufficient pearls for Level 3 (150 - 50 - 45 = 55 < 75)
    const upg3Fail = engine.upgradeTower(harpon.id);
    expect(upg3Fail.ok).toBe(false);
    expect(harpon.level).toBe(2);

    // Give pearls, upgrade to Level 3, verify cap at Level 3
    engine.pearls += 100;
    const upg3Cost = TOWER_CONFIGS.harpon.upgradeCosts[1];
    const upg3 = engine.upgradeTower(harpon.id);
    expect(upg3.ok).toBe(true);
    expect(harpon.level).toBe(3);

    const upg4 = engine.upgradeTower(harpon.id);
    expect(upg4.ok).toBe(false);

    // Sell tower and verify 70% refund of total invested
    const totalInvested = baseCost + upg2Cost + upg3Cost;
    const pearlsBeforeSell = engine.pearls;
    const sellRes = engine.sellTower(harpon.id);
    expect(sellRes.ok).toBe(true);
    if (sellRes.ok) {
      expect(sellRes.refund).toBe(Math.round(totalInvested * SELL_REFUND_RATIO));
      expect(engine.pearls).toBe(pearlsBeforeSell + sellRes.refund);
    }
    expect(engine.towers.length).toBe(0);
  });

  it('applique les dégâts de zone du Mortier et le ralentissement du Prisme', () => {
    // 1. Test Prisme slow effect: compare enemy travel distance with vs without Prisme
    const engineSlow = new GameEngine('atoll');
    engineSlow.startNewGame();
    engineSlow.placeTower('prisme', 3, 1); // right next to spawn channel (4,1) and (3,2)
    engineSlow.startNextWave();

    const enginePlain = new GameEngine('atoll');
    enginePlain.startNewGame();
    enginePlain.startNextWave();

    for (let i = 0; i < 90; i++) {
      engineSlow.step(0.04);
      enginePlain.step(0.04);
    }

    const slowedEnemy = engineSlow.enemies[0];
    const plainEnemy = enginePlain.enemies[0];
    expect(slowedEnemy).toBeDefined();
    expect(plainEnemy).toBeDefined();
    expect(slowedEnemy.slowFactor).toBeLessThan(1);
    expect(slowedEnemy.distanceTraveled).toBeLessThan(plainEnemy.distanceTraveled * 0.85);

    // 2. Test Mortier splash hits multiple clustered enemies
    const engineMortier = new GameEngine('atoll');
    engineMortier.startNewGame();
    engineMortier.placeTower('mortier', 3, 3); // covers (2,2)-(2,4) & (3,2)-(4,2)
    engineMortier.startNextWave();

    let splashDetected = false;
    for (let i = 0; i < 240; i++) {
      engineMortier.step(0.04);
      const damagedCount = engineMortier.enemies.filter((e) => e.hp < e.maxHp).length;
      if (damagedCount >= 2 || engineMortier.enemiesKilled >= 2) {
        splashDetected = true;
        break;
      }
    }
    expect(splashDetected).toBe(true);
  });

  it('fait suivre aux ennemis uniquement des cases navigables et déclenche la défaite à 0 PV', () => {
    const engine = new GameEngine('atoll');
    engine.startNewGame();
    engine.lives = 4; // low lives so wave 1 undefended breaches and causes defeat
    engine.startNextWave();

    let maxEnemiesSeen = 0;
    for (let i = 0; i < 1200 && engine.phase === 'playing'; i++) {
      engine.step(0.04);
      maxEnemiesSeen = Math.max(maxEnemiesSeen, engine.enemies.length);
      for (const e of engine.enemies) {
        const c = Math.floor(e.x);
        const r = Math.floor(e.y);
        expect(isTileWalkable(engine.map.tiles[r][c])).toBe(true);
      }
    }

    expect(maxEnemiesSeen).toBeGreaterThan(0);
    expect(engine.lives).toBe(0);
    expect(engine.phase).toBe('defeat');
  });

  it('permet de remporter les 8 vagues (boss Léviathan inclus) et attribue score et bonus', () => {
    const engine = new GameEngine('atoll');
    engine.startNewGame();

    // Build a realistic starter defense with initial 150 pearls (Harpon 50 + Mortier 80 = 130)
    expect(engine.placeTower('harpon', 3, 3).ok).toBe(true);
    expect(engine.placeTower('mortier', 5, 3).ok).toBe(true);

    // Play through all 8 waves, reinvesting earned pearls into upgrades and a Prisme slow tower
    const buildPlan: Array<{ type: 'harpon' | 'mortier' | 'prisme'; col: number; row: number }> = [
      { type: 'prisme', col: 4, row: 5 },
      { type: 'harpon', col: 5, row: 7 },
      { type: 'mortier', col: 4, row: 7 },
      { type: 'harpon', col: 3, row: 7 },
      { type: 'prisme', col: 4, row: 9 },
      { type: 'harpon', col: 5, row: 9 },
    ];

    let bossSeen = false;

    for (let w = 1; w <= TOTAL_WAVES; w++) {
      // Spend available pearls before launching next wave
      for (const spot of buildPlan) {
        if (!engine.getTowerAt(spot.col, spot.row) && engine.pearls >= TOWER_CONFIGS[spot.type].cost) {
          engine.placeTower(spot.type, spot.col, spot.row);
        }
      }
      for (const tower of engine.towers) {
        const upgCost = engine.getUpgradeCost(tower);
        if (upgCost !== null && engine.pearls >= upgCost) {
          engine.upgradeTower(tower.id);
        }
      }

      expect(engine.startNextWave()).toBe(true);
      expect(engine.waveNumber).toBe(w);

      // Run wave until cleared (with generous safety cap)
      for (let tick = 0; tick < 3000 && engine.waveActive && engine.phase === 'playing'; tick++) {
        engine.step(0.04);
        if (engine.getActiveBoss()) bossSeen = true;
      }

      expect(engine.waveActive, `Vague ${w} non terminée`).toBe(false);
      if (w < TOTAL_WAVES) {
        expect(engine.phase, `Défaite prématurée à la vague ${w}`).toBe('playing');
      }
    }

    expect(bossSeen).toBe(true);
    expect(engine.phase).toBe('victory');
    expect(engine.lives).toBeGreaterThan(0);
    expect(engine.lives).toBeLessThanOrEqual(STARTING_LIVES);
    expect(engine.score).toBeGreaterThan(1500);
    expect(engine.enemiesKilled).toBeGreaterThan(80);
  });
});
