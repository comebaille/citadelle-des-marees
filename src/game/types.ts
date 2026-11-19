export type TileKind = 'abyss' | 'platform' | 'channel' | 'basin' | 'spawn' | 'citadel';

export type MapVariantId = 'atoll' | 'detroit' | 'fosse' | 'seeded';

export type TowerType = 'harpon' | 'mortier' | 'prisme';

export type EnemyType = 'meduse' | 'raie' | 'crabe' | 'leviathan';

export type GamePhase = 'title' | 'playing' | 'victory' | 'defeat';

export interface GridCoord {
  col: number;
  row: number;
}

export interface MapDefinition {
  id: MapVariantId;
  name: string;
  subtitle: string;
  seed?: string;
  cols: number;
  rows: number;
  tiles: TileKind[][];
  spawn: GridCoord;
  citadel: GridCoord;
}

export interface TowerLevelSpec {
  level: 1 | 2 | 3;
  damage: number;
  cooldown: number; // seconds (for prisme: tick/visual cadence, damage is DPS)
  range: number; // in grid tiles
  splashRadius?: number; // tiles, for mortier
  slowFactor?: number; // multiplier < 1, for prisme
  slowDuration?: number; // seconds, for prisme
  maxTargets?: number; // for prisme multi-beam
  projectileSpeed?: number; // tiles/sec
}

export interface TowerConfig {
  type: TowerType;
  name: string;
  shortName: string;
  roleLabel: string;
  description: string;
  cost: number;
  upgradeCosts: [number, number]; // cost to Lv2, cost to Lv3
  accentColor: string;
  glowColor: string;
  levels: [TowerLevelSpec, TowerLevelSpec, TowerLevelSpec];
}

export interface EnemyConfig {
  type: EnemyType;
  name: string;
  roleLabel: string;
  baseHp: number;
  speed: number; // tiles/sec
  reward: number;
  score: number;
  livesCost: number;
  armor: number;
  radius: number; // fraction of tile size
  isBoss?: boolean;
  primaryColor: string;
  glowColor: string;
}

export interface WaveSpawnGroup {
  type: EnemyType;
  count: number;
  interval: number; // seconds between enemies
  delayBefore?: number; // seconds before group starts
}

export interface WaveDefinition {
  waveNumber: number;
  name: string;
  bonusPearls: number;
  hpScale: number;
  groups: WaveSpawnGroup[];
}

export interface Tower {
  id: number;
  type: TowerType;
  col: number;
  row: number;
  level: 1 | 2 | 3;
  totalInvested: number;
  cooldownRemaining: number;
  angle: number;
  recoil: number;
  activeTargetIds: number[];
  kills: number;
}

export interface Enemy {
  id: number;
  type: EnemyType;
  x: number; // tile coordinate space (center of tile (c,r) is (c+0.5, r+0.5))
  y: number;
  hp: number;
  maxHp: number;
  baseSpeed: number;
  reward: number;
  score: number;
  livesCost: number;
  armor: number;
  isBoss: boolean;
  path: GridCoord[];
  pathIndex: number; // index of next waypoint in path
  slowFactor: number; // 1 = normal, 0.45 = 55% slowed
  slowTimer: number;
  hitFlash: number;
  phase: number; // animation phase
  facing: number; // radians
  distanceTraveled: number;
}

export interface Projectile {
  id: number;
  towerType: 'harpon' | 'mortier';
  x: number;
  y: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  targetEnemyId: number;
  speed: number;
  damage: number;
  splashRadius: number;
  progress: number; // 0..1 for arcing mortar
  totalDist: number;
  color: string;
  trail: Array<{ x: number; y: number }>;
}

export interface BeamEffect {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  intensity: number;
  level: 1 | 2 | 3;
}

export interface ShockwaveEffect {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  life: number;
  maxLife: number;
  color: string;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  color: string;
  kind: 'spark' | 'bubble' | 'ring';
}

export interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

export type PlacementRejectionReason =
  | 'out_of_bounds'
  | 'on_path'
  | 'blocked_tile'
  | 'occupied'
  | 'insufficient_pearls'
  | 'enemy_present'
  | 'blocks_path';

export type PlacementCheckResult =
  | { ok: true; nextPath: GridCoord[]; reroutes: boolean }
  | { ok: false; reason: PlacementRejectionReason; message: string };

export interface EngineCallbacks {
  onSound?: (event: SoundEvent) => void;
  onNotice?: (message: string, tone?: 'info' | 'warn' | 'good') => void;
  onStateChange?: () => void;
}

export type SoundEvent =
  | 'place'
  | 'upgrade'
  | 'sell'
  | 'harpon'
  | 'mortier'
  | 'prisme'
  | 'enemy_die'
  | 'wave_start'
  | 'boss_spawn'
  | 'citadel_hit'
  | 'victory'
  | 'defeat'
  | 'invalid';
