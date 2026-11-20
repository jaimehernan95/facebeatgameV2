import { Judgment, Lane, TrackConfig } from '../types/game';

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

type PlaybackMode = 'synth' | 'buffer' | 'preview' | 'external';

class GrooveAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private mode: PlaybackMode = 'synth';
  private isPlaying = false;
  private isPaused = false;
  private isMuted = false;
  private volume = 0.75;

  // Synth mode state
  private currentTrack: TrackConfig | null = null;
  private startAudioTime = 0;
  private pausedElapsed = 0;
  private nextStepTime = 0;
  private currentStep = 0;
  private schedulerTimer: number | null = null;

  // Uploaded buffer mode state
  private activeBuffer: AudioBuffer | null = null;
  private bufferSource: AudioBufferSourceNode | null = null;

  // Preview audio element mode (Spotify 30s preview_url)
  private previewAudio: HTMLAudioElement | null = null;

  // External clock fallback (Spotify SDK / YouTube / TikTok / Embed)
  private externalStartPerfMs = 0;
  private externalTimeProvider: (() => number | null) | null = null;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-14, this.ctx.currentTime);
      compressor.knee.setValueAtTime(18, this.ctx.currentTime);
      compressor.ratio.setValueAtTime(4, this.ctx.currentTime);
      compressor.attack.setValueAtTime(0.005, this.ctx.currentTime);
      compressor.release.setValueAtTime(0.15, this.ctx.currentTime);

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.isMuted ? 0 : this.volume;

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.58;

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 1.0;

      // Music goes through dynamics compressor; SFX bypasses music compression so score tones stay crisp & audible
      this.musicGain.connect(compressor);
      compressor.connect(this.masterGain);
      this.sfxGain.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      const length = Math.floor(this.ctx.sampleRate * 0.5);
      this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public unlock() {
    this.ensureContext();
  }

  public async decodeAudioFile(file: File): Promise<{
    buffer: AudioBuffer;
    bpm: number;
    beatTimes: number[];
  }> {
    const ctx = this.ensureContext();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const { bpm, beatTimes } = analyzeAudioBuffer(audioBuffer);
    return { buffer: audioBuffer, bpm, beatTimes };
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.02);
    }
    if (this.previewAudio) {
      this.previewAudio.muted = muted;
    }
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx && !this.isMuted) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    }
    if (this.previewAudio) {
      this.previewAudio.volume = this.volume;
    }
  }

  public startTrack(track: TrackConfig) {
    const ctx = this.ensureContext();
    this.stop();

    this.mode = 'synth';
    this.currentTrack = track;
    this.isPlaying = true;
    this.isPaused = false;
    this.pausedElapsed = 0;
    this.currentStep = 0;

    this.startAudioTime = ctx.currentTime + 0.04;
    this.nextStepTime = this.startAudioTime;

    this.schedulerTimer = window.setInterval(() => this.scheduler(), 25);
  }

  public startUploadedBuffer(buffer: AudioBuffer) {
    const ctx = this.ensureContext();
    this.stop();

    this.mode = 'buffer';
    this.activeBuffer = buffer;
    this.isPlaying = true;
    this.isPaused = false;
    this.pausedElapsed = 0;

    this.startAudioTime = ctx.currentTime + 0.04;
    this.startBufferAtOffset(0, this.startAudioTime);
  }

  public startPreviewUrl(previewUrl: string) {
    this.ensureContext();
    this.stop();

    this.mode = 'preview';
    this.isPlaying = true;
    this.isPaused = false;
    this.pausedElapsed = 0;
    this.externalStartPerfMs = performance.now();

    const audio = new Audio(previewUrl);
    audio.crossOrigin = 'anonymous';
    audio.volume = this.volume;
    audio.muted = this.isMuted;
    audio.loop = true;
    this.previewAudio = audio;
    void audio.play().catch(() => {
      // If autoplay blocked, external perf clock continues smoothly
    });
  }

  public startExternalClock(timeProvider?: () => number | null) {
    this.ensureContext();
    this.stop();

    this.mode = 'external';
    this.isPlaying = true;
    this.isPaused = false;
    this.pausedElapsed = 0;
    this.externalStartPerfMs = performance.now();
    this.externalTimeProvider = timeProvider ?? null;
  }

  private startBufferAtOffset(offsetSec: number, whenAudioTime: number) {
    if (!this.ctx || !this.musicGain || !this.activeBuffer) return;
    if (this.bufferSource) {
      try {
        this.bufferSource.stop();
      } catch {
        // Ignore already stopped
      }
      this.bufferSource.disconnect();
    }
    const source = this.ctx.createBufferSource();
    source.buffer = this.activeBuffer;
    source.loop = true;
    source.connect(this.musicGain);
    const safeOffset = offsetSec % Math.max(0.1, this.activeBuffer.duration);
    source.start(whenAudioTime, safeOffset);
    this.bufferSource = source;
  }

  public pause() {
    if (!this.isPlaying || this.isPaused) return;
    this.pausedElapsed = this.getSongTime();
    this.isPaused = true;

    if (this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    if (this.bufferSource) {
      try {
        this.bufferSource.stop();
      } catch {
        // Ignore
      }
      this.bufferSource.disconnect();
      this.bufferSource = null;
    }
    if (this.previewAudio) {
      this.previewAudio.pause();
    }
  }

  public resume() {
    if (!this.isPlaying || !this.isPaused) return;
    const ctx = this.ensureContext();
    this.isPaused = false;

    if (this.mode === 'synth' && this.currentTrack) {
      this.startAudioTime = ctx.currentTime - this.pausedElapsed;
      const sixteenthDur = 60 / this.currentTrack.bpm / 4;
      const stepsPassed = Math.ceil(this.pausedElapsed / sixteenthDur);
      this.currentStep = stepsPassed;
      this.nextStepTime = this.startAudioTime + stepsPassed * sixteenthDur;
      this.schedulerTimer = window.setInterval(() => this.scheduler(), 25);
    } else if (this.mode === 'buffer' && this.activeBuffer) {
      this.startAudioTime = ctx.currentTime - this.pausedElapsed;
      this.startBufferAtOffset(this.pausedElapsed, ctx.currentTime + 0.02);
    } else if (this.mode === 'preview' && this.previewAudio) {
      this.externalStartPerfMs = performance.now() - this.pausedElapsed * 1000;
      void this.previewAudio.play().catch(() => {});
    } else if (this.mode === 'external') {
      this.externalStartPerfMs = performance.now() - this.pausedElapsed * 1000;
    }
  }

  public stop() {
    this.isPlaying = false;
    this.isPaused = false;
    this.externalTimeProvider = null;
    if (this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    if (this.bufferSource) {
      try {
        this.bufferSource.stop();
      } catch {
        // Ignore
      }
      this.bufferSource.disconnect();
      this.bufferSource = null;
    }
    if (this.previewAudio) {
      this.previewAudio.pause();
      this.previewAudio.src = '';
      this.previewAudio = null;
    }
  }

  public getSongTime(): number {
    if (!this.isPlaying) return 0;
    if (this.isPaused) return this.pausedElapsed;
    if (this.mode === 'external' && this.externalTimeProvider) {
      const provided = this.externalTimeProvider();
      if (typeof provided === 'number' && Number.isFinite(provided) && provided >= 0) {
        return provided;
      }
    }
    if (this.mode === 'preview' || this.mode === 'external') {
      return Math.max(0, (performance.now() - this.externalStartPerfMs) / 1000);
    }
    if (!this.ctx) return 0;
    return Math.max(0, this.ctx.currentTime - this.startAudioTime);
  }

  public getBeatPulse(bpm: number): number {
    const songTime = this.getSongTime();
    if (songTime <= 0) return 0;
    const beatPhase = (songTime * bpm) / 60;
    const frac = beatPhase - Math.floor(beatPhase);
    return Math.pow(1 - frac, 2.2);
  }

  private scheduler() {
    if (!this.ctx || !this.currentTrack || !this.isPlaying || this.isPaused) return;

    const lookahead = 0.14;
    const sixteenthDur = 60 / this.currentTrack.bpm / 4;

    while (this.nextStepTime < this.ctx.currentTime + lookahead) {
      const stepInBar = this.currentStep % 16;
      const barIndex = Math.floor(this.currentStep / 16);
      const swingOffset = stepInBar % 2 === 1 ? sixteenthDur * this.currentTrack.swing : 0;

      this.scheduleStep(
        this.currentTrack,
        stepInBar,
        barIndex,
        this.nextStepTime + swingOffset,
        sixteenthDur
      );
      this.nextStepTime += sixteenthDur;
      this.currentStep++;
    }
  }

  private scheduleStep(
    track: TrackConfig,
    step: number,
    barIndex: number,
    time: number,
    stepDur: number
  ) {
    if (!this.ctx || !this.musicGain) return;

    const isKick =
      track.id === 'sunset-lofi' ? step === 0 || step === 7 || step === 10 : step % 4 === 0;
    if (isKick) this.triggerKick(time);

    if (step === 4 || step === 12) {
      this.triggerSnare(time, track.id === 'sunset-lofi' ? 0.22 : 0.34);
    }

    if (track.id === 'arcade-pulse') {
      if (step % 2 === 0) this.triggerHat(time, step % 4 === 2 ? 0.14 : 0.06);
    } else if (step % 2 === 1 || step % 4 === 2) {
      this.triggerHat(time, step % 4 === 2 ? 0.11 : 0.05);
    }

    const chord = track.progression[barIndex % track.progression.length];
    if (
      step === 0 ||
      (track.id === 'neon-funk' && step === 6) ||
      (track.id === 'sunset-lofi' && step === 10)
    ) {
      const chordDur = step === 0 ? stepDur * 6 : stepDur * 3;
      this.triggerChord(chord, time, chordDur, track.id === 'sunset-lofi' ? 'sine' : 'triangle');
    }

    const bassDegree = track.bassPattern[step];
    if (bassDegree !== null) {
      const chordRootOffset = chord[0] - 60;
      const midi =
        track.rootMidi +
        chordRootOffset +
        (track.scaleIntervals[bassDegree % track.scaleIntervals.length] ?? 0);
      this.triggerBass(
        midiToFreq(midi),
        time,
        stepDur * 1.6,
        track.id === 'arcade-pulse' ? 'square' : 'sawtooth'
      );
    }

    const leadDegree = track.leadPattern[step];
    if (leadDegree !== null) {
      const midi = 60 + (track.scaleIntervals[leadDegree % track.scaleIntervals.length] ?? 0) + 12;
      this.triggerLead(
        midiToFreq(midi),
        time,
        stepDur * 1.4,
        track.id === 'sunset-lofi' ? 'sine' : 'triangle'
      );
    }
  }

  private triggerKick(time: number) {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(145, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.11);
    gain.gain.setValueAtTime(0.75, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.24);
    osc.connect(gain);
    gain.connect(this.musicGain);
    osc.start(time);
    osc.stop(time + 0.25);
  }

  private triggerSnare(time: number, level: number) {
    if (!this.ctx || !this.musicGain || !this.noiseBuffer) return;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1900, time);
    filter.Q.setValueAtTime(1.1, time);
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(level, time);
    nGain.gain.exponentialRampToValueAtTime(0.001, time + 0.16);
    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.musicGain);
    noise.start(time);
    noise.stop(time + 0.17);

    const osc = this.ctx.createOscillator();
    const oGain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(185, time);
    osc.frequency.exponentialRampToValueAtTime(95, time + 0.08);
    oGain.gain.setValueAtTime(level * 0.7, time);
    oGain.gain.exponentialRampToValueAtTime(0.001, time + 0.09);
    osc.connect(oGain);
    oGain.connect(this.musicGain);
    osc.start(time);
    osc.stop(time + 0.1);
  }

  private triggerHat(time: number, level: number) {
    if (!this.ctx || !this.musicGain || !this.noiseBuffer) return;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(7500, time);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(level, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.045);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);
    noise.start(time);
    noise.stop(time + 0.05);
  }

  private triggerChord(midis: number[], time: number, dur: number, wave: OscillatorType) {
    if (!this.ctx || !this.musicGain) return;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1600, time);
    filter.frequency.exponentialRampToValueAtTime(650, time + dur);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.11, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
    filter.connect(gain);
    gain.connect(this.musicGain);
    for (const midi of midis) {
      const osc = this.ctx.createOscillator();
      osc.type = wave;
      osc.frequency.setValueAtTime(midiToFreq(midi), time);
      osc.connect(filter);
      osc.start(time);
      osc.stop(time + dur + 0.02);
    }
  }

  private triggerBass(freq: number, time: number, dur: number, wave: OscillatorType) {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, time);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(950, time);
    filter.frequency.exponentialRampToValueAtTime(220, time + dur);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.26, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  private triggerLead(freq: number, time: number, dur: number, wave: OscillatorType) {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, time);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.1, time + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(gain);
    gain.connect(this.musicGain);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  private triggerChimeVoice(
    freq: number,
    when: number,
    duration: number,
    peakGain: number,
    wave: OscillatorType = 'triangle'
  ) {
    if (!this.ctx || !this.sfxGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, when);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, when);
    gain.gain.linearRampToValueAtTime(peakGain, when + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(when);
    osc.stop(when + duration + 0.015);
  }

  public playAttemptTone(lane: Lane) {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!this.sfxGain) return;

    const now = ctx.currentTime;
    const lanePitch: Record<Lane, number> = {
      LEFT: 260,
      MOUTH: 310,
      SMILE: 350,
      RIGHT: 390,
    };
    const startFreq = lanePitch[lane];

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(startFreq * 0.65, now + 0.045);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.11, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.06);
  }

  public playHitSound(lane: Lane, judgment: Judgment, isBonus: boolean, combo = 1) {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!this.sfxGain) return;

    const now = ctx.currentTime;
    // Bright pentatonic arcade bells mapped per lane
    const pitchMap: Record<Lane, number> = {
      LEFT: 587.33, // D5
      MOUTH: 739.99, // F#5
      SMILE: 880.0, // A5
      RIGHT: 1046.5, // C6
    };
    // Subtle celebratory pitch lift up to +2 semitones as combo grows
    const comboLift = 1 + Math.min(8, Math.floor(combo / 5)) * 0.015;
    const baseFreq = pitchMap[lane] * comboLift;

    if (judgment === 'PERFECT') {
      // Crisp two-step arcade coin/bell sparkle
      this.triggerChimeVoice(baseFreq, now, 0.16, 0.36, 'triangle');
      this.triggerChimeVoice(baseFreq * 2, now, 0.14, 0.14, 'sine');
      this.triggerChimeVoice(baseFreq * 1.5, now + 0.045, 0.22, 0.34, 'sine');
    } else if (judgment === 'GREAT') {
      this.triggerChimeVoice(baseFreq, now, 0.18, 0.34, 'triangle');
      this.triggerChimeVoice(baseFreq * 2, now, 0.13, 0.12, 'sine');
    } else {
      this.triggerChimeVoice(baseFreq * 0.94, now, 0.14, 0.26, 'sine');
    }

    // Extra golden arpeggio shimmer on bonus notes or every 10-combo milestone
    if (isBonus || (combo > 0 && combo % 10 === 0)) {
      this.triggerChimeVoice(baseFreq * 2, now + 0.085, 0.26, 0.28, 'sine');
    }
  }

  public playCalibrationClick(): number {
    const ctx = this.ensureContext();
    if (!this.sfxGain) return 0;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(987.77, now); // B5 crisp click
    gain.gain.setValueAtTime(this.isMuted ? 0 : 0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.07);
    return now;
  }

  public getAudioCurrentTime(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  public playMissSound() {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!this.sfxGain) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(75, now + 0.12);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(380, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.13, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  public playCountdownTick(finalGo = false) {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!this.sfxGain) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(finalGo ? 880 : 440, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (finalGo ? 0.22 : 0.1));

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.23);
  }

  public playVictoryFanfare() {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!this.sfxGain) return;

    const notes = [523.25, 659.25, 783.99, 1046.5];
    const now = ctx.currentTime;
    notes.forEach((freq, idx) => {
      if (!this.sfxGain) return;
      const t = now + idx * 0.09;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.3);
    });
  }
}

// Lightweight Web Audio onset-energy analyzer for uploaded audio files
function analyzeAudioBuffer(buffer: AudioBuffer): { bpm: number; beatTimes: number[] } {
  const channel = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const windowSize = Math.floor(sampleRate * 0.025); // 25ms RMS windows
  const energies: number[] = [];

  for (let i = 0; i < channel.length; i += windowSize) {
    let sum = 0;
    const end = Math.min(channel.length, i + windowSize);
    for (let j = i; j < end; j++) {
      const s = channel[j];
      sum += s * s;
    }
    energies.push(Math.sqrt(sum / Math.max(1, end - i)));
  }

  // Adaptive local threshold peak detection
  const beatTimes: number[] = [];
  const halfHistory = 14; // ~350ms on each side
  let lastPeakTime = -1;

  for (let i = halfHistory; i < energies.length - 1; i++) {
    let localAvg = 0;
    for (let k = i - halfHistory; k <= i + halfHistory; k++) {
      localAvg += energies[k];
    }
    localAvg /= halfHistory * 2 + 1;

    const current = energies[i];
    const time = (i * windowSize) / sampleRate;
    if (
      current > localAvg * 1.38 &&
      current > 0.03 &&
      current >= energies[i - 1] &&
      current >= energies[i + 1] &&
      time - lastPeakTime >= 0.24
    ) {
      beatTimes.push(Number(time.toFixed(3)));
      lastPeakTime = time;
    }
  }

  // Estimate BPM from median inter-beat interval
  const intervals: number[] = [];
  for (let i = 1; i < Math.min(beatTimes.length, 64); i++) {
    let dt = beatTimes[i] - beatTimes[i - 1];
    while (dt < 0.34) dt *= 2;
    while (dt > 0.85) dt /= 2;
    intervals.push(dt);
  }

  let bpm = 114;
  if (intervals.length > 4) {
    intervals.sort((a, b) => a - b);
    const medianDt = intervals[Math.floor(intervals.length / 2)];
    bpm = Math.round(60 / medianDt);
    bpm = Math.max(78, Math.min(160, bpm));
  }

  return { bpm, beatTimes };
}

export const grooveEngine = new GrooveAudioEngine();
