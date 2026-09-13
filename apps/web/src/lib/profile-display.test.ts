import { describe, expect, it } from 'vitest';
import {
  EXPERTISE_DISPLAY,
  VERIFICATION_DISPLAY,
  formatLocation,
} from './profile-display';

describe('formatLocation', () => {
  it('joins city, state and country', () => {
    expect(formatLocation({ city: 'Gurugram', state: 'Haryana', country: 'India' })).toBe(
      'Gurugram, Haryana, India',
    );
  });

  it('omits missing parts rather than leaving stray commas', () => {
    expect(formatLocation({ city: 'Gurugram', state: null, country: 'India' })).toBe(
      'Gurugram, India',
    );
  });

  it('returns null when nothing is set', () => {
    expect(formatLocation({ city: null, state: null, country: null })).toBeNull();
  });

  // The country defaults to India for every account, so showing it alone would
  // label everyone "India" and communicate nothing.
  it('returns null when only the default country is known', () => {
    expect(formatLocation({ city: null, state: null, country: 'India' })).toBeNull();
  });

  it('shows a city even without a state', () => {
    expect(formatLocation({ city: 'Gurugram', state: null, country: null })).toBe(
      'Gurugram',
    );
  });
});

describe('status presentation', () => {
  it('gives every verification status a label and a tone', () => {
    for (const status of ['PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED'] as const) {
      expect(VERIFICATION_DISPLAY[status].label).toBeTruthy();
      expect(VERIFICATION_DISPLAY[status].description).toBeTruthy();
    }
  });

  it('treats only VERIFIED as positive', () => {
    expect(VERIFICATION_DISPLAY.VERIFIED.tone).toBe('success');
    expect(VERIFICATION_DISPLAY.PENDING.tone).toBe('warning');
    expect(VERIFICATION_DISPLAY.REJECTED.tone).toBe('danger');
    expect(VERIFICATION_DISPLAY.SUSPENDED.tone).toBe('danger');
  });

  // Pips are what make level readable without colour.
  it('orders expertise pips by strength', () => {
    expect(EXPERTISE_DISPLAY.SPECIALIST.pips).toBeGreaterThan(
      EXPERTISE_DISPLAY.EXPERIENCED.pips,
    );
    expect(EXPERTISE_DISPLAY.EXPERIENCED.pips).toBeGreaterThan(
      EXPERTISE_DISPLAY.INTERESTED.pips,
    );
  });
});
