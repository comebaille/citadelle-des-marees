import type { SoundEvent } from './types';

/**
 * Procedural underwater bioluminescent WebAudio synthesizer.
 * Unlocks strictly on a user gesture (pointerdown / click / keydown) for iOS Safari compliance.
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private muted: boolean = false;
  private lastPlayedAt: Partial<Record<SoundEvent, number>> = {};

  constructor(initialMuted: boolean = false) {
    this.muted = initialMuted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.32, this.ctx.currentTime, 0.02);
    }
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /**
   * Call from any user gesture (pointerdown, click, keydown) to unlock iOS WebAudio.
   */
  unlock(): void {
    if (typeof window === 'undefined') return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    if (!this.ctx) {
      try {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.muted ? 0 : 0.32;
        this.masterGain.connect(this.ctx.destination);
      } catch {
        return;
      }
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {
        // Wait for next gesture
      });
    }
  }

  play(event: SoundEvent): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    if (this.ctx.state !== 'running') return;

    const nowMs = performance.now();
    const minGapMs = event === 'harpon' ? 75 : event === 'enemy_die' ? 70 : event === 'prisme' ? 420 : 35;
    const prev = this.lastPlayedAt[event] ?? 0;
    if (nowMs - prev < minGapMs) return;
    this.lastPlayedAt[event] = nowMs;

    const t = this.ctx.currentTime;
    switch (event) {
      case 'place':
        this.tone(330, 520, 0.14, 'triangle', 0.28, t);
        this.tone(660, 880, 0.16, 'sine', 0.18, t + 0.04);
        break;
      case 'upgrade':
        this.tone(440, 554, 0.14, 'sine', 0.24, t);
        this.tone(554, 659, 0.15, 'sine', 0.24, t + 0.07);
        this.tone(659, 880, 0.22, 'triangle', 0.26, t + 0.14);
        break;
      case 'sell':
        this.tone(660, 440, 0.12, 'sine', 0.22, t);
        this.tone(520, 330, 0.16, 'triangle', 0.18, t + 0.06);
        break;
      case 'harpon':
        this.tone(920, 420, 0.065, 'triangle', 0.14, t);
        break;
      case 'mortier':
        this.tone(170, 52, 0.24, 'sine', 0.32, t);
        this.tone(240, 88, 0.18, 'triangle', 0.16, t);
        break;
      case 'prisme':
        this.tone(740, 820, 0.18, 'sine', 0.09, t);
        this.tone(1110, 1020, 0.16, 'sine', 0.06, t + 0.03);
        break;
      case 'enemy_die':
        this.tone(540, 960, 0.09, 'sine', 0.14, t);
        break;
      case 'wave_start':
        this.tone(165, 220, 0.42, 'sine', 0.3, t);
        this.tone(247, 330, 0.38, 'triangle', 0.18, t + 0.12);
        break;
      case 'boss_spawn':
        this.tone(92, 65, 0.65, 'sawtooth', 0.2, t);
        this.tone(185, 138, 0.55, 'sine', 0.28, t + 0.08);
        this.tone(554, 415, 0.35, 'sine', 0.16, t + 0.22);
        break;
      case 'citadel_hit':
        this.tone(196, 110, 0.34, 'sawtooth', 0.22, t);
        this.tone(146, 98, 0.36, 'sine', 0.28, t + 0.05);
        break;
      case 'victory':
        this.tone(392, 392, 0.18, 'triangle', 0.25, t);
        this.tone(494, 494, 0.18, 'triangle', 0.25, t + 0.12);
        this.tone(587, 587, 0.2, 'triangle', 0.25, t + 0.24);
        this.tone(784, 880, 0.48, 'sine', 0.3, t + 0.36);
        break;
      case 'defeat':
        this.tone(330, 293, 0.26, 'triangle', 0.24, t);
        this.tone(262, 220, 0.3, 'triangle', 0.24, t + 0.2);
        this.tone(196, 130, 0.5, 'sine', 0.26, t + 0.42);
        break;
      case 'invalid':
        this.tone(190, 145, 0.11, 'square', 0.11, t);
        break;
    }
  }

  private tone(
    freqStart: number,
    freqEnd: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    startTime: number
  ): void {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, startTime);
    if (freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), startTime + duration);
    }

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }
}
