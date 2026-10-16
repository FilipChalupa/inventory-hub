import { beforeEach, describe, expect, it } from 'vitest';
import { feedbackFor, isScanSoundOn, scanFeedback, setScanSoundOn } from './scanFeedback.js';

describe('scan feedback', () => {
  beforeEach(() => localStorage.clear());

  it('gives each outcome a distinct, recognisable pattern', () => {
    expect(feedbackFor('found').tones).toHaveLength(1);
    expect(feedbackFor('already').tones).toHaveLength(2);
    const problem = feedbackFor('unexpected');
    expect(problem.tones[0]!.freq).toBeLessThan(feedbackFor('found').tones[0]!.freq);
    expect(problem.tones[0]!.ms).toBeGreaterThan(feedbackFor('found').tones[0]!.ms);
    expect(feedbackFor('error')).toEqual(problem);
  });

  it('remembers the sound toggle and never throws without audio APIs', () => {
    expect(isScanSoundOn()).toBe(true);
    setScanSoundOn(false);
    expect(isScanSoundOn()).toBe(false);
    setScanSoundOn(true);
    expect(isScanSoundOn()).toBe(true);
    expect(() => scanFeedback('found')).not.toThrow();
  });
});
