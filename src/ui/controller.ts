import { SoundEngine } from '../game/audio';
import { TOTAL_WAVES, TOWER_CONFIGS, TOWER_ORDER } from '../game/config';
import { GameEngine } from '../game/engine';
import { DEFAULT_SEED } from '../game/maps';
import { GameRenderer, type RenderInteractionState } from '../game/renderer';
import { makeRandomSeed } from '../game/rng';
import { loadSavedData, recordScore, setMutedPreference, setTutorialSeen } from '../game/storage';
import type { GridCoord, MapVariantId, PlacementCheckResult, TowerType } from '../game/types';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Élément introuvable : #${id}`);
  return el as T;
}

interface ActivePointer {
  x: number;
  y: number;
  startX: number;
  startY: number;
}

export class AppController {
  private engine: GameEngine;
  private renderer: GameRenderer;
  private sound: SoundEngine;

  private selectedVariant: MapVariantId = 'atoll';
  private seedValue: string = DEFAULT_SEED;

  private armedTowerType: TowerType | null = null;
  private selectedTowerId: number | null = null;
  private selectedEmptyTile: GridCoord | null = null;
  private hoverTile: GridCoord | null = null;
  private hoverCheck: PlacementCheckResult | null = null;
  private rejectedTile: { col: number; row: number; until: number } | null = null;

  private noticeTimeout: number | null = null;
  private endDialogShown: boolean = false;
  private pausedBeforeModal: boolean = false;
  private lastHudSyncAt: number = 0;

  // Pointer & pinch tracking
  private pointers = new Map<number, ActivePointer>();
  private didDrag = false;
  private wasPinching = false;
  private lastPinchDist = 0;

  // DOM references
  private appEl = byId<HTMLDivElement>('app');
  private canvasEl = byId<HTMLCanvasElement>('game-canvas');
  private hudLivesEl = byId<HTMLSpanElement>('hud-lives');
  private hudLivesPill = this.hudLivesEl.closest('.stat-lives') as HTMLElement;
  private hudPearlsEl = byId<HTMLSpanElement>('hud-pearls');
  private hudWaveEl = byId<HTMLSpanElement>('hud-wave');
  private hudScoreEl = byId<HTMLSpanElement>('hud-score');

  private btnHome = byId<HTMLButtonElement>('btn-home');
  private btnPause = byId<HTMLButtonElement>('btn-pause');
  private iconPause = byId<HTMLElement>('icon-pause');
  private iconPlay = byId<HTMLElement>('icon-play');
  private btnSpeed = byId<HTMLButtonElement>('btn-speed');
  private speedLabel = byId<HTMLSpanElement>('speed-label');
  private btnMute = byId<HTMLButtonElement>('btn-mute');
  private iconSoundOn = byId<HTMLElement>('icon-sound-on');
  private iconSoundOff = byId<HTMLElement>('icon-sound-off');
  private btnRestart = byId<HTMLButtonElement>('btn-restart');
  private btnHelp = byId<HTMLButtonElement>('btn-help');

  private bossBar = byId<HTMLDivElement>('boss-bar');
  private bossHpText = byId<HTMLSpanElement>('boss-hp-text');
  private bossHpFill = byId<HTMLDivElement>('boss-hp-fill');
  private noticePill = byId<HTMLDivElement>('notice-pill');
  private pauseBanner = byId<HTMLDivElement>('pause-banner');
  private btnResumeInline = byId<HTMLButtonElement>('btn-resume-inline');
  private btnZoomIn = byId<HTMLButtonElement>('btn-zoom-in');
  private btnZoomReset = byId<HTMLButtonElement>('btn-zoom-reset');

  private btnStartWave = byId<HTMLButtonElement>('btn-start-wave');
  private waveCtaLabel = byId<HTMLSpanElement>('wave-cta-label');
  private waveCtaSub = byId<HTMLSpanElement>('wave-cta-sub');
  private waveProgressBox = byId<HTMLDivElement>('wave-progress-box');
  private waveActiveTitle = byId<HTMLSpanElement>('wave-active-title');
  private waveRemainingLabel = byId<HTMLSpanElement>('wave-remaining-label');
  private waveProgressFill = byId<HTMLDivElement>('wave-progress-fill');

  private buildPalette = byId<HTMLDivElement>('build-palette');
  private towerCards: HTMLButtonElement[];
  private towerInspector = byId<HTMLDivElement>('tower-inspector');
  private inspectorName = byId<HTMLSpanElement>('inspector-name');
  private inspectorLevel = byId<HTMLSpanElement>('inspector-level');
  private inspectorStats = byId<HTMLSpanElement>('inspector-stats');
  private btnInspectorClose = byId<HTMLButtonElement>('btn-inspector-close');
  private btnUpgrade = byId<HTMLButtonElement>('btn-upgrade');
  private btnUpgradeLabel = byId<HTMLSpanElement>('btn-upgrade-label');
  private btnSell = byId<HTMLButtonElement>('btn-sell');
  private btnSellLabel = byId<HTMLSpanElement>('btn-sell-label');

  private titleBestScore = byId<HTMLElement>('title-best-score');
  private mapOptions: HTMLButtonElement[];
  private seedRow = byId<HTMLDivElement>('seed-row');
  private seedInput = byId<HTMLInputElement>('seed-input');
  private btnRandomSeed = byId<HTMLButtonElement>('btn-random-seed');
  private btnPlayStart = byId<HTMLButtonElement>('btn-play-start');
  private btnTitleTutorial = byId<HTMLButtonElement>('btn-title-tutorial');
  private btnTitleMute = byId<HTMLButtonElement>('btn-title-mute');

  private tutorialDialog = byId<HTMLDialogElement>('tutorial-dialog');
  private endgameDialog = byId<HTMLDialogElement>('endgame-dialog');
  private endgameBadge = byId<HTMLParagraphElement>('endgame-badge');
  private endgameTitle = byId<HTMLHeadingElement>('endgame-title');
  private endgameSubtitle = byId<HTMLParagraphElement>('endgame-subtitle');
  private endScore = byId<HTMLElement>('end-score');
  private endBest = byId<HTMLElement>('end-best');
  private endWave = byId<HTMLElement>('end-wave');
  private endKills = byId<HTMLElement>('end-kills');

  private rafId: number = 0;
  private lastFrameTime: number = 0;

  constructor() {
    const saved = loadSavedData();
    this.sound = new SoundEngine(saved.muted);
    this.renderer = new GameRenderer(this.canvasEl);
    this.engine = new GameEngine(this.selectedVariant, this.seedValue, {
      onSound: (ev) => this.sound.play(ev),
      onNotice: (msg, tone) => this.showNotice(msg, tone),
      onStateChange: () => this.onEngineStateChanged(),
    });

    this.towerCards = Array.from(document.querySelectorAll<HTMLButtonElement>('.tower-card'));
    this.mapOptions = Array.from(document.querySelectorAll<HTMLButtonElement>('.map-option'));

    this.installDialogLightDismissFallback();
    this.bindUIEvents();
    this.bindCanvasEvents();
    this.bindKeyboardEvents();
    this.exposeReadOnlyDebugHandle();

    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => this.handleResize());
    }

    this.syncAllUI();
    this.startLoop();
  }

  /**
   * Progressive fallback for browsers (such as Safari) that don't yet support <dialog closedby="any">.
   */
  private installDialogLightDismissFallback(): void {
    if ('closedBy' in HTMLDialogElement.prototype) return;
    const isOutside = (e: PointerEvent, dialog: HTMLDialogElement): boolean => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };

    for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog[closedby="any"]')) {
      let pressedOutside = false;
      dialog.addEventListener('pointerdown', (e) => {
        pressedOutside = isOutside(e, dialog);
      });
      dialog.addEventListener('pointerup', (e) => {
        if (pressedOutside && isOutside(e, dialog)) {
          dialog.close('');
        }
      });
    }
  }

  private bindUIEvents(): void {
    // Unlock WebAudio strictly on user gesture
    const unlockOnce = () => this.sound.unlock();
    window.addEventListener('pointerdown', unlockOnce, { passive: true });
    window.addEventListener('keydown', unlockOnce, { passive: true });

    // Title map variant selection
    for (const btn of this.mapOptions) {
      btn.addEventListener('click', () => {
        const variant = btn.dataset.map as MapVariantId;
        if (!variant) return;
        this.selectedVariant = variant;
        for (const opt of this.mapOptions) {
          opt.setAttribute('aria-checked', opt === btn ? 'true' : 'false');
        }
        this.seedRow.hidden = variant !== 'seeded';
        this.engine.loadMap(this.selectedVariant, this.seedValue, false);
        this.renderer.resetCamera(this.engine.map);
        this.renderer.resize(this.engine.map);
        this.syncTitleRecords();
      });
    }

    this.seedInput.addEventListener('input', () => {
      this.seedValue = this.seedInput.value.trim().toUpperCase() || DEFAULT_SEED;
      if (this.selectedVariant === 'seeded') {
        this.engine.loadMap('seeded', this.seedValue, false);
        this.renderer.resize(this.engine.map);
      }
    });

    this.btnRandomSeed.addEventListener('click', () => {
      this.seedValue = makeRandomSeed();
      this.seedInput.value = this.seedValue;
      this.engine.loadMap('seeded', this.seedValue, false);
      this.renderer.resize(this.engine.map);
    });

    this.btnPlayStart.addEventListener('click', () => {
      this.sound.unlock();
      this.enterGame();
    });

    this.btnTitleTutorial.addEventListener('click', () => {
      this.sound.unlock();
      this.openTutorial();
    });

    this.btnTitleMute.addEventListener('click', () => {
      this.sound.unlock();
      this.toggleMute();
    });

    // Top HUD controls
    this.btnHome.addEventListener('click', () => {
      this.clearSelections();
      this.endDialogShown = false;
      this.engine.loadMap(this.selectedVariant, this.seedValue, false);
      this.appEl.dataset.screen = 'title';
      this.renderer.resetCamera(this.engine.map);
      requestAnimationFrame(() => this.handleResize());
      this.syncAllUI();
    });

    this.btnPause.addEventListener('click', () => {
      this.engine.togglePause();
      this.syncAllUI();
    });

    this.btnResumeInline.addEventListener('click', () => {
      this.engine.setPaused(false);
      this.syncAllUI();
    });

    this.btnSpeed.addEventListener('click', () => {
      this.engine.toggleSpeed();
      this.syncAllUI();
    });

    this.btnMute.addEventListener('click', () => {
      this.toggleMute();
    });

    this.btnRestart.addEventListener('click', () => {
      this.restartGame();
    });

    this.btnHelp.addEventListener('click', () => {
      this.openTutorial();
    });

    // Camera controls
    this.btnZoomIn.addEventListener('click', () => {
      const next = this.renderer.zoom >= 1.55 ? 1 : Math.min(1.75, this.renderer.zoom + 0.35);
      this.renderer.setZoom(next, this.engine.map);
      this.syncCameraButtons();
    });

    this.btnZoomReset.addEventListener('click', () => {
      this.renderer.resetCamera(this.engine.map);
      this.syncCameraButtons();
    });

    // Wave Launch CTA
    this.btnStartWave.addEventListener('click', () => {
      this.sound.unlock();
      this.engine.startNextWave();
      this.syncAllUI();
    });

    // Tower Build Cards (supports both Tower-first and Tile-first one-thumb flows!)
    for (const card of this.towerCards) {
      card.addEventListener('click', () => {
        this.sound.unlock();
        const type = card.dataset.tower as TowerType;
        if (!type) return;

        // Flow 2 (Tile-first): if an empty tile is already selected on the map, build right away!
        if (this.selectedEmptyTile) {
          const { col, row } = this.selectedEmptyTile;
          const res = this.engine.placeTower(type, col, row);
          if (res.ok) {
            this.selectedEmptyTile = null;
            this.armedTowerType = null;
          } else {
            this.flashRejectedTile(col, row);
          }
          this.syncAllUI();
          return;
        }

        // Flow 1 (Tower-first): arm/disarm tower type
        this.selectedTowerId = null;
        this.armedTowerType = this.armedTowerType === type ? null : type;
        this.hoverCheck = this.hoverTile && this.armedTowerType
          ? this.engine.checkPlacement(this.armedTowerType, this.hoverTile.col, this.hoverTile.row)
          : null;
        this.syncAllUI();
      });
    }

    // Tower Inspector actions
    this.btnInspectorClose.addEventListener('click', () => {
      this.selectedTowerId = null;
      this.syncAllUI();
    });

    this.btnUpgrade.addEventListener('click', () => {
      if (this.selectedTowerId === null) return;
      this.engine.upgradeTower(this.selectedTowerId);
      this.syncAllUI();
    });

    this.btnSell.addEventListener('click', () => {
      if (this.selectedTowerId === null) return;
      const res = this.engine.sellTower(this.selectedTowerId);
      if (res.ok) {
        this.selectedTowerId = null;
      }
      this.syncAllUI();
    });

    // Native <dialog> close listeners (read returnValue then reset to '')
    this.tutorialDialog.addEventListener('close', () => {
      this.tutorialDialog.returnValue = '';
      setTutorialSeen();
      if (this.engine.phase === 'playing' && !this.pausedBeforeModal) {
        this.engine.setPaused(false);
      }
      this.syncAllUI();
    });

    this.endgameDialog.addEventListener('close', () => {
      const action = this.endgameDialog.returnValue;
      this.endgameDialog.returnValue = '';
      if (action === 'title') {
        this.clearSelections();
        this.endDialogShown = false;
        this.engine.loadMap(this.selectedVariant, this.seedValue, false);
        this.appEl.dataset.screen = 'title';
        this.renderer.resetCamera(this.engine.map);
        requestAnimationFrame(() => this.handleResize());
        this.syncAllUI();
      } else if (action === 'restart') {
        this.restartGame();
      }
    });
  }

  private bindCanvasEvents(): void {
    const canvas = this.canvasEl;

    canvas.addEventListener('pointerdown', (e) => {
      if (this.engine.phase !== 'playing') return;
      this.sound.unlock();
      canvas.setPointerCapture(e.pointerId);

      this.pointers.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        startX: e.clientX,
        startY: e.clientY,
      });

      if (this.pointers.size === 1) {
        this.didDrag = false;
        this.wasPinching = false;
      } else if (this.pointers.size === 2) {
        this.wasPinching = true;
        this.lastPinchDist = this.getPinchDistance();
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (this.engine.phase !== 'playing') return;

      const tracked = this.pointers.get(e.pointerId);
      if (tracked) {
        const dx = e.clientX - tracked.x;
        const dy = e.clientY - tracked.y;
        tracked.x = e.clientX;
        tracked.y = e.clientY;

        if (this.pointers.size === 2) {
          const dist = this.getPinchDistance();
          if (this.lastPinchDist > 10 && dist > 10) {
            const center = this.getPinchCenter();
            const nextZoom = this.renderer.zoom * (dist / this.lastPinchDist);
            this.renderer.setZoom(nextZoom, this.engine.map, center.x, center.y);
            this.syncCameraButtons();
          }
          this.lastPinchDist = dist;
          return;
        }

        const totalMoved = Math.hypot(tracked.x - tracked.startX, tracked.y - tracked.startY);
        if (totalMoved > 9) {
          this.didDrag = true;
          this.renderer.panBy(dx, dy, this.engine.map);
          this.syncCameraButtons();
        }
        return;
      }

      // Desktop mouse hover preview (never required on touch)
      if (e.pointerType === 'mouse' && this.armedTowerType) {
        const tile = this.renderer.clientToGrid(e.clientX, e.clientY, this.engine.map);
        this.hoverTile = tile;
        this.hoverCheck = tile ? this.engine.checkPlacement(this.armedTowerType, tile.col, tile.row) : null;
      }
    });

    const endPointer = (e: PointerEvent, isCancel: boolean) => {
      const tracked = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);

      if (this.pointers.size < 2) {
        this.lastPinchDist = 0;
      }

      if (!isCancel && tracked && !this.didDrag && !this.wasPinching && this.pointers.size === 0) {
        this.handleCanvasTap(e.clientX, e.clientY);
      }
    };

    canvas.addEventListener('pointerup', (e) => endPointer(e, false));
    canvas.addEventListener('pointercancel', (e) => endPointer(e, true));

    canvas.addEventListener('pointerleave', () => {
      this.hoverTile = null;
      this.hoverCheck = null;
    });

    canvas.addEventListener(
      'wheel',
      (e) => {
        if (this.engine.phase !== 'playing') return;
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 0.89;
        this.renderer.setZoom(this.renderer.zoom * factor, this.engine.map, e.clientX, e.clientY);
        this.syncCameraButtons();
      },
      { passive: false }
    );
  }

  private bindKeyboardEvents(): void {
    window.addEventListener('keydown', (e) => {
      if (this.tutorialDialog.open || this.endgameDialog.open) return;
      if (document.activeElement === this.seedInput) return;
      if (this.engine.phase !== 'playing') return;

      const key = e.key.toLowerCase();
      if (key === '1' || key === '2' || key === '3') {
        const type = TOWER_ORDER[Number(key) - 1];
        if (this.selectedEmptyTile) {
          const { col, row } = this.selectedEmptyTile;
          const res = this.engine.placeTower(type, col, row);
          if (res.ok) this.selectedEmptyTile = null;
          else this.flashRejectedTile(col, row);
        } else {
          this.selectedTowerId = null;
          this.armedTowerType = this.armedTowerType === type ? null : type;
        }
        this.syncAllUI();
      } else if (key === ' ') {
        e.preventDefault();
        this.engine.togglePause();
        this.syncAllUI();
      } else if (key === 'f') {
        this.engine.toggleSpeed();
        this.syncAllUI();
      } else if (key === 'm') {
        this.toggleMute();
      } else if (key === 'enter' || key === 'w') {
        if (!this.engine.waveActive) {
          this.engine.startNextWave();
          this.syncAllUI();
        }
      } else if (key === 'escape') {
        this.clearSelections();
        this.syncAllUI();
      } else if (key === '+' || key === '=') {
        this.renderer.setZoom(this.renderer.zoom + 0.25, this.engine.map);
        this.syncCameraButtons();
      } else if (key === '-') {
        this.renderer.setZoom(this.renderer.zoom - 0.25, this.engine.map);
        this.syncCameraButtons();
      } else if (key === '0') {
        this.renderer.resetCamera(this.engine.map);
        this.syncCameraButtons();
      } else if (key === 'arrowup' || key === 'z') {
        this.renderer.panBy(0, 28, this.engine.map);
      } else if (key === 'arrowdown' || key === 's') {
        this.renderer.panBy(0, -28, this.engine.map);
      } else if (key === 'arrowleft' || key === 'q') {
        this.renderer.panBy(28, 0, this.engine.map);
      } else if (key === 'arrowright' || key === 'd') {
        this.renderer.panBy(-28, 0, this.engine.map);
      }
    });
  }

  private handleCanvasTap(clientX: number, clientY: number): void {
    const coord = this.renderer.clientToGrid(clientX, clientY, this.engine.map);
    if (!coord) {
      this.clearSelections();
      this.syncAllUI();
      return;
    }

    // 1. Tapped an existing tower -> open inspector (even if another tower was armed!)
    const existing = this.engine.getTowerAt(coord.col, coord.row);
    if (existing) {
      this.armedTowerType = null;
      this.selectedEmptyTile = null;
      this.selectedTowerId = this.selectedTowerId === existing.id ? null : existing.id;
      this.syncAllUI();
      return;
    }

    // 2. If a tower type is armed -> attempt to place right here!
    if (this.armedTowerType) {
      const res = this.engine.placeTower(this.armedTowerType, coord.col, coord.row);
      if (res.ok) {
        // Keep armed if player can afford another of the same tower, otherwise disarm cleanly
        if (this.engine.pearls < TOWER_CONFIGS[this.armedTowerType].cost) {
          this.armedTowerType = null;
        }
        this.selectedEmptyTile = null;
      } else {
        this.flashRejectedTile(coord.col, coord.row);
      }
      this.syncAllUI();
      return;
    }

    // 3. No tower armed: if tapped a buildable tile, highlight it for Tile-First placement
    const kind = this.engine.map.tiles[coord.row][coord.col];
    if (kind === 'platform' || kind === 'basin') {
      const same =
        this.selectedEmptyTile &&
        this.selectedEmptyTile.col === coord.col &&
        this.selectedEmptyTile.row === coord.row;
      this.selectedTowerId = null;
      this.selectedEmptyTile = same ? null : coord;
      if (this.selectedEmptyTile) {
        this.showNotice(
          kind === 'basin'
            ? 'Bassin navigable : choisissez une tour pour dévier le courant.'
            : 'Emplacement sélectionné : choisissez une tour ci-dessous.',
          'info'
        );
      }
      this.syncAllUI();
      return;
    }

    // 4. Tapped sacred channel or abyss -> brief clear feedback
    this.clearSelections();
    if (kind === 'channel' || kind === 'spawn' || kind === 'citadel') {
      this.flashRejectedTile(coord.col, coord.row);
      this.showNotice('Placement interdit sur le courant sacré.', 'warn');
      this.sound.play('invalid');
    }
    this.syncAllUI();
  }

  private enterGame(): void {
    this.clearSelections();
    this.endDialogShown = false;
    this.engine.loadMap(this.selectedVariant, this.seedValue, true);
    this.appEl.dataset.screen = 'playing';
    this.renderer.resetCamera(this.engine.map);
    // Resize after layout transition from title to 3-row HUD/Stage/Dock
    requestAnimationFrame(() => {
      this.handleResize();
      this.syncAllUI();
    });
    this.syncAllUI();
    this.showNotice('Placez vos tours puis lancez la vague 1 !', 'info');
  }

  private restartGame(): void {
    this.clearSelections();
    this.endDialogShown = false;
    if (this.endgameDialog.open) this.endgameDialog.close();
    this.engine.restart();
    this.renderer.resetCamera(this.engine.map);
    this.syncAllUI();
    this.showNotice('Nouvelle défense prête !', 'info');
  }

  private openTutorial(): void {
    this.pausedBeforeModal = this.engine.paused;
    if (this.engine.phase === 'playing') {
      this.engine.setPaused(true);
    }
    if (!this.tutorialDialog.open) {
      this.tutorialDialog.showModal();
    }
  }

  private toggleMute(): void {
    const muted = this.sound.toggleMute();
    setMutedPreference(muted);
    this.syncMuteUI();
  }

  private clearSelections(): void {
    this.armedTowerType = null;
    this.selectedTowerId = null;
    this.selectedEmptyTile = null;
    this.hoverTile = null;
    this.hoverCheck = null;
  }

  private flashRejectedTile(col: number, row: number): void {
    this.rejectedTile = { col, row, until: performance.now() + 650 };
  }

  private showNotice(message: string, tone: 'info' | 'warn' | 'good' = 'info'): void {
    this.noticePill.textContent = message;
    this.noticePill.dataset.tone = tone;
    this.noticePill.hidden = false;

    if (this.noticeTimeout !== null) {
      window.clearTimeout(this.noticeTimeout);
    }
    this.noticeTimeout = window.setTimeout(() => {
      this.noticePill.hidden = true;
      this.noticeTimeout = null;
    }, 2400);
  }

  private onEngineStateChanged(): void {
    if (this.engine.score > 0) {
      recordScore(this.engine.score, this.engine.map.id);
    }

    if ((this.engine.phase === 'victory' || this.engine.phase === 'defeat') && !this.endDialogShown) {
      this.endDialogShown = true;
      this.clearSelections();
      const { isNewRecord, data } = recordScore(this.engine.score, this.engine.map.id);
      this.showEndgameDialog(this.engine.phase === 'victory', isNewRecord, data.bestScore);
    }

    this.syncAllUI();
  }

  private showEndgameDialog(isVictory: boolean, isNewRecord: boolean, bestScore: number): void {
    this.endgameBadge.hidden = !isNewRecord || this.engine.score <= 0;
    this.endgameTitle.textContent = isVictory ? 'Victoire !' : 'Citadelle submergée';
    this.endgameTitle.classList.toggle('is-defeat', !isVictory);
    this.endgameSubtitle.textContent = isVictory
      ? 'Les 8 vagues et le Léviathan ont été repoussés. La cité brille encore.'
      : `Le courant a cédé à la vague ${this.engine.waveNumber}/${TOTAL_WAVES}. Réessayez avec une nouvelle défense.`;

    this.endScore.textContent = this.engine.score.toLocaleString('fr-FR');
    this.endBest.textContent = bestScore.toLocaleString('fr-FR');
    this.endWave.textContent = `${this.engine.waveNumber}/${TOTAL_WAVES}`;
    this.endKills.textContent = String(this.engine.enemiesKilled);

    if (!this.endgameDialog.open) {
      this.endgameDialog.showModal();
    }
  }

  private syncAllUI(): void {
    this.syncTitleRecords();
    this.syncMuteUI();
    this.syncCameraButtons();

    // Top stats
    this.hudLivesEl.textContent = String(this.engine.lives);
    this.hudLivesPill.classList.toggle('is-low', this.engine.lives <= 6);
    this.hudPearlsEl.textContent = String(this.engine.pearls);
    this.hudWaveEl.textContent = `Vague ${this.engine.waveNumber}/${TOTAL_WAVES}`;
    this.hudScoreEl.textContent = this.engine.score.toLocaleString('fr-FR');

    // Pause / Speed buttons
    const paused = this.engine.paused;
    this.btnPause.classList.toggle('is-active', paused);
    this.btnPause.setAttribute('aria-label', paused ? 'Reprendre la partie' : 'Mettre en pause');
    this.iconPause.hidden = paused;
    this.iconPlay.hidden = !paused;
    this.pauseBanner.hidden = !(this.engine.phase === 'playing' && paused);

    const fast = this.engine.speedMultiplier === 2;
    this.speedLabel.textContent = fast ? '2×' : '1×';
    this.btnSpeed.classList.toggle('is-active', fast);

    // Boss HP Bar
    const boss = this.engine.getActiveBoss();
    if (boss) {
      this.bossBar.hidden = false;
      const pct = Math.max(0, Math.min(100, (boss.hp / boss.maxHp) * 100));
      this.bossHpFill.style.width = `${pct.toFixed(1)}%`;
      this.bossHpText.textContent = `${Math.max(0, Math.ceil(boss.hp))} / ${boss.maxHp}`;
    } else {
      this.bossBar.hidden = true;
    }

    // Wave strip
    if (this.engine.waveActive) {
      this.btnStartWave.hidden = true;
      this.waveProgressBox.hidden = false;
      const wave = this.engine.getCurrentWaveDefinition();
      const remaining = this.engine.waveRemainingToSpawn + this.engine.enemies.length;
      const total = Math.max(1, this.engine.waveTotalEnemies);
      const donePct = Math.max(0, Math.min(100, ((total - remaining) / total) * 100));
      this.waveActiveTitle.textContent = `Vague ${this.engine.waveNumber}/${TOTAL_WAVES} · ${wave?.name ?? ''}`;
      this.waveRemainingLabel.textContent = remaining > 1 ? `${remaining} restants` : `${remaining} restant`;
      this.waveProgressFill.style.width = `${donePct.toFixed(0)}%`;
    } else {
      this.waveProgressBox.hidden = true;
      const nextWave = this.engine.getNextWaveDefinition();
      if (nextWave && this.engine.phase === 'playing') {
        this.btnStartWave.hidden = false;
        this.waveCtaLabel.textContent = `Lancer la vague ${nextWave.waveNumber}/${TOTAL_WAVES}`;
        this.waveCtaSub.textContent = nextWave.name;
      } else {
        this.btnStartWave.hidden = true;
      }
    }

    // Build Palette vs Tower Inspector
    const inspected = this.selectedTowerId ? this.engine.getTowerById(this.selectedTowerId) : undefined;
    if (inspected) {
      this.buildPalette.hidden = true;
      this.towerInspector.hidden = false;
      const cfg = TOWER_CONFIGS[inspected.type];
      const spec = this.engine.getTowerSpec(inspected);
      const upgradeCost = this.engine.getUpgradeCost(inspected);
      const refund = this.engine.getSellRefund(inspected);

      this.inspectorName.textContent = cfg.name;
      this.inspectorLevel.textContent = `Niv. ${inspected.level}/3`;

      if (inspected.type === 'prisme') {
        const slowPct = Math.round((1 - (spec.slowFactor ?? 0.6)) * 100);
        this.inspectorStats.textContent = `-${slowPct}% vit. · ${spec.maxTargets} cible${(spec.maxTargets ?? 1) > 1 ? 's' : ''}`;
      } else if (inspected.type === 'mortier') {
        this.inspectorStats.textContent = `Dég. ${spec.damage} · Zone ${(spec.splashRadius ?? 1.3).toFixed(1).replace('.', ',')}`;
      } else {
        this.inspectorStats.textContent = `Dég. ${spec.damage} · Portée ${spec.range.toFixed(1).replace('.', ',')}`;
      }

      if (upgradeCost === null) {
        this.btnUpgrade.disabled = true;
        this.btnUpgradeLabel.textContent = '★ Niveau max';
      } else {
        this.btnUpgrade.disabled = this.engine.pearls < upgradeCost;
        this.btnUpgradeLabel.textContent = `⬆ Améliorer · ◈ ${upgradeCost}`;
      }
      this.btnSellLabel.textContent = `◈ Vendre · +${refund}`;
    } else {
      this.towerInspector.hidden = true;
      this.buildPalette.hidden = false;
      for (const card of this.towerCards) {
        const type = card.dataset.tower as TowerType;
        const cfg = TOWER_CONFIGS[type];
        const isArmed = this.armedTowerType === type;
        card.setAttribute('aria-pressed', isArmed ? 'true' : 'false');
        card.classList.toggle('is-unaffordable', this.engine.pearls < cfg.cost);
      }
    }
  }

  private syncTitleRecords(): void {
    const saved = loadSavedData();
    const mapBest = saved.bestByMap[this.selectedVariant] ?? 0;
    const display = saved.bestScore > 0 ? `${saved.bestScore.toLocaleString('fr-FR')} pts` : 'Aucun record';
    this.titleBestScore.textContent = mapBest > 0 && mapBest !== saved.bestScore
      ? `${display} (carte : ${mapBest.toLocaleString('fr-FR')})`
      : display;
  }

  private syncMuteUI(): void {
    const muted = this.sound.isMuted();
    this.iconSoundOn.hidden = muted;
    this.iconSoundOff.hidden = !muted;
    this.btnMute.classList.toggle('is-active', muted);
    this.btnMute.setAttribute('aria-label', muted ? 'Activer le son' : 'Couper le son');
    this.btnTitleMute.textContent = muted ? 'Son : Muet' : 'Son : Activé';
  }

  private syncCameraButtons(): void {
    const isMoved = this.renderer.zoom > 1.02 || Math.abs(this.renderer.panX) > 4 || Math.abs(this.renderer.panY) > 4;
    this.btnZoomReset.style.opacity = isMoved ? '1' : '0.62';
    this.btnZoomIn.textContent = this.renderer.zoom >= 1.55 ? '−' : '+';
  }

  private handleResize(): void {
    this.renderer.resize(this.engine.map);
  }

  private getPinchDistance(): number {
    const pts = Array.from(this.pointers.values());
    if (pts.length < 2) return 0;
    return Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  }

  private getPinchCenter(): { x: number; y: number } {
    const pts = Array.from(this.pointers.values());
    if (pts.length < 2) return { x: 0, y: 0 };
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  }

  private startLoop(): void {
    this.lastFrameTime = performance.now();
    const tick = (now: number) => {
      const dt = (now - this.lastFrameTime) / 1000;
      this.lastFrameTime = now;

      this.engine.step(dt);

      // Keep boss HP bar & active wave progress smoothly refreshed during combat
      if (this.engine.waveActive && now - this.lastHudSyncAt > 120) {
        this.lastHudSyncAt = now;
        this.syncLiveWaveMetrics();
      }

      const interaction: RenderInteractionState = {
        armedTowerType: this.armedTowerType,
        selectedTowerId: this.selectedTowerId,
        selectedEmptyTile: this.selectedEmptyTile,
        hoverTile: this.hoverTile,
        hoverCheck: this.hoverCheck,
        rejectedTile: this.rejectedTile,
      };
      this.renderer.render(this.engine, interaction);

      this.rafId = window.requestAnimationFrame(tick);
    };
    this.rafId = window.requestAnimationFrame(tick);
  }

  private syncLiveWaveMetrics(): void {
    const boss = this.engine.getActiveBoss();
    if (boss) {
      this.bossBar.hidden = false;
      const pct = Math.max(0, Math.min(100, (boss.hp / boss.maxHp) * 100));
      this.bossHpFill.style.width = `${pct.toFixed(1)}%`;
      this.bossHpText.textContent = `${Math.max(0, Math.ceil(boss.hp))} / ${boss.maxHp}`;
    } else if (!this.bossBar.hidden) {
      this.bossBar.hidden = true;
    }

    const remaining = this.engine.waveRemainingToSpawn + this.engine.enemies.length;
    const total = Math.max(1, this.engine.waveTotalEnemies);
    const donePct = Math.max(0, Math.min(100, ((total - remaining) / total) * 100));
    this.waveRemainingLabel.textContent = remaining > 1 ? `${remaining} restants` : `${remaining} restant`;
    this.waveProgressFill.style.width = `${donePct.toFixed(0)}%`;
  }

  private exposeReadOnlyDebugHandle(): void {
    (window as unknown as Record<string, unknown>).__citadelleDebug = {
      getState: () => ({
        phase: this.engine.phase,
        mapId: this.engine.map.id,
        seed: this.engine.map.seed ?? null,
        pearls: this.engine.pearls,
        lives: this.engine.lives,
        score: this.engine.score,
        waveNumber: this.engine.waveNumber,
        waveActive: this.engine.waveActive,
        paused: this.engine.paused,
        speedMultiplier: this.engine.speedMultiplier,
        towers: this.engine.towers.map((t) => ({ id: t.id, type: t.type, col: t.col, row: t.row, level: t.level })),
        enemiesCount: this.engine.enemies.length,
        enemiesKilled: this.engine.enemiesKilled,
        pathLength: this.engine.currentPath.length,
      }),
      gridToClient: (col: number, row: number) => this.renderer.gridToClient(col, row),
    };
  }

  destroy(): void {
    window.cancelAnimationFrame(this.rafId);
  }
}
