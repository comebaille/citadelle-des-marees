import { ENEMY_CONFIGS, TOWER_CONFIGS } from './config';
import type { GameEngine } from './engine';
import type { Enemy, GridCoord, MapDefinition, PlacementCheckResult, TileKind, Tower, TowerType } from './types';

interface Plankton {
  x: number; // normalized 0..1 of canvas
  y: number;
  r: number;
  speed: number;
  phase: number;
  color: string;
}

export interface RenderInteractionState {
  armedTowerType: TowerType | null;
  selectedTowerId: number | null;
  selectedEmptyTile: GridCoord | null;
  hoverTile: GridCoord | null;
  hoverCheck: PlacementCheckResult | null;
  rejectedTile: { col: number; row: number; until: number } | null;
}

export class GameRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private terrainCanvas: HTMLCanvasElement;
  private terrainCtx: CanvasRenderingContext2D;
  private terrainCacheKey: string = '';

  private cssWidth: number = 390;
  private cssHeight: number = 600;
  private dpr: number = 1;

  // Layout metrics in CSS px (before camera zoom/pan)
  private baseTileSize: number = 38;
  private baseOriginX: number = 0;
  private baseOriginY: number = 0;

  // Interactive camera (zoom + pan)
  zoom: number = 1;
  panX: number = 0;
  panY: number = 0;

  private plankton: Plankton[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Contexte Canvas 2D indisponible');
    this.ctx = ctx;

    this.terrainCanvas = document.createElement('canvas');
    const tCtx = this.terrainCanvas.getContext('2d');
    if (!tCtx) throw new Error('Contexte terrain offscreen indisponible');
    this.terrainCtx = tCtx;

    this.initPlankton();
  }

  private initPlankton(): void {
    const colors = ['#2ef2ff', '#38f9b4', '#8ce8ff', '#c77dff', '#ffd166'];
    this.plankton = Array.from({ length: 34 }, (_, i) => ({
      x: ((i * 73.13) % 100) / 100,
      y: ((i * 41.77) % 100) / 100,
      r: 0.9 + ((i * 19) % 10) * 0.16,
      speed: 0.014 + ((i * 31) % 10) * 0.0025,
      phase: i * 1.17,
      color: colors[i % colors.length],
    }));
  }

  resize(map: MapDefinition): void {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(240, Math.round(rect.width));
    const height = Math.max(240, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    if (width !== this.cssWidth || height !== this.cssHeight || dpr !== this.dpr) {
      this.cssWidth = width;
      this.cssHeight = height;
      this.dpr = dpr;
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
    }

    const padX = Math.max(8, Math.min(18, width * 0.03));
    const padY = Math.max(8, Math.min(18, height * 0.02));
    const tileW = (width - padX * 2) / map.cols;
    const tileH = (height - padY * 2) / map.rows;
    this.baseTileSize = Math.max(20, Math.floor(Math.min(tileW, tileH)));

    const gridW = this.baseTileSize * map.cols;
    const gridH = this.baseTileSize * map.rows;
    this.baseOriginX = Math.floor((width - gridW) / 2);
    this.baseOriginY = Math.floor((height - gridH) / 2);

    this.clampCamera(map);
    this.ensureTerrainCache(map);
  }

  setZoom(nextZoom: number, map: MapDefinition, focalClientX?: number, focalClientY?: number): void {
    const clamped = Math.max(1, Math.min(1.85, nextZoom));
    if (Math.abs(clamped - this.zoom) < 0.001) return;

    if (focalClientX !== undefined && focalClientY !== undefined) {
      const rect = this.canvas.getBoundingClientRect();
      const fx = focalClientX - rect.left - this.cssWidth / 2;
      const fy = focalClientY - rect.top - this.cssHeight / 2;
      const scaleRatio = clamped / this.zoom;
      this.panX = fx - (fx - this.panX) * scaleRatio;
      this.panY = fy - (fy - this.panY) * scaleRatio;
    }

    this.zoom = clamped;
    this.clampCamera(map);
  }

  panBy(dx: number, dy: number, map: MapDefinition): void {
    this.panX += dx;
    this.panY += dy;
    this.clampCamera(map);
  }

  resetCamera(map: MapDefinition): void {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.clampCamera(map);
  }

  private clampCamera(map: MapDefinition): void {
    const gridW = this.baseTileSize * map.cols * this.zoom;
    const gridH = this.baseTileSize * map.rows * this.zoom;
    // Allow subtle exploration pan even at 1x, and full reach when zoomed
    const maxPanX = Math.max(20, (gridW - this.cssWidth) / 2 + 28);
    const maxPanY = Math.max(20, (gridH - this.cssHeight) / 2 + 28);
    this.panX = Math.max(-maxPanX, Math.min(maxPanX, this.panX));
    this.panY = Math.max(-maxPanY, Math.min(maxPanY, this.panY));
  }

  /**
   * Converts viewport client coordinates (e.g. PointerEvent.clientX/Y) into grid tile coordinates.
   */
  clientToGrid(clientX: number, clientY: number, map: MapDefinition): GridCoord | null {
    const rect = this.canvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;

    // Reverse camera transform around canvas center
    const worldX = (localX - this.cssWidth / 2 - this.panX) / this.zoom + this.cssWidth / 2;
    const worldY = (localY - this.cssHeight / 2 - this.panY) / this.zoom + this.cssHeight / 2;

    const col = Math.floor((worldX - this.baseOriginX) / this.baseTileSize);
    const row = Math.floor((worldY - this.baseOriginY) / this.baseTileSize);

    if (col < 0 || col >= map.cols || row < 0 || row >= map.rows) return null;
    return { col, row };
  }

  /**
   * Returns viewport client coordinates for the center of a grid tile (useful for keyboard/testing).
   */
  gridToClient(col: number, row: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const worldX = this.baseOriginX + (col + 0.5) * this.baseTileSize;
    const worldY = this.baseOriginY + (row + 0.5) * this.baseTileSize;
    const localX = (worldX - this.cssWidth / 2) * this.zoom + this.cssWidth / 2 + this.panX;
    const localY = (worldY - this.cssHeight / 2) * this.zoom + this.cssHeight / 2 + this.panY;
    return { x: rect.left + localX, y: rect.top + localY };
  }

  private ensureTerrainCache(map: MapDefinition): void {
    const key = `${map.id}:${map.seed ?? ''}:${this.baseTileSize}:${this.dpr}`;
    if (key === this.terrainCacheKey) return;
    this.terrainCacheKey = key;

    const w = map.cols * this.baseTileSize;
    const h = map.rows * this.baseTileSize;
    this.terrainCanvas.width = Math.round(w * this.dpr);
    this.terrainCanvas.height = Math.round(h * this.dpr);

    const ctx = this.terrainCtx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const ts = this.baseTileSize;

    // Outer recessed frame glow around the sunken city grid
    ctx.fillStyle = '#040e1f';
    ctx.fillRect(0, 0, w, h);

    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) {
        const kind = map.tiles[r][c];
        this.drawStaticTile(ctx, kind, c, r, ts, map);
      }
    }

    // Subtle stone rim border around entire sunken sanctuary
    ctx.strokeStyle = 'rgba(46, 242, 255, 0.22)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(0.75, 0.75, w - 1.5, h - 1.5);
  }

  private drawStaticTile(
    ctx: CanvasRenderingContext2D,
    kind: TileKind,
    c: number,
    r: number,
    ts: number,
    map: MapDefinition
  ): void {
    const x = c * ts;
    const y = r * ts;
    const hash = ((c * 73856093) ^ (r * 19349663)) >>> 0;

    if (kind === 'abyss') {
      // Deep nocturnal ocean trench + sculpted sunken ruin silhouettes
      const grad = ctx.createLinearGradient(x, y, x + ts, y + ts);
      grad.addColorStop(0, '#040d1c');
      grad.addColorStop(1, '#07162a');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, ts, ts);

      // Subtle bathymetric ridge arc
      ctx.strokeStyle = 'rgba(30, 96, 138, 0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x + (hash % 3) * (ts * 0.4), y + ((hash >> 3) % 3) * (ts * 0.4), ts * 0.58, 0, Math.PI * 1.2);
      ctx.stroke();

      // Inner pillars / coral stones for non-edge or selected edge ruins
      const isInner = c > 0 && c < map.cols - 1 && r > 0 && r < map.rows - 1;
      if (isInner || hash % 3 === 0) {
        const pad = ts * 0.16;
        const size = ts - pad * 2;
        ctx.fillStyle = isInner ? '#0c233c' : '#081a30';
        this.roundRect(ctx, x + pad, y + pad, size, size, ts * 0.2);
        ctx.fill();
        ctx.strokeStyle = isInner ? 'rgba(62, 168, 210, 0.35)' : 'rgba(38, 114, 156, 0.22)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Bioluminescent coral polyps tucked on ruins
        if (hash % 2 === 0) {
          ctx.fillStyle = hash % 4 === 0 ? 'rgba(199, 125, 255, 0.42)' : 'rgba(56, 249, 180, 0.36)';
          ctx.beginPath();
          ctx.arc(x + ts * 0.36, y + ts * 0.42, ts * 0.08, 0, Math.PI * 2);
          ctx.arc(x + ts * 0.62, y + ts * 0.58, ts * 0.06, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      return;
    }

    if (kind === 'platform') {
      // Elevated carved basalt reef pedestal — refined temple stonework so towers pop!
      ctx.fillStyle = '#061527';
      ctx.fillRect(x, y, ts, ts);

      const m = ts * 0.07;
      const toneShift = (hash % 3) * 3;
      const grad = ctx.createLinearGradient(x + m, y + m, x + ts - m, y + ts - m);
      grad.addColorStop(0, `rgb(${16 + toneShift}, ${44 + toneShift}, ${74 + toneShift})`);
      grad.addColorStop(0.55, `rgb(${11 + toneShift}, ${32 + toneShift}, ${56 + toneShift})`);
      grad.addColorStop(1, '#07182c');
      ctx.fillStyle = grad;
      this.roundRect(ctx, x + m, y + m, ts - m * 2, ts - m * 2, ts * 0.16);
      ctx.fill();

      // Top-left specular temple bevel + subtle aquamarine edge
      ctx.strokeStyle = 'rgba(84, 224, 255, 0.22)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Delicate corner notches
      const inset = m + ts * 0.12;
      ctx.fillStyle = 'rgba(56, 249, 180, 0.16)';
      ctx.fillRect(x + inset, y + inset, 2, 2);
      ctx.fillRect(x + ts - inset - 2, y + ts - inset - 2, 2, 2);

      // Soft recessed socket center dot (understated, readable build cue)
      ctx.fillStyle = 'rgba(46, 242, 255, 0.2)';
      ctx.beginPath();
      ctx.arc(x + ts * 0.5, y + ts * 0.5, ts * 0.065, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(46, 242, 255, 0.11)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x + ts * 0.5, y + ts * 0.5, ts * 0.16, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }

    if (kind === 'basin') {
      // Open navigable sunken plaza: enemies can cross, AND towers can be built to sculpt route!
      const grad = ctx.createLinearGradient(x, y, x, y + ts);
      grad.addColorStop(0, '#07223a');
      grad.addColorStop(1, '#051a2f');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, ts, ts);

      // Delicate emerald-cyan mosaic tile lines
      ctx.strokeStyle = 'rgba(56, 249, 180, 0.16)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 2, y + 2, ts - 4, ts - 4);

      // Small corner diamond marks distinguishing navigable buildable plaza from sacred channel
      ctx.fillStyle = 'rgba(56, 249, 180, 0.22)';
      const d = ts * 0.055;
      ctx.beginPath();
      ctx.moveTo(x + ts * 0.5, y + ts * 0.5 - d);
      ctx.lineTo(x + ts * 0.5 + d, y + ts * 0.5);
      ctx.lineTo(x + ts * 0.5, y + ts * 0.5 + d);
      ctx.lineTo(x + ts * 0.5 - d, y + ts * 0.5);
      ctx.closePath();
      ctx.fill();
      return;
    }

    // Sacred sunken channel / spawn / citadel floor
    const grad = ctx.createRadialGradient(
      x + ts * 0.5,
      y + ts * 0.5,
      ts * 0.05,
      x + ts * 0.5,
      y + ts * 0.5,
      ts * 0.78
    );
    grad.addColorStop(0, '#092e4e');
    grad.addColorStop(1, '#04182d');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, ts, ts);

    // Carved channel border lines along non-walkable neighbors
    ctx.strokeStyle = 'rgba(46, 242, 255, 0.34)';
    ctx.lineWidth = 1.5;
    const isWalk = (cc: number, rr: number): boolean => {
      if (cc < 0 || cc >= map.cols || rr < 0 || rr >= map.rows) return false;
      const k = map.tiles[rr][cc];
      return k === 'channel' || k === 'basin' || k === 'spawn' || k === 'citadel';
    };
    if (!isWalk(c, r - 1)) {
      ctx.beginPath();
      ctx.moveTo(x, y + 1);
      ctx.lineTo(x + ts, y + 1);
      ctx.stroke();
    }
    if (!isWalk(c, r + 1)) {
      ctx.beginPath();
      ctx.moveTo(x, y + ts - 1);
      ctx.lineTo(x + ts, y + ts - 1);
      ctx.stroke();
    }
    if (!isWalk(c - 1, r)) {
      ctx.beginPath();
      ctx.moveTo(x + 1, y);
      ctx.lineTo(x + 1, y + ts);
      ctx.stroke();
    }
    if (!isWalk(c + 1, r)) {
      ctx.beginPath();
      ctx.moveTo(x + ts - 1, y);
      ctx.lineTo(x + ts - 1, y + ts);
      ctx.stroke();
    }

    // Subtle inlaid tide rune in channel tiles
    if (kind === 'channel') {
      ctx.strokeStyle = 'rgba(46, 242, 255, 0.14)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x + ts * 0.5, y + ts * 0.5, ts * 0.24, 0.2, Math.PI - 0.2);
      ctx.stroke();
    }
  }

  render(engine: GameEngine, ui: RenderInteractionState): void {
    this.ensureTerrainCache(engine.map);

    const ctx = this.ctx;
    const w = this.cssWidth;
    const h = this.cssHeight;
    const t = engine.time;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // 1. Deep Nocturnal Ocean Backdrop
    const bg = ctx.createRadialGradient(w * 0.5, h * 0.38, 20, w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
    bg.addColorStop(0, '#09223f');
    bg.addColorStop(0.55, '#041225');
    bg.addColorStop(1, '#020814');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Subtle ambient deep-water waves behind the grid
    this.drawAmbientOceanWaves(ctx, w, h, t);

    // Apply interactive camera + micro screen-shake
    ctx.save();
    const shakeAmp = engine.screenShake * 6;
    const shakeX = shakeAmp > 0.1 ? Math.sin(t * 58) * shakeAmp : 0;
    const shakeY = shakeAmp > 0.1 ? Math.cos(t * 67) * shakeAmp : 0;
    ctx.translate(w / 2 + this.panX + shakeX, h / 2 + this.panY + shakeY);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-w / 2, -h / 2);

    const ox = this.baseOriginX;
    const oy = this.baseOriginY;
    const ts = this.baseTileSize;
    const gridW = engine.map.cols * ts;
    const gridH = engine.map.rows * ts;

    // 2. Cached Carved Sunken Ruins Terrain
    ctx.drawImage(this.terrainCanvas, ox, oy, gridW, gridH);

    // 3. Animated Water Caustics & swaying coral fronds clipped to the sunken sanctuary
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, gridW, gridH);
    ctx.clip();
    this.drawCaustics(ctx, ox, oy, gridW, gridH, t);
    this.drawSwayingFlora(ctx, engine.map, ox, oy, ts, t);
    ctx.restore();

    // 4. Active Bioluminescent Enemy Current Path
    this.drawPathFlow(ctx, engine.currentPath, ox, oy, ts, t, false);

    // Preview rerouted path if hovering/selecting a valid basin mazing tile
    if (ui.hoverCheck && ui.hoverCheck.ok && ui.hoverCheck.reroutes) {
      this.drawPathFlow(ctx, ui.hoverCheck.nextPath, ox, oy, ts, t, true);
    }

    // 5. Buildable hints when a tower is armed
    if (engine.phase === 'playing' && ui.armedTowerType) {
      this.drawBuildableHints(ctx, engine, ox, oy, ts, t);
    }

    // 6. Abyssal Rift (Spawn) & Bioluminescent Citadel Core
    this.drawSpawnPortal(ctx, engine.map.spawn, ox, oy, ts, t);
    this.drawCitadelCore(ctx, engine.map.citadel, ox, oy, ts, t, engine.lives / engine.maxLives, engine.citadelDamageFlash);

    // 7. Range & selection overlays under towers
    const inspectedTower = ui.selectedTowerId ? engine.getTowerById(ui.selectedTowerId) : undefined;
    if (inspectedTower) {
      const spec = engine.getTowerSpec(inspectedTower);
      const cfg = TOWER_CONFIGS[inspectedTower.type];
      this.drawRangeCircle(ctx, ox + (inspectedTower.col + 0.5) * ts, oy + (inspectedTower.row + 0.5) * ts, spec.range * ts, cfg.accentColor, true);
    }

    // Selected empty tile reticle (tile-first mobile interaction)
    if (engine.phase === 'playing' && ui.selectedEmptyTile && !inspectedTower) {
      const { col, row } = ui.selectedEmptyTile;
      const pulse = 0.55 + 0.35 * Math.sin(t * 6);
      ctx.save();
      ctx.strokeStyle = `rgba(46, 242, 255, ${pulse})`;
      ctx.lineWidth = 2.2;
      this.roundRect(ctx, ox + col * ts + 2, oy + row * ts + 2, ts - 4, ts - 4, ts * 0.16);
      ctx.stroke();
      ctx.fillStyle = 'rgba(46, 242, 255, 0.14)';
      ctx.fill();
      ctx.restore();
    }

    // Hover/preview ghost tower
    if (engine.phase === 'playing' && ui.armedTowerType && ui.hoverTile && ui.hoverCheck) {
      this.drawPlacementPreview(ctx, ui.armedTowerType, ui.hoverTile, ui.hoverCheck, ox, oy, ts, t);
    }

    // Brief red flash on a rejected tap tile
    if (ui.rejectedTile && performance.now() < ui.rejectedTile.until) {
      const { col, row } = ui.rejectedTile;
      const alpha = Math.min(1, (ui.rejectedTile.until - performance.now()) / 550);
      ctx.save();
      ctx.fillStyle = `rgba(255, 79, 121, ${0.32 * alpha})`;
      ctx.strokeStyle = `rgba(255, 107, 139, ${0.95 * alpha})`;
      ctx.lineWidth = 2.2;
      this.roundRect(ctx, ox + col * ts + 2, oy + row * ts + 2, ts - 4, ts - 4, ts * 0.16);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // 8. Placed Towers
    for (const tower of engine.towers) {
      const isSelected = tower.id === ui.selectedTowerId;
      this.drawTower(ctx, tower, ox, oy, ts, t, isSelected);
    }

    // 9. Prisme Harmonic Slow Beams
    for (const beam of engine.beams) {
      this.drawHarmonicBeam(
        ctx,
        ox + beam.fromX * ts,
        oy + beam.fromY * ts,
        ox + beam.toX * ts,
        oy + beam.toY * ts,
        beam.level,
        t
      );
    }

    // 10. Enemies (sorted by y for clean visual depth, boss drawn prominently)
    const sortedEnemies = [...engine.enemies].sort((a, b) => (a.isBoss === b.isBoss ? a.y - b.y : a.isBoss ? 1 : -1));
    for (const enemy of sortedEnemies) {
      this.drawEnemy(ctx, enemy, ox, oy, ts, t);
    }

    // 11. Projectiles
    for (const proj of engine.projectiles) {
      this.drawProjectile(ctx, proj, ox, oy, ts);
    }

    // 12. Shockwaves
    for (const sw of engine.shockwaves) {
      const progress = sw.life / sw.maxLife;
      const alpha = Math.max(0, 1 - progress);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = sw.color;
      ctx.globalAlpha = alpha * 0.85;
      ctx.lineWidth = Math.max(1.2, (1 - progress) * 4.5);
      ctx.beginPath();
      ctx.arc(ox + sw.x * ts, oy + sw.y * ts, sw.radius * ts, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = alpha * 0.2;
      ctx.fillStyle = sw.color;
      ctx.fill();
      ctx.restore();
    }

    // 13. Particles
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of engine.particles) {
      const alpha = Math.max(0, 1 - p.life / p.maxLife);
      const px = ox + p.x * ts;
      const py = oy + p.y * ts;
      ctx.globalAlpha = alpha;
      if (p.kind === 'bubble') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(px, py, p.size * (0.7 + 0.5 * (p.life / p.maxLife)), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(px, py, p.size * (1 - 0.4 * (p.life / p.maxLife)), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // 14. Floating Reward/Damage Popups
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.max(11, Math.round(ts * 0.31))}px system-ui, -apple-system, sans-serif`;
    for (const ft of engine.floatingTexts) {
      const alpha = Math.max(0, 1 - ft.life / ft.maxLife);
      const fx = ox + ft.x * ts;
      const fy = oy + ft.y * ts;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(3, 9, 22, 0.85)';
      ctx.fillText(ft.text, fx + 1, fy + 1);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, fx, fy);
    }
    ctx.restore();

    ctx.restore(); // end camera transform

    // 15. Foreground Ambient Bioluminescent Plankton (screen-space parallax sparkle)
    this.drawPlankton(ctx, w, h, t);
  }

  private drawAmbientOceanWaves(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    ctx.save();

    // Soft feathered abyssal light curtains from the surface (radial gradients: zero hard edges)
    ctx.globalCompositeOperation = 'lighter';
    for (let ray = 0; ray < 3; ray++) {
      const sway = Math.sin(t * 0.35 + ray * 1.9) * 26;
      const cx = w * (0.22 + ray * 0.28) + sway;
      const cy = h * 0.26;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.14 + ray * 0.05);
      ctx.scale(0.55, 1.55);
      const rad = Math.max(w, h) * 0.36;
      const grad = ctx.createRadialGradient(0, 0, 8, 0, 0, rad);
      grad.addColorStop(0, ray === 1 ? 'rgba(56, 249, 180, 0.11)' : 'rgba(46, 242, 255, 0.11)');
      grad.addColorStop(0.5, 'rgba(20, 140, 210, 0.04)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = 1.3;
    for (let i = 0; i < 5; i++) {
      const yBase = (h / 6) * (i + 1);
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(46, 242, 255, 0.08)' : 'rgba(56, 249, 180, 0.06)';
      ctx.beginPath();
      for (let x = 0; x <= w; x += 24) {
        const y = yBase + Math.sin(x * 0.014 + t * (0.65 + i * 0.12) + i * 1.4) * 14;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawSwayingFlora(
    ctx: CanvasRenderingContext2D,
    map: MapDefinition,
    ox: number,
    oy: number,
    ts: number,
    t: number
  ): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) {
        if (map.tiles[r][c] !== 'abyss') continue;
        const hash = ((c * 97 + r * 53) & 255);
        if (hash % 5 !== 0) continue;

        const bx = ox + (c + 0.5) * ts;
        const by = oy + (r + 0.72) * ts;
        const sway = Math.sin(t * 1.9 + hash) * ts * 0.14;
        const color = hash % 2 === 0 ? 'rgba(56, 249, 180, 0.34)' : 'rgba(199, 125, 255, 0.34)';

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo(bx + sway * 0.6, by - ts * 0.24, bx + sway, by - ts * 0.44);
        ctx.stroke();

        ctx.fillStyle = hash % 2 === 0 ? 'rgba(120, 255, 224, 0.7)' : 'rgba(235, 165, 255, 0.7)';
        ctx.beginPath();
        ctx.arc(bx + sway, by - ts * 0.44, Math.max(1.5, ts * 0.055), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawCaustics(
    ctx: CanvasRenderingContext2D,
    ox: number,
    oy: number,
    gridW: number,
    gridH: number,
    t: number
  ): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(54, 232, 255, 0.08)';
    ctx.lineWidth = 2.6;

    for (let band = 0; band < 6; band++) {
      const yOffset = oy + ((band + 0.5) / 6) * gridH;
      ctx.beginPath();
      for (let x = ox - 10; x <= ox + gridW + 10; x += 22) {
        const wave =
          Math.sin(x * 0.035 + t * 0.9 + band * 1.3) * 12 +
          Math.cos(x * 0.02 - t * 0.65 + band * 2.1) * 7;
        const y = yOffset + wave;
        if (x === ox - 10) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawPathFlow(
    ctx: CanvasRenderingContext2D,
    path: readonly GridCoord[],
    ox: number,
    oy: number,
    ts: number,
    t: number,
    isPreview: boolean
  ): void {
    if (path.length < 2) return;

    const pts = path.map((p) => ({
      x: ox + (p.col + 0.5) * ts,
      y: oy + (p.row + 0.5) * ts,
    }));

    const tracePolyline = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
    };

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (isPreview) {
      ctx.strokeStyle = 'rgba(56, 249, 180, 0.78)';
      ctx.lineWidth = Math.max(2.5, ts * 0.09);
      ctx.setLineDash([ts * 0.22, ts * 0.2]);
      ctx.lineDashOffset = -t * ts * 1.4;
      tracePolyline();
      ctx.stroke();
      ctx.restore();
      return;
    }

    // Soft glowing tidal stream underlayer
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(20, 198, 255, 0.14)';
    ctx.lineWidth = ts * 0.42;
    tracePolyline();
    ctx.stroke();

    // Animated flowing luminous stream line
    ctx.strokeStyle = 'rgba(66, 242, 255, 0.42)';
    ctx.lineWidth = Math.max(2, ts * 0.08);
    ctx.setLineDash([ts * 0.34, ts * 0.46]);
    ctx.lineDashOffset = -t * ts * 1.25;
    tracePolyline();
    ctx.stroke();
    ctx.setLineDash([]);

    // Moving directional glowing chevron pulses along segments
    const totalSegments = pts.length - 1;
    const pulseCount = Math.max(3, Math.floor(totalSegments / 3.2));
    for (let k = 0; k < pulseCount; k++) {
      const u = ((t * 0.45 + k / pulseCount) % 1) * totalSegments;
      const segIdx = Math.min(totalSegments - 1, Math.floor(u));
      const frac = u - segIdx;
      const a = pts[segIdx];
      const b = pts[segIdx + 1];
      const px = a.x + (b.x - a.x) * frac;
      const py = a.y + (b.y - a.y) * frac;
      const ang = Math.atan2(b.y - a.y, b.x - a.x);

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      ctx.strokeStyle = 'rgba(130, 252, 255, 0.75)';
      ctx.lineWidth = 1.8;
      const s = ts * 0.14;
      ctx.beginPath();
      ctx.moveTo(-s, -s * 0.75);
      ctx.lineTo(s * 0.5, 0);
      ctx.lineTo(-s, s * 0.75);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  private drawBuildableHints(
    ctx: CanvasRenderingContext2D,
    engine: GameEngine,
    ox: number,
    oy: number,
    ts: number,
    t: number
  ): void {
    const pulse = 0.18 + 0.12 * Math.sin(t * 4.5);
    const occupied = new Set(engine.towers.map((tw) => `${tw.col},${tw.row}`));

    ctx.save();
    for (let r = 0; r < engine.map.rows; r++) {
      for (let c = 0; c < engine.map.cols; c++) {
        const k = engine.map.tiles[r][c];
        if (k !== 'platform' && k !== 'basin') continue;
        if (occupied.has(`${c},${r}`)) continue;

        ctx.strokeStyle = k === 'platform' ? `rgba(46, 242, 255, ${pulse + 0.14})` : `rgba(56, 249, 180, ${pulse + 0.08})`;
        ctx.lineWidth = 1.25;
        this.roundRect(ctx, ox + c * ts + 3, oy + r * ts + 3, ts - 6, ts - 6, ts * 0.14);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawSpawnPortal(
    ctx: CanvasRenderingContext2D,
    coord: GridCoord,
    ox: number,
    oy: number,
    ts: number,
    t: number
  ): void {
    const cx = ox + (coord.col + 0.5) * ts;
    const cy = oy + (coord.row + 0.5) * ts;
    const r = ts * 0.42;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Outer magenta-violet abyssal rift aura
    const glow = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r * 1.45);
    glow.addColorStop(0, 'rgba(255, 110, 245, 0.85)');
    glow.addColorStop(0.5, 'rgba(162, 66, 255, 0.45)');
    glow.addColorStop(1, 'rgba(162, 66, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.45, 0, Math.PI * 2);
    ctx.fill();

    // Swirling rift arcs
    ctx.translate(cx, cy);
    ctx.rotate(t * 1.5);
    ctx.strokeStyle = '#e580ff';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, r * (0.55 + i * 0.16), i * 2.1, i * 2.1 + 1.5);
      ctx.stroke();
    }

    // Dark rift center eye
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#1b072b';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ff9ef8';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.restore();
  }

  private drawCitadelCore(
    ctx: CanvasRenderingContext2D,
    coord: GridCoord,
    ox: number,
    oy: number,
    ts: number,
    t: number,
    hpRatio: number,
    damageFlash: number
  ): void {
    const cx = ox + (coord.col + 0.5) * ts;
    const cy = oy + (coord.row + 0.5) * ts;
    const r = ts * 0.45;
    const danger = damageFlash > 0.05 || hpRatio < 0.35;
    const coreColor = damageFlash > 0.15 ? '#ff547a' : hpRatio < 0.35 ? '#ffb84d' : '#2ef2ff';

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const halo = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r * 1.65);
    halo.addColorStop(0, damageFlash > 0.15 ? 'rgba(255, 84, 122, 0.9)' : 'rgba(46, 242, 255, 0.85)');
    halo.addColorStop(0.55, danger ? 'rgba(255, 130, 80, 0.32)' : 'rgba(56, 249, 180, 0.32)');
    halo.addColorStop(1, 'rgba(46, 242, 255, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.65, 0, Math.PI * 2);
    ctx.fill();

    // Rotating astrolabe sanctuary rings
    ctx.translate(cx, cy);
    ctx.rotate(-t * 0.85);
    ctx.strokeStyle = coreColor;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.95, 0, Math.PI * 1.45);
    ctx.stroke();

    ctx.rotate(t * 2.0);
    ctx.strokeStyle = 'rgba(180, 255, 250, 0.85)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.68, 0.4, Math.PI * 1.75);
    ctx.stroke();

    // Diamond Citadel Crystal Heart
    ctx.rotate(-t * 1.15);
    const pulse = 1 + 0.08 * Math.sin(t * 4.2);
    const d = r * 0.52 * pulse;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = coreColor;
    ctx.beginPath();
    ctx.moveTo(0, -d);
    ctx.lineTo(d * 0.72, 0);
    ctx.lineTo(0, d);
    ctx.lineTo(-d * 0.72, 0);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ebffff';
    ctx.beginPath();
    ctx.moveTo(0, -d * 0.55);
    ctx.lineTo(d * 0.36, 0);
    ctx.lineTo(0, d * 0.55);
    ctx.lineTo(-d * 0.36, 0);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  private drawRangeCircle(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radiusPx: number,
    color: string,
    active: boolean
  ): void {
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = active ? 0.11 : 0.08;
    ctx.beginPath();
    ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = active ? 0.72 : 0.5;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawPlacementPreview(
    ctx: CanvasRenderingContext2D,
    type: TowerType,
    tile: GridCoord,
    check: PlacementCheckResult,
    ox: number,
    oy: number,
    ts: number,
    t: number
  ): void {
    const cx = ox + (tile.col + 0.5) * ts;
    const cy = oy + (tile.row + 0.5) * ts;
    const cfg = TOWER_CONFIGS[type];

    if (check.ok) {
      this.drawRangeCircle(ctx, cx, cy, cfg.levels[0].range * ts, cfg.accentColor, false);
      ctx.save();
      ctx.globalAlpha = 0.62;
      const ghost: Tower = {
        id: -1,
        type,
        col: tile.col,
        row: tile.row,
        level: 1,
        totalInvested: cfg.cost,
        cooldownRemaining: 0,
        angle: -Math.PI / 2,
        recoil: 0,
        activeTargetIds: [],
        kills: 0,
      };
      this.drawTower(ctx, ghost, ox, oy, ts, t, false);
      ctx.restore();
    } else {
      ctx.save();
      ctx.fillStyle = 'rgba(255, 79, 121, 0.25)';
      ctx.strokeStyle = '#ff547a';
      ctx.lineWidth = 2;
      this.roundRect(ctx, ox + tile.col * ts + 2, oy + tile.row * ts + 2, ts - 4, ts - 4, ts * 0.16);
      ctx.fill();
      ctx.stroke();

      const s = ts * 0.2;
      ctx.beginPath();
      ctx.moveTo(cx - s, cy - s);
      ctx.lineTo(cx + s, cy + s);
      ctx.moveTo(cx + s, cy - s);
      ctx.lineTo(cx - s, cy + s);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawTower(
    ctx: CanvasRenderingContext2D,
    tower: Tower,
    ox: number,
    oy: number,
    ts: number,
    t: number,
    selected: boolean
  ): void {
    const cx = ox + (tower.col + 0.5) * ts;
    const cy = oy + (tower.row + 0.5) * ts;
    const cfg = TOWER_CONFIGS[tower.type];
    const r = ts * 0.37;

    ctx.save();
    ctx.translate(cx, cy);

    // Selection glow ring
    if (selected) {
      ctx.save();
      ctx.strokeStyle = cfg.accentColor;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.24, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Soft bioluminescent under-glow
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r * 1.25);
    glow.addColorStop(0, cfg.glowColor);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Base plinth (octagonal sunken stone & bronze)
    ctx.fillStyle = '#0a1f38';
    ctx.strokeStyle = cfg.accentColor;
    ctx.lineWidth = tower.level >= 2 ? 1.8 : 1.3;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i + Math.PI / 8;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if (tower.type === 'harpon') {
      // Rapid-fire coral harpoon turret
      ctx.save();
      ctx.rotate(tower.angle);
      const recoilOffset = -tower.recoil * ts * 0.1;

      // Twin hydro-barrels
      ctx.fillStyle = '#184b73';
      ctx.strokeStyle = '#7bf8ff';
      ctx.lineWidth = 1.2;
      ctx.fillRect(recoilOffset - r * 0.15, -r * 0.36, r * 1.05, r * 0.22);
      ctx.strokeRect(recoilOffset - r * 0.15, -r * 0.36, r * 1.05, r * 0.22);
      ctx.fillRect(recoilOffset - r * 0.15, r * 0.14, r * 1.05, r * 0.22);
      ctx.strokeRect(recoilOffset - r * 0.15, r * 0.14, r * 1.05, r * 0.22);

      // Center luminous lance tip (evolves with level)
      ctx.fillStyle = '#2ef2ff';
      ctx.beginPath();
      ctx.moveTo(recoilOffset + r * (1.1 + tower.level * 0.12), 0);
      ctx.lineTo(recoilOffset + r * 0.1, -r * 0.28);
      ctx.lineTo(recoilOffset - r * 0.2, 0);
      ctx.lineTo(recoilOffset + r * 0.1, r * 0.28);
      ctx.closePath();
      ctx.fill();

      // Core orb
      ctx.fillStyle = '#e8ffff';
      ctx.beginPath();
      ctx.arc(recoilOffset, 0, r * 0.24, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (tower.type === 'mortier') {
      // Heavy abyssal splash mortar chalice
      const scale = 1 - tower.recoil * 0.14;
      ctx.save();
      ctx.scale(scale, scale);

      ctx.fillStyle = '#261828';
      ctx.strokeStyle = '#ffb84d';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.74, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Armored ribs
      for (let i = 0; i < (tower.level >= 3 ? 6 : 4); i++) {
        const a = (Math.PI * 2 * i) / (tower.level >= 3 ? 6 : 4) + t * 0.25;
        ctx.strokeStyle = '#ff8a4d';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.44, Math.sin(a) * r * 0.44);
        ctx.lineTo(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85);
        ctx.stroke();
      }

      // Glowing magma-coral plasma core
      const corePulse = 0.85 + 0.15 * Math.sin(t * 5.2);
      const coreGrad = ctx.createRadialGradient(0, 0, 1, 0, 0, r * 0.48 * corePulse);
      coreGrad.addColorStop(0, '#fff7cc');
      coreGrad.addColorStop(0.55, '#ffb84d');
      coreGrad.addColorStop(1, '#ff5c5c');
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.46 * corePulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      // Prisme Cryo-Algue: rotating floating sea-crystal & harmonic kelp halo
      ctx.save();
      ctx.rotate(t * (1.2 + tower.level * 0.35));
      ctx.strokeStyle = 'rgba(56, 249, 180, 0.65)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.72, 0, Math.PI * 1.4);
      ctx.stroke();

      // Floating crystal facets
      const sides = tower.level === 1 ? 4 : tower.level === 2 ? 6 : 8;
      ctx.fillStyle = '#38f9b4';
      ctx.beginPath();
      for (let i = 0; i < sides; i++) {
        const a = (Math.PI * 2 * i) / sides;
        const rad = i % 2 === 0 ? r * 0.62 : r * 0.35;
        const px = Math.cos(a) * rad;
        const py = Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#ecfff8';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.24, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Upgrade level chevron pips at bottom of tower plinth
    for (let i = 0; i < tower.level; i++) {
      const px = (i - (tower.level - 1) / 2) * (ts * 0.16);
      const py = r * 0.94;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(px, py, Math.max(2, ts * 0.055), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = cfg.accentColor;
      ctx.beginPath();
      ctx.arc(px, py, Math.max(1.3, ts * 0.038), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawHarmonicBeam(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    level: 1 | 2 | 3,
    t: number
  ): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const nx = -dy / dist;
    const ny = dx / dist;
    const steps = 10;

    const traceWave = (amp: number, freq: number, phaseOffset: number) => {
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const env = Math.sin(u * Math.PI);
        const offset = Math.sin(u * freq - t * 14 + phaseOffset) * amp * env;
        const px = x1 + dx * u + nx * offset;
        const py = y1 + dy * u + ny * offset;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
    };

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    ctx.strokeStyle = 'rgba(56, 249, 180, 0.35)';
    ctx.lineWidth = 5 + level * 1.4;
    traceWave(3.2, 8, 0);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(120, 255, 232, 0.85)';
    ctx.lineWidth = 2.1;
    traceWave(4.0, 10, 1.4);
    ctx.stroke();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.restore();
  }

  private drawEnemy(
    ctx: CanvasRenderingContext2D,
    enemy: Enemy,
    ox: number,
    oy: number,
    ts: number,
    t: number
  ): void {
    const cfg = ENEMY_CONFIGS[enemy.type];
    const ex = ox + enemy.x * ts;
    const ey = oy + enemy.y * ts;
    const r = cfg.radius * ts;

    ctx.save();
    ctx.translate(ex, ey);

    // Cryo-slow halo ring when slowed
    if (enemy.slowTimer > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(56, 249, 180, 0.85)';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([4, 3]);
      ctx.rotate(t * 2.4);
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Glow aura
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r * 1.6);
    glow.addColorStop(0, cfg.glowColor);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.rotate(enemy.facing);

    const flash = enemy.hitFlash > 0.2;

    if (enemy.type === 'meduse') {
      // Bioluminescent electric jellyfish with trailing waving tentacles
      ctx.strokeStyle = flash ? '#ffffff' : 'rgba(130, 240, 255, 0.85)';
      ctx.lineWidth = 1.4;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(-r * 0.2, i * r * 0.22);
        const sway = Math.sin(enemy.phase + i * 0.9) * r * 0.28;
        ctx.quadraticCurveTo(-r * 0.75, i * r * 0.24 + sway, -r * 1.25, i * r * 0.18 - sway * 0.6);
        ctx.stroke();
      }

      const pulse = 1 + 0.1 * Math.sin(enemy.phase);
      ctx.fillStyle = flash ? '#ffffff' : '#4deaff';
      ctx.beginPath();
      ctx.arc(r * 0.1, 0, r * 0.82 * pulse, -Math.PI * 0.56, Math.PI * 0.56);
      ctx.quadraticCurveTo(-r * 0.28, 0, r * 0.1, -r * 0.82 * pulse);
      ctx.fill();

      ctx.fillStyle = '#eaffff';
      ctx.beginPath();
      ctx.arc(r * 0.26, 0, r * 0.34, 0, Math.PI * 2);
      ctx.fill();
    } else if (enemy.type === 'raie') {
      // Undulating emerald phantom manta ray
      const wing = Math.sin(enemy.phase) * r * 0.24;
      ctx.strokeStyle = '#38f9b4';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, 0);
      ctx.quadraticCurveTo(-r * 1.1, wing * 0.7, -r * 1.5, -wing * 0.5);
      ctx.stroke();

      ctx.fillStyle = flash ? '#ffffff' : '#1fd69e';
      ctx.strokeStyle = '#9dffe0';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(r * 1.05, 0);
      ctx.quadraticCurveTo(r * 0.15, -r * 1.15 + wing, -r * 0.65, -r * 0.3);
      ctx.lineTo(-r * 0.45, 0);
      ctx.lineTo(-r * 0.65, r * 0.3);
      ctx.quadraticCurveTo(r * 0.15, r * 1.15 - wing, r * 1.05, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Bioluminescent dorsal markings
      ctx.fillStyle = '#d7fff2';
      ctx.beginPath();
      ctx.arc(r * 0.25, -r * 0.18, r * 0.12, 0, Math.PI * 2);
      ctx.arc(r * 0.25, r * 0.18, r * 0.12, 0, Math.PI * 2);
      ctx.fill();
    } else if (enemy.type === 'crabe') {
      // Armored amber-obsidian deep-sea guardian crab
      const legWave = Math.sin(enemy.phase) * r * 0.14;
      ctx.strokeStyle = '#ff9654';
      ctx.lineWidth = 2;
      for (const side of [-1, 1]) {
        // Pincer
        ctx.beginPath();
        ctx.moveTo(r * 0.35, side * r * 0.55);
        ctx.lineTo(r * 1.05, side * (r * 0.72 + legWave));
        ctx.stroke();
        // Side legs
        ctx.beginPath();
        ctx.moveTo(-r * 0.1, side * r * 0.75);
        ctx.lineTo(-r * 0.35, side * (r * 1.15 - legWave));
        ctx.stroke();
      }

      // Armored hexagonal shell
      ctx.fillStyle = flash ? '#ffffff' : '#2a161c';
      ctx.strokeStyle = '#ff9654';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.88, r * 0.78, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Glowing magma shell cracks
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.moveTo(r * 0.42, 0);
      ctx.lineTo(-r * 0.12, -r * 0.34);
      ctx.lineTo(-r * 0.36, 0);
      ctx.lineTo(-r * 0.12, r * 0.34);
      ctx.closePath();
      ctx.fill();
    } else {
      // BOSS: Léviathan des Abysses — multi-segmented undulating bioluminescent serpent!
      for (let seg = 4; seg >= 1; seg--) {
        const sway = Math.sin(enemy.phase - seg * 0.85) * r * 0.28;
        const sx = -seg * r * 0.44;
        const sr = r * (0.76 - seg * 0.1);
        ctx.fillStyle = flash ? '#ffffff' : seg % 2 === 0 ? '#7a1ca8' : '#b825d9';
        ctx.strokeStyle = '#ff9cf6';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sway, sr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // Boss head with glowing crest horns
      ctx.fillStyle = flash ? '#ffffff' : '#460f63';
      ctx.strokeStyle = '#ff6ef2';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(r * 1.15, 0);
      ctx.lineTo(r * 0.2, -r * 0.85);
      ctx.lineTo(-r * 0.55, -r * 0.52);
      ctx.lineTo(-r * 0.35, 0);
      ctx.lineTo(-r * 0.55, r * 0.52);
      ctx.lineTo(r * 0.2, r * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Radiant eyes + golden crown core
      ctx.fillStyle = '#2ef2ff';
      ctx.beginPath();
      ctx.arc(r * 0.46, -r * 0.28, r * 0.16, 0, Math.PI * 2);
      ctx.arc(r * 0.46, r * 0.28, r * 0.16, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.arc(r * 0.05, 0, r * 0.24, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore(); // undo facing rotation

    // Mini crisp HP bar (shown when damaged or for Boss)
    if (enemy.hp < enemy.maxHp || enemy.isBoss) {
      const barW = enemy.isBoss ? ts * 0.95 : ts * 0.62;
      const barH = enemy.isBoss ? 5 : 3.5;
      const bx = -barW / 2;
      const by = -r - (enemy.isBoss ? 11 : 7);
      const ratio = Math.max(0, Math.min(1, enemy.hp / enemy.maxHp));

      ctx.fillStyle = 'rgba(3, 9, 22, 0.82)';
      ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
      ctx.fillStyle = enemy.isBoss ? '#ff5ce8' : ratio > 0.45 ? '#38f9b4' : '#ff6b6b';
      ctx.fillRect(bx, by, barW * ratio, barH);
    }

    ctx.restore();
  }

  private drawProjectile(
    ctx: CanvasRenderingContext2D,
    p: GameEngine['projectiles'][number],
    ox: number,
    oy: number,
    ts: number
  ): void {
    const px = ox + p.x * ts;
    const py = oy + p.y * ts;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    if (p.towerType === 'mortier') {
      // Parabolic arc height for dramatic mortar trajectory
      const arc = Math.sin(Math.min(1, p.progress) * Math.PI) * ts * 0.95;

      // Ground shadow
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.beginPath();
      ctx.ellipse(px, py + 2, ts * 0.14, ts * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Blazing trail
      if (p.trail.length > 1) {
        ctx.strokeStyle = 'rgba(255, 184, 77, 0.55)';
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        for (let i = 0; i < p.trail.length; i++) {
          const frac = i / Math.max(1, p.trail.length);
          const tArc = Math.sin(Math.max(0, p.progress - (1 - frac) * 0.18) * Math.PI) * ts * 0.95;
          const tx = ox + p.trail[i].x * ts;
          const ty = oy + p.trail[i].y * ts - tArc;
          if (i === 0) ctx.moveTo(tx, ty);
          else ctx.lineTo(tx, ty);
        }
        ctx.stroke();
      }

      // Glowing magma-pearl orb
      const grad = ctx.createRadialGradient(px, py - arc, 1, px, py - arc, ts * 0.24);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.45, '#ffd166');
      grad.addColorStop(1, 'rgba(255, 92, 92, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py - arc, ts * 0.24, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Harpon luminous dart + plasma tail
      if (p.trail.length > 1) {
        ctx.strokeStyle = 'rgba(46, 242, 255, 0.55)';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        for (let i = 0; i < p.trail.length; i++) {
          const tx = ox + p.trail[i].x * ts;
          const ty = oy + p.trail[i].y * ts;
          if (i === 0) ctx.moveTo(tx, ty);
          else ctx.lineTo(tx, ty);
        }
        ctx.lineTo(px, py);
        ctx.stroke();
      }

      ctx.fillStyle = '#e8ffff';
      ctx.beginPath();
      ctx.arc(px, py, Math.max(2.6, ts * 0.085), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawPlankton(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.plankton) {
      const y = ((p.y - t * p.speed) % 1 + 1) % 1;
      const x = p.x + Math.sin(t * 0.7 + p.phase) * 0.015;
      const alpha = 0.22 + 0.28 * (0.5 + 0.5 * Math.sin(t * 2.1 + p.phase));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(x * w, y * h, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
}
