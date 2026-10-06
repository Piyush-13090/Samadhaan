import { describe, expect, it } from 'vitest';
import { assertViewport, chooseCellSize } from './problem-map.service.js';

const box = (west: number, south: number, east: number, north: number) => ({
  west,
  south,
  east,
  north,
});

describe('assertViewport', () => {
  it('returns a valid viewport as [west, south, east, north]', () => {
    expect(assertViewport(box(76.9, 28.3, 77.2, 28.6), 1.5)).toEqual([
      76.9, 28.3, 77.2, 28.6,
    ]);
  });

  it('refuses an inverted or empty box', () => {
    expect(() => assertViewport(box(77, 28.6, 77.2, 28.3), 1.5)).toThrow(/south/);
    expect(() => assertViewport(box(77.2, 28.3, 77, 28.6), 1.5)).toThrow(/west/);
    expect(() => assertViewport(box(77, 28.3, 77, 28.6), 1.5)).toThrow(/west/);
  });

  it('refuses a box wider or taller than the endpoint allows', () => {
    expect(() => assertViewport(box(70, 28, 72, 28.5), 1.5)).toThrow(/too large/);
    expect(() => assertViewport(box(77, 20, 77.5, 22), 1.5)).toThrow(/too large/);
    expect(assertViewport(box(70, 20, 72, 22), 40)).toEqual([70, 20, 72, 22]);
  });
});

describe('chooseCellSize', () => {
  it('scales the grid with the viewport', () => {
    expect(chooseCellSize([77, 28.4, 77.1, 28.5])).toBe(0.01);
    expect(chooseCellSize([76, 28, 78, 30])).toBe(0.2);
    expect(chooseCellSize([68, 8, 98, 37])).toBe(2);
  });
});
