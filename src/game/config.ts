import type { EnemyConfig, EnemyType, TowerConfig, TowerType, WaveDefinition } from './types';

export const STARTING_PEARLS = 150;
export const STARTING_LIVES = 20;
export const SELL_REFUND_RATIO = 0.7;
export const EARLY_WAVE_BONUS = 15;
export const TOTAL_WAVES = 8;

export const TOWER_CONFIGS: Record<TowerType, TowerConfig> = {
  harpon: {
    type: 'harpon',
    name: 'Harpon Corail',
    shortName: 'Harpon',
    roleLabel: 'Tir rapide',
    description: 'Salves rapides de dards lumineux, idéal contre les cibles rapides et les boss.',
    cost: 50,
    upgradeCosts: [45, 75],
    accentColor: '#2ef2ff',
    glowColor: 'rgba(46, 242, 255, 0.55)',
    levels: [
      { level: 1, damage: 16, cooldown: 0.34, range: 2.9, projectileSpeed: 11.5 },
      { level: 2, damage: 26, cooldown: 0.27, range: 3.3, projectileSpeed: 12.6 },
      { level: 3, damage: 41, cooldown: 0.21, range: 3.7, projectileSpeed: 13.8 },
    ],
  },
  mortier: {
    type: 'mortier',
    name: 'Mortier Abysses',
    shortName: 'Mortier',
    roleLabel: 'Zone',
    description: 'Orbes incandescents qui explosent en onde de choc sur plusieurs ennemis.',
    cost: 80,
    upgradeCosts: [65, 100],
    accentColor: '#ffb84d',
    glowColor: 'rgba(255, 184, 77, 0.58)',
    levels: [
      { level: 1, damage: 34, cooldown: 1.32, range: 3.1, splashRadius: 1.3, projectileSpeed: 6.2 },
      { level: 2, damage: 56, cooldown: 1.14, range: 3.5, splashRadius: 1.5, projectileSpeed: 6.8 },
      { level: 3, damage: 88, cooldown: 0.96, range: 3.9, splashRadius: 1.75, projectileSpeed: 7.4 },
    ],
  },
  prisme: {
    type: 'prisme',
    name: 'Prisme Cryo-Algue',
    shortName: 'Prisme',
    roleLabel: 'Ralentit',
    description: 'Faisceaux harmoniques continus qui figent le courant et freinent les ennemis.',
    cost: 65,
    upgradeCosts: [55, 85],
    accentColor: '#38f9b4',
    glowColor: 'rgba(56, 249, 180, 0.55)',
    levels: [
      { level: 1, damage: 11, cooldown: 0.1, range: 2.8, slowFactor: 0.6, slowDuration: 2.2, maxTargets: 1 },
      { level: 2, damage: 19, cooldown: 0.1, range: 3.2, slowFactor: 0.5, slowDuration: 2.5, maxTargets: 2 },
      { level: 3, damage: 30, cooldown: 0.1, range: 3.6, slowFactor: 0.4, slowDuration: 2.8, maxTargets: 3 },
    ],
  },
};

export const TOWER_ORDER: TowerType[] = ['harpon', 'mortier', 'prisme'];

export const ENEMY_CONFIGS: Record<EnemyType, EnemyConfig> = {
  meduse: {
    type: 'meduse',
    name: 'Méduse-Éclair',
    roleLabel: 'Rapide',
    baseHp: 46,
    speed: 1.76,
    reward: 12,
    score: 35,
    livesCost: 1,
    armor: 0,
    radius: 0.27,
    primaryColor: '#56e8ff',
    glowColor: 'rgba(86, 232, 255, 0.65)',
  },
  raie: {
    type: 'raie',
    name: 'Raie-Spectre',
    roleLabel: 'Glisseuse',
    baseHp: 86,
    speed: 1.36,
    reward: 16,
    score: 55,
    livesCost: 1,
    armor: 0,
    radius: 0.31,
    primaryColor: '#48f7b9',
    glowColor: 'rgba(72, 247, 185, 0.6)',
  },
  crabe: {
    type: 'crabe',
    name: 'Crabe-Cuirasse',
    roleLabel: 'Blindé',
    baseHp: 175,
    speed: 0.88,
    reward: 24,
    score: 90,
    livesCost: 2,
    armor: 4,
    radius: 0.34,
    primaryColor: '#ff9654',
    glowColor: 'rgba(255, 150, 84, 0.6)',
  },
  leviathan: {
    type: 'leviathan',
    name: 'Léviathan des Abysses',
    roleLabel: 'Boss',
    baseHp: 1550,
    speed: 0.62,
    reward: 180,
    score: 650,
    livesCost: 5,
    armor: 5,
    radius: 0.48,
    isBoss: true,
    primaryColor: '#f554e5',
    glowColor: 'rgba(245, 84, 229, 0.72)',
  },
};

export const WAVES: WaveDefinition[] = [
  {
    waveNumber: 1,
    name: 'Éclaireurs du récif',
    bonusPearls: 25,
    hpScale: 1.0,
    groups: [{ type: 'meduse', count: 7, interval: 0.85 }],
  },
  {
    waveNumber: 2,
    name: 'Courant des raies',
    bonusPearls: 30,
    hpScale: 1.12,
    groups: [
      { type: 'raie', count: 5, interval: 1.05 },
      { type: 'meduse', count: 5, interval: 0.7, delayBefore: 1.0 },
    ],
  },
  {
    waveNumber: 3,
    name: 'Marche des cuirasses',
    bonusPearls: 35,
    hpScale: 1.24,
    groups: [
      { type: 'crabe', count: 4, interval: 1.55 },
      { type: 'meduse', count: 6, interval: 0.68, delayBefore: 0.8 },
    ],
  },
  {
    waveNumber: 4,
    name: 'Essaim phosphorescent',
    bonusPearls: 40,
    hpScale: 1.36,
    groups: [
      { type: 'meduse', count: 10, interval: 0.52 },
      { type: 'raie', count: 6, interval: 0.85, delayBefore: 0.9 },
    ],
  },
  {
    waveNumber: 5,
    name: 'Phalange abyssale',
    bonusPearls: 45,
    hpScale: 1.5,
    groups: [
      { type: 'crabe', count: 5, interval: 1.35 },
      { type: 'raie', count: 6, interval: 0.75, delayBefore: 0.6 },
      { type: 'crabe', count: 3, interval: 1.25, delayBefore: 0.8 },
    ],
  },
  {
    waveNumber: 6,
    name: 'Déferlante nocturne',
    bonusPearls: 50,
    hpScale: 1.65,
    groups: [
      { type: 'meduse', count: 10, interval: 0.45 },
      { type: 'crabe', count: 5, interval: 1.15, delayBefore: 0.7 },
      { type: 'raie', count: 7, interval: 0.68, delayBefore: 0.7 },
    ],
  },
  {
    waveNumber: 7,
    name: 'Garde du Léviathan',
    bonusPearls: 60,
    hpScale: 1.82,
    groups: [
      { type: 'crabe', count: 6, interval: 1.1 },
      { type: 'raie', count: 8, interval: 0.62, delayBefore: 0.6 },
      { type: 'meduse', count: 10, interval: 0.42, delayBefore: 0.5 },
    ],
  },
  {
    waveNumber: 8,
    name: 'Éveil du Léviathan',
    bonusPearls: 100,
    hpScale: 1.95,
    groups: [
      { type: 'meduse', count: 6, interval: 0.55 },
      { type: 'crabe', count: 4, interval: 1.15, delayBefore: 0.7 },
      { type: 'leviathan', count: 1, interval: 1.0, delayBefore: 1.4 },
      { type: 'raie', count: 5, interval: 0.75, delayBefore: 1.8 },
    ],
  },
];
