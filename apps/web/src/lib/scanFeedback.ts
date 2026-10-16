/**
 * Audible / haptic feedback for scans, so an operator scanning quickly
 * doesn't have to look at the screen: one high beep = found, two soft beeps =
 * already scanned, low long tone = extra / problem, mid tone = queued offline.
 */
export type ScanFeedbackKind = 'found' | 'already' | 'unexpected' | 'error' | 'queued';

type Tone = { freq: number; ms: number };

/** Tone sequence + vibration pattern per outcome (pure, unit-tested). */
export function feedbackFor(kind: ScanFeedbackKind): { tones: Tone[]; vibrate: number[] } {
  switch (kind) {
    case 'found':
      return { tones: [{ freq: 1320, ms: 90 }], vibrate: [60] };
    case 'already':
      return {
        tones: [
          { freq: 880, ms: 60 },
          { freq: 880, ms: 60 },
        ],
        vibrate: [40, 60, 40],
      };
    case 'queued':
      return { tones: [{ freq: 660, ms: 140 }], vibrate: [80] };
    case 'unexpected':
    case 'error':
      return { tones: [{ freq: 220, ms: 350 }], vibrate: [200, 80, 200] };
  }
}

const SOUND_KEY = 'ih.scanSound';

export function isScanSoundOn(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setScanSoundOn(on: boolean): void {
  try {
    if (on) localStorage.removeItem(SOUND_KEY);
    else localStorage.setItem(SOUND_KEY, 'off');
  } catch {
    // ignore
  }
}

let ctx: AudioContext | null = null;

/** Plays the feedback for `kind`. Never throws (no audio / vibration API). */
export function scanFeedback(kind: ScanFeedbackKind): void {
  const { tones, vibrate } = feedbackFor(kind);
  try {
    navigator.vibrate?.(vibrate);
  } catch {
    // unsupported
  }
  if (!isScanSoundOn()) return;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    let at = ctx.currentTime;
    for (const tone of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = tone.freq;
      osc.type = 'square';
      // Short attack/release so it clicks less.
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.08, at + 0.005);
      gain.gain.setValueAtTime(0.08, at + tone.ms / 1000 - 0.01);
      gain.gain.linearRampToValueAtTime(0, at + tone.ms / 1000);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + tone.ms / 1000);
      at += tone.ms / 1000 + 0.05;
    }
  } catch {
    // audio unavailable
  }
}
