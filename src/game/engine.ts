import {
  ENEMY_CONFIGS,
  SELL_REFUND_RATIO,
  STARTING_LIVES,
  STARTING_PEARLS,
  TOTAL_WAVES,
  TOWER_CONFIGS,
  WAVES,
} from './config';
import { getMapDefinition, DEFAULT_SEED } from './maps';
import { buildTowerBlockSet, findShortestPath, validateTowerPlacement } from './pathfinding';
import type {
  BeamEffect,
  Enemy,
  EnemyType,
  EngineCallbacks,
  FloatingText,
  GamePhase,
  GridCoord,
  MapDefinition,
  MapVariantId,
  Particle,
  PlacementCheckResult,
  Projectile,
  ShockwaveEffect,
  Tower,
  TowerLevelSpec,
  TowerType,
  WaveDefinition,
} from './types';

interface PendingSpawn {
  delay: number;
  type: EnemyType;
}

const MAX_PARTICLES = 150;

export class GameEngine {
  map: MapDefinition;
  phase: GamePhase = 'title';
  pearls: number = STARTING_PEARLS;
  lives: number = STARTING_LIVES;
  maxLives: number = STARTING_LIVES;
  score: number = 0;

  waveNumber: number = 0; // 0 before wave 1, 1..8 during/after waves
  waveActive: boolean = false;
  waveTotalEnemies: number = 0;
  waveRemainingToSpawn: number = 0;

  paused: boolean = false;
  speedMultiplier: 1 | 2 = 1;

  towers: Tower[] = [];
  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  beams: BeamEffect[] = [];
  shockwaves: ShockwaveEffect[] = [];
  particles: Particle[] = [];
  floatingTexts: FloatingText[] = [];

  currentPath: GridCoord[] = [];
  time: number = 0;
  enemiesKilled: number = 0;
  towersBuilt: number = 0;
  citadelDamageFlash: number = 0;
  screenShake: number = 0;

  private nextId: number = 1;
  private spawnQueue: PendingSpawn[] = [];
  private spawnTimer: number = 0;
  private prismeSoundCooldown: number = 0;
  private callbacks: EngineCallbacks;

  constructor(variant: MapVariantId = 'atoll', seed: string = DEFAULT_SEED, callbacks: EngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.map = getMapDefinition(variant, seed);
    this.recomputeBasePath();
  }

  setCallbacks(callbacks: EngineCallbacks): void {
    this.callbacks = callbacks;
  }

  loadMap(variant: MapVariantId, seed: string = DEFAULT_SEED, enterPlaying: boolean = false): void {
    this.map = getMapDefinition(variant, seed);
    this.resetRun(enterPlaying ? 'playing' : 'title');
  }

  startNewGame(): void {
    this.resetRun('playing');
  }

  restart(): void {
    this.resetRun('playing');
  }

  returnToTitle(): void {
    this.resetRun('title');
  }

  private resetRun(nextPhase: GamePhase): void {
    this.phase = nextPhase;
    this.pearls = STARTING_PEARLS;
    this.lives = STARTING_LIVES;
    this.maxLives = STARTING_LIVES;
    this.score = 0;
    this.waveNumber = 0;
    this.waveActive = false;
    this.waveTotalEnemies = 0;
    this.waveRemainingToSpawn = 0;
    this.paused = false;
    this.speedMultiplier = 1;
    this.towers = [];
    this.enemies = [];
    this.projectiles = [];
    this.beams = [];
    this.shockwaves = [];
    this.particles = [];
    this.floatingTexts = [];
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.enemiesKilled = 0;
    this.towersBuilt = 0;
    this.citadelDamageFlash = 0;
    this.screenShake = 0;
    this.nextId = 1;
    this.recomputeBasePath();
    this.callbacks.onStateChange?.();
  }

  private recomputeBasePath(): void {
    const blocked = buildTowerBlockSet(this.towers);
    const path = findShortestPath(this.map, this.map.spawn, this.map.citadel, blocked);
    this.currentPath = path ?? [this.map.spawn, this.map.citadel];
  }

  getTowerAt(col: number, row: number): Tower | undefined {
    return this.towers.find((t) => t.col === col && t.row === row);
  }

  getTowerById(id: number): Tower | undefined {
    return this.towers.find((t) => t.id === id);
  }

  getTowerSpec(tower: Tower): TowerLevelSpec {
    return TOWER_CONFIGS[tower.type].levels[tower.level - 1];
  }

  getUpgradeCost(tower: Tower): number | null {
    if (tower.level >= 3) return null;
    return TOWER_CONFIGS[tower.type].upgradeCosts[tower.level - 1];
  }

  getSellRefund(tower: Tower): number {
    return Math.round(tower.totalInvested * SELL_REFUND_RATIO);
  }

  getNextWaveDefinition(): WaveDefinition | null {
    if (this.waveNumber >= TOTAL_WAVES) return null;
    return WAVES[this.waveNumber];
  }

  getCurrentWaveDefinition(): WaveDefinition | null {
    if (this.waveNumber <= 0 || this.waveNumber > TOTAL_WAVES) return null;
    return WAVES[this.waveNumber - 1];
  }

  getActiveBoss(): Enemy | null {
    return this.enemies.find((e) => e.isBoss) ?? null;
  }

  checkPlacement(type: TowerType, col: number, row: number): PlacementCheckResult {
    const cfg = TOWER_CONFIGS[type];
    return validateTowerPlacement({
      map: this.map,
      towers: this.towers,
      enemies: this.enemies,
      currentPath: this.currentPath,
      col,
      row,
      pearls: this.pearls,
      cost: cfg.cost,
    });
  }

  placeTower(type: TowerType, col: number, row: number): { ok: true; tower: Tower } | { ok: false; message: string; reason: string } {
    if (this.phase !== 'playing') {
      return { ok: false, message: 'Partie inactive.', reason: 'inactive' };
    }
    const check = this.checkPlacement(type, col, row);
    if (!check.ok) {
      this.callbacks.onSound?.('invalid');
      this.callbacks.onNotice?.(check.message, 'warn');
      return { ok: false, message: check.message, reason: check.reason };
    }

    const cfg = TOWER_CONFIGS[type];
    this.pearls -= cfg.cost;
    const tower: Tower = {
      id: this.nextId++,
      type,
      col,
      row,
      level: 1,
      totalInvested: cfg.cost,
      cooldownRemaining: 0,
      angle: -Math.PI / 2,
      recoil: 0,
      activeTargetIds: [],
      kills: 0,
    };
    this.towers.push(tower);
    this.towersBuilt += 1;

    // Update base path and dynamically reroute active enemies if placed in a navigable basin
    this.currentPath = check.nextPath;
    if (this.map.tiles[row][col] === 'basin') {
      this.rerouteActiveEnemies();
      if (check.reroutes) {
        this.callbacks.onNotice?.('Courant dévié ! Nouveau tracé calculé.', 'info');
      }
    }

    this.spawnBurst(col + 0.5, row + 0.5, cfg.accentColor, 14, 'spark');
    this.callbacks.onSound?.('place');
    this.callbacks.onStateChange?.();
    return { ok: true, tower };
  }

  upgradeTower(towerId: number): { ok: true; tower: Tower } | { ok: false; message: string } {
    if (this.phase !== 'playing') return { ok: false, message: 'Partie inactive.' };
    const tower = this.getTowerById(towerId);
    if (!tower) return { ok: false, message: 'Tour introuvable.' };

    const cost = this.getUpgradeCost(tower);
    if (cost === null) {
      this.callbacks.onSound?.('invalid');
      return { ok: false, message: 'Niveau maximal atteint.' };
    }
    if (this.pearls < cost) {
      const msg = `Perles insuffisantes (${cost} requises).`;
      this.callbacks.onSound?.('invalid');
      this.callbacks.onNotice?.(msg, 'warn');
      return { ok: false, message: msg };
    }

    this.pearls -= cost;
    tower.level = (tower.level + 1) as 1 | 2 | 3;
    tower.totalInvested += cost;
    const cfg = TOWER_CONFIGS[tower.type];

    this.spawnBurst(tower.col + 0.5, tower.row + 0.5, cfg.accentColor, 18, 'spark');
    this.shockwaves.push({
      x: tower.col + 0.5,
      y: tower.row + 0.5,
      radius: 0.15,
      maxRadius: 1.05,
      life: 0,
      maxLife: 0.36,
      color: cfg.accentColor,
    });
    this.floatingTexts.push({
      x: tower.col + 0.5,
      y: tower.row + 0.2,
      text: `Niv. ${tower.level}`,
      color: cfg.accentColor,
      life: 0,
      maxLife: 0.9,
    });
    this.callbacks.onSound?.('upgrade');
    this.callbacks.onStateChange?.();
    return { ok: true, tower };
  }

  sellTower(towerId: number): { ok: true; refund: number } | { ok: false; message: string } {
    if (this.phase !== 'playing') return { ok: false, message: 'Partie inactive.' };
    const idx = this.towers.findIndex((t) => t.id === towerId);
    if (idx === -1) return { ok: false, message: 'Tour introuvable.' };

    const [tower] = this.towers.splice(idx, 1);
    const refund = this.getSellRefund(tower);
    this.pearls += refund;

    // Recompute paths when a tower is removed (may reopen a shorter path in a basin)
    this.recomputeBasePath();
    if (this.map.tiles[tower.row][tower.col] === 'basin') {
      this.rerouteActiveEnemies();
    }

    this.spawnBurst(tower.col + 0.5, tower.row + 0.5, '#ffd166', 12, 'bubble');
    this.floatingTexts.push({
      x: tower.col + 0.5,
      y: tower.row + 0.3,
      text: `+${refund} ◈`,
      color: '#ffd166',
      life: 0,
      maxLife: 0.95,
    });
    this.callbacks.onSound?.('sell');
    this.callbacks.onStateChange?.();
    return { ok: true, refund };
  }

  private rerouteActiveEnemies(): void {
    const blocked = buildTowerBlockSet(this.towers);
    for (const enemy of this.enemies) {
      const eCol = Math.max(0, Math.min(this.map.cols - 1, Math.floor(enemy.x)));
      const eRow = Math.max(0, Math.min(this.map.rows - 1, Math.floor(enemy.y)));
      const nextPath = findShortestPath(this.map, { col: eCol, row: eRow }, this.map.citadel, blocked);
      if (nextPath && nextPath.length >= 1) {
        enemy.path = nextPath;
        enemy.pathIndex = nextPath.length > 1 ? 1 : 0;
      }
    }
  }

  togglePause(): boolean {
    if (this.phase !== 'playing') return this.paused;
    this.paused = !this.paused;
    this.callbacks.onStateChange?.();
    return this.paused;
  }

  setPaused(value: boolean): void {
    if (this.phase !== 'playing') return;
    if (this.paused !== value) {
      this.paused = value;
      this.callbacks.onStateChange?.();
    }
  }

  toggleSpeed(): 1 | 2 {
    this.speedMultiplier = this.speedMultiplier === 1 ? 2 : 1;
    this.callbacks.onStateChange?.();
    return this.speedMultiplier;
  }

  startNextWave(): boolean {
    if (this.phase !== 'playing' || this.waveActive) return false;
    if (this.waveNumber >= TOTAL_WAVES) return false;

    const wave = WAVES[this.waveNumber];
    this.waveNumber = wave.waveNumber;
    this.waveActive = true;
    this.paused = false;

    this.spawnQueue = [];
    for (const group of wave.groups) {
      for (let i = 0; i < group.count; i++) {
        const delay = i === 0 ? (group.delayBefore ?? 0.25) : group.interval;
        this.spawnQueue.push({ delay, type: group.type });
      }
    }
    this.waveTotalEnemies = this.spawnQueue.length;
    this.waveRemainingToSpawn = this.spawnQueue.length;
    this.spawnTimer = this.spawnQueue.length > 0 ? this.spawnQueue[0].delay : 0;

    const hasBoss = wave.groups.some((g) => g.type === 'leviathan');
    this.callbacks.onSound?.(hasBoss ? 'boss_spawn' : 'wave_start');
    this.callbacks.onNotice?.(
      hasBoss ? `Vague ${wave.waveNumber} : ${wave.name} !` : `Vague ${wave.waveNumber}/${TOTAL_WAVES} — ${wave.name}`,
      hasBoss ? 'warn' : 'info'
    );
    this.callbacks.onStateChange?.();
    return true;
  }

  /**
   * Advances the simulation by `rawDt` seconds (clamped for stability, scaled by 1x/2x).
   */
  step(rawDt: number): void {
    const clamped = Math.min(Math.max(rawDt, 0), 0.08);
    // Keep subtle ambient clock running even on title/pause for water animation
    this.time += clamped;

    if (this.phase !== 'playing' || this.paused) {
      // Still gently fade flashes/particles on victory/defeat
      if (this.phase === 'victory' || this.phase === 'defeat') {
        this.updateEffects(clamped);
      }
      return;
    }

    const dt = clamped * this.speedMultiplier;
    // Substep when 2x or high dt to keep projectile/path precision crisp
    const substeps = dt > 0.035 ? 2 : 1;
    const subDt = dt / substeps;

    for (let s = 0; s < substeps; s++) {
      this.stepSimulation(subDt);
      if (this.phase !== 'playing') break;
    }
  }

  private stepSimulation(dt: number): void {
    if (this.citadelDamageFlash > 0) this.citadelDamageFlash = Math.max(0, this.citadelDamageFlash - dt * 2.2);
    if (this.screenShake > 0) this.screenShake = Math.max(0, this.screenShake - dt * 2.8);
    if (this.prismeSoundCooldown > 0) this.prismeSoundCooldown = Math.max(0, this.prismeSoundCooldown - dt);

    this.updateSpawning(dt);
    this.updateEnemies(dt);
    if (this.phase !== 'playing') return;

    this.beams = [];
    this.updateTowers(dt);
    this.updateProjectiles(dt);
    this.updateEffects(dt);
    this.checkWaveCompletion();
  }

  private updateSpawning(dt: number): void {
    if (!this.waveActive || this.spawnQueue.length === 0) return;

    this.spawnTimer -= dt;
    while (this.spawnQueue.length > 0 && this.spawnTimer <= 0) {
      const next = this.spawnQueue.shift()!;
      this.spawnEnemy(next.type);
      this.waveRemainingToSpawn = this.spawnQueue.length;
      if (this.spawnQueue.length > 0) {
        this.spawnTimer += this.spawnQueue[0].delay;
      }
    }
  }

  private spawnEnemy(type: EnemyType): void {
    const cfg = ENEMY_CONFIGS[type];
    const wave = this.getCurrentWaveDefinition();
    const scale = cfg.isBoss ? 1 : (wave?.hpScale ?? 1);
    const maxHp = Math.round(cfg.baseHp * scale);

    const pathCopy = this.currentPath.map((p) => ({ ...p }));
    const start = pathCopy[0] ?? this.map.spawn;

    const enemy: Enemy = {
      id: this.nextId++,
      type,
      x: start.col + 0.5,
      y: start.row + 0.5,
      hp: maxHp,
      maxHp,
      baseSpeed: cfg.speed,
      reward: cfg.reward,
      score: cfg.score,
      livesCost: cfg.livesCost,
      armor: cfg.armor,
      isBoss: Boolean(cfg.isBoss),
      path: pathCopy,
      pathIndex: pathCopy.length > 1 ? 1 : 0,
      slowFactor: 1,
      slowTimer: 0,
      hitFlash: 0,
      phase: (this.nextId * 1.37) % (Math.PI * 2),
      facing: Math.PI / 2,
      distanceTraveled: 0,
    };

    this.enemies.push(enemy);
    this.spawnBurst(enemy.x, enemy.y, cfg.primaryColor, cfg.isBoss ? 22 : 6, 'bubble');
    if (cfg.isBoss) {
      this.screenShake = 0.45;
      this.callbacks.onSound?.('boss_spawn');
      this.callbacks.onNotice?.('Le Léviathan des Abysses surgit de la faille !', 'warn');
    }
    this.callbacks.onStateChange?.();
  }

  private updateEnemies(dt: number): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.phase += dt * (e.type === 'meduse' ? 6.2 : e.type === 'raie' ? 4.4 : 3.2);
      if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - dt * 5);

      if (e.slowTimer > 0) {
        e.slowTimer -= dt;
        if (e.slowTimer <= 0) {
          e.slowTimer = 0;
          e.slowFactor = 1;
        }
      }

      const speed = e.baseSpeed * e.slowFactor;
      let moveBudget = speed * dt;

      while (moveBudget > 0 && e.pathIndex < e.path.length) {
        const wp = e.path[e.pathIndex];
        const tx = wp.col + 0.5;
        const ty = wp.row + 0.5;
        const dx = tx - e.x;
        const dy = ty - e.y;
        const dist = Math.hypot(dx, dy);

        if (dist <= moveBudget) {
          e.x = tx;
          e.y = ty;
          e.distanceTraveled += dist;
          moveBudget -= dist;
          e.pathIndex += 1;
        } else {
          const ratio = moveBudget / dist;
          e.x += dx * ratio;
          e.y += dy * ratio;
          e.distanceTraveled += moveBudget;
          e.facing = Math.atan2(dy, dx);
          moveBudget = 0;
        }
      }

      // Reached Citadel!
      if (e.pathIndex >= e.path.length) {
        this.enemies.splice(i, 1);
        this.handleCitadelBreach(e);
        if (this.phase !== 'playing') return;
      }
    }
  }

  private handleCitadelBreach(enemy: Enemy): void {
    this.lives = Math.max(0, this.lives - enemy.livesCost);
    this.citadelDamageFlash = 1;
    this.screenShake = Math.max(this.screenShake, enemy.isBoss ? 0.8 : 0.35);

    const cx = this.map.citadel.col + 0.5;
    const cy = this.map.citadel.row + 0.5;
    this.shockwaves.push({
      x: cx,
      y: cy,
      radius: 0.2,
      maxRadius: 1.6,
      life: 0,
      maxLife: 0.45,
      color: '#ff4f79',
    });
    this.floatingTexts.push({
      x: cx,
      y: cy - 0.3,
      text: `-${enemy.livesCost} PV`,
      color: '#ff6b8b',
      life: 0,
      maxLife: 1.1,
    });
    this.callbacks.onSound?.('citadel_hit');

    if (this.lives <= 0) {
      this.phase = 'defeat';
      this.waveActive = false;
      this.callbacks.onSound?.('defeat');
    }
    this.callbacks.onStateChange?.();
  }

  private updateTowers(dt: number): void {
    for (const tower of this.towers) {
      const spec = this.getTowerSpec(tower);
      const tx = tower.col + 0.5;
      const ty = tower.row + 0.5;
      if (tower.recoil > 0) tower.recoil = Math.max(0, tower.recoil - dt * 5);
      if (tower.cooldownRemaining > 0) tower.cooldownRemaining = Math.max(0, tower.cooldownRemaining - dt);

      // Find all enemies inside range
      const inRange: Enemy[] = [];
      const rangeSq = spec.range * spec.range;
      for (const e of this.enemies) {
        const dx = e.x - tx;
        const dy = e.y - ty;
        if (dx * dx + dy * dy <= rangeSq) {
          inRange.push(e);
        }
      }

      if (inRange.length === 0) {
        tower.activeTargetIds = [];
        continue;
      }

      // Sort by furthest along route ("First" targeting)
      inRange.sort((a, b) => b.distanceTraveled - a.distanceTraveled);

      if (tower.type === 'prisme') {
        const maxTargets = spec.maxTargets ?? 1;
        // Prefer enemies that are not yet heavily slowed, while still prioritizing furthest ahead
        const sortedForSlow = [...inRange].sort((a, b) => {
          const aSlowed = a.slowTimer > 0.4 ? 1 : 0;
          const bSlowed = b.slowTimer > 0.4 ? 1 : 0;
          if (aSlowed !== bSlowed) return aSlowed - bSlowed;
          return b.distanceTraveled - a.distanceTraveled;
        });

        const targets = sortedForSlow.slice(0, maxTargets);
        tower.activeTargetIds = targets.map((t) => t.id);
        tower.angle = Math.atan2(targets[0].y - ty, targets[0].x - tx);

        for (const target of targets) {
          const slowFactor = spec.slowFactor ?? 0.6;
          const slowDur = spec.slowDuration ?? 2.2;
          target.slowFactor = Math.min(target.slowFactor, slowFactor);
          target.slowTimer = Math.max(target.slowTimer, slowDur);

          this.beams.push({
            fromX: tx,
            fromY: ty,
            toX: target.x,
            toY: target.y,
            intensity: 1,
            level: tower.level,
          });

          // Harmonic beam deals continuous damage ignoring armor
          this.damageEnemy(target, spec.damage * dt, tower, true);
        }

        if (this.prismeSoundCooldown <= 0) {
          this.callbacks.onSound?.('prisme');
          this.prismeSoundCooldown = 0.55;
        }
        continue;
      }

      // Harpon or Mortier projectile tower
      const primary = inRange[0];
      tower.activeTargetIds = [primary.id];
      tower.angle = Math.atan2(primary.y - ty, primary.x - tx);

      if (tower.cooldownRemaining <= 0) {
        tower.cooldownRemaining = spec.cooldown;
        tower.recoil = 1;

        const cfg = TOWER_CONFIGS[tower.type];
        const dist = Math.max(0.1, Math.hypot(primary.x - tx, primary.y - ty));
        this.projectiles.push({
          id: this.nextId++,
          towerType: tower.type,
          x: tx + Math.cos(tower.angle) * 0.22,
          y: ty + Math.sin(tower.angle) * 0.22,
          startX: tx,
          startY: ty,
          targetX: primary.x,
          targetY: primary.y,
          targetEnemyId: primary.id,
          speed: spec.projectileSpeed ?? 10,
          damage: spec.damage,
          splashRadius: spec.splashRadius ?? 0,
          progress: 0,
          totalDist: dist,
          color: cfg.accentColor,
          trail: [],
        });

        this.callbacks.onSound?.(tower.type === 'harpon' ? 'harpon' : 'mortier');
      }
    }
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > (p.towerType === 'mortier' ? 9 : 6)) {
        p.trail.shift();
      }

      // Track live enemy for harpon darts; mortar locks on impact area with slight early tracking
      const target = this.enemies.find((e) => e.id === p.targetEnemyId);
      if (target && (p.towerType === 'harpon' || p.progress < 0.35)) {
        p.targetX = target.x;
        p.targetY = target.y;
      }

      if (p.towerType === 'mortier') {
        const travelTime = Math.max(0.14, p.totalDist / p.speed);
        p.progress += dt / travelTime;
        const t = Math.min(1, p.progress);
        p.x = p.startX + (p.targetX - p.startX) * t;
        p.y = p.startY + (p.targetY - p.startY) * t;

        if (p.progress >= 1) {
          this.detonateMortar(p);
          this.projectiles.splice(i, 1);
        }
      } else {
        const dx = p.targetX - p.x;
        const dy = p.targetY - p.y;
        const dist = Math.hypot(dx, dy);
        const step = p.speed * dt;

        if (dist <= step + 0.14) {
          if (target) {
            this.damageEnemy(target, p.damage, undefined, false);
          }
          this.spawnBurst(p.targetX, p.targetY, p.color, 6, 'spark');
          this.projectiles.splice(i, 1);
        } else {
          p.x += (dx / dist) * step;
          p.y += (dy / dist) * step;
        }
      }
    }
  }

  private detonateMortar(p: Projectile): void {
    const rSq = p.splashRadius * p.splashRadius;
    // Copy array since damageEnemy may splice killed enemies
    const snapshot = [...this.enemies];
    for (const enemy of snapshot) {
      const dx = enemy.x - p.targetX;
      const dy = enemy.y - p.targetY;
      const dSq = dx * dx + dy * dy;
      if (dSq <= rSq) {
        // Gentle falloff at outer rim (100% near center, 72% at edge)
        const falloff = 1 - 0.28 * (Math.sqrt(dSq) / Math.max(0.01, p.splashRadius));
        this.damageEnemy(enemy, p.damage * falloff, undefined, false, 0.5);
      }
    }

    this.shockwaves.push({
      x: p.targetX,
      y: p.targetY,
      radius: 0.15,
      maxRadius: p.splashRadius,
      life: 0,
      maxLife: 0.34,
      color: '#ffb84d',
    });
    this.spawnBurst(p.targetX, p.targetY, '#ffb84d', 14, 'spark');
    this.screenShake = Math.max(this.screenShake, 0.12);
  }

  private damageEnemy(
    enemy: Enemy,
    rawDamage: number,
    sourceTower?: Tower,
    ignoreArmor: boolean = false,
    armorFactor: number = 1
  ): void {
    if (enemy.hp <= 0) return;

    const effectiveDamage = ignoreArmor
      ? rawDamage
      : Math.max(rawDamage * 0.25, rawDamage - enemy.armor * armorFactor);

    enemy.hp -= effectiveDamage;
    if (!ignoreArmor) {
      enemy.hitFlash = 1;
    }

    if (enemy.hp <= 0) {
      const idx = this.enemies.indexOf(enemy);
      if (idx !== -1) {
        this.enemies.splice(idx, 1);
      }
      if (sourceTower) sourceTower.kills += 1;
      this.enemiesKilled += 1;
      this.pearls += enemy.reward;
      const waveMult = 1 + Math.max(0, this.waveNumber - 1) * 0.12;
      this.score += Math.round(enemy.score * waveMult);

      const cfg = ENEMY_CONFIGS[enemy.type];
      this.spawnBurst(enemy.x, enemy.y, cfg.primaryColor, enemy.isBoss ? 34 : 12, 'spark');
      this.spawnBurst(enemy.x, enemy.y, '#9ff7ff', enemy.isBoss ? 16 : 5, 'bubble');
      if (enemy.isBoss) {
        this.shockwaves.push({
          x: enemy.x,
          y: enemy.y,
          radius: 0.2,
          maxRadius: 2.6,
          life: 0,
          maxLife: 0.65,
          color: '#f554e5',
        });
        this.screenShake = 0.65;
      }
      this.floatingTexts.push({
        x: enemy.x,
        y: enemy.y - 0.18,
        text: `+${enemy.reward} ◈`,
        color: '#ffd166',
        life: 0,
        maxLife: 0.85,
      });
      this.callbacks.onSound?.('enemy_die');
      this.callbacks.onStateChange?.();
    }
  }

  private checkWaveCompletion(): void {
    if (!this.waveActive) return;
    if (this.spawnQueue.length > 0 || this.enemies.length > 0) return;

    this.waveActive = false;
    const wave = this.getCurrentWaveDefinition();
    if (wave) {
      this.pearls += wave.bonusPearls;
      this.score += 100 * wave.waveNumber + this.lives * 5;
    }

    if (this.waveNumber >= TOTAL_WAVES && this.lives > 0) {
      this.score += 500 + this.lives * 50 + this.pearls * 2;
      this.phase = 'victory';
      const cx = this.map.citadel.col + 0.5;
      const cy = this.map.citadel.row + 0.5;
      this.spawnBurst(cx, cy, '#2ef2ff', 28, 'spark');
      this.spawnBurst(cx, cy, '#38f9b4', 24, 'bubble');
      this.callbacks.onSound?.('victory');
      this.callbacks.onNotice?.('Victoire ! La Citadelle des marées est sauve !', 'good');
    } else if (wave) {
      this.callbacks.onNotice?.(`Vague ${wave.waveNumber} repoussée ! +${wave.bonusPearls} Perles`, 'good');
    }

    this.callbacks.onStateChange?.();
  }

  private updateEffects(dt: number): void {
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.life += dt;
      const t = Math.min(1, s.life / s.maxLife);
      // Ease-out cubic expansion
      s.radius = s.maxRadius * (1 - Math.pow(1 - t, 3));
      if (s.life >= s.maxLife) this.shockwaves.splice(i, 1);
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'bubble') {
        p.vy -= 0.7 * dt; // gently float upward
        p.vx *= 0.96;
      } else {
        p.vx *= 0.92;
        p.vy *= 0.92;
      }
    }

    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.life += dt;
      ft.y -= 0.62 * dt;
      if (ft.life >= ft.maxLife) this.floatingTexts.splice(i, 1);
    }
  }

  private spawnBurst(x: number, y: number, color: string, count: number, kind: 'spark' | 'bubble'): void {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) {
        this.particles.shift();
      }
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.45;
      const speed = kind === 'bubble' ? 0.35 + Math.random() * 0.95 : 0.8 + Math.random() * 2.2;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: kind === 'bubble' ? 2.2 + Math.random() * 2.6 : 1.6 + Math.random() * 2.4,
        life: 0,
        maxLife: kind === 'bubble' ? 0.55 + Math.random() * 0.45 : 0.32 + Math.random() * 0.32,
        color,
        kind,
      });
    }
  }
}
