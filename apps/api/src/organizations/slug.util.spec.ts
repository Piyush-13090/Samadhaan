import { describe, expect, it, vi } from 'vitest';
import { generateUniqueSlug, slugify } from './slug.util.js';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Clean City Foundation')).toBe('clean-city-foundation');
  });

  it('strips punctuation rather than encoding it', () => {
    expect(slugify('Ward 12 (Municipal) Office!')).toBe('ward-12-municipal-office');
  });

  it('collapses runs of separators', () => {
    expect(slugify('A   ---   B')).toBe('a-b');
  });

  it('trims leading and trailing separators', () => {
    expect(slugify('  --Hello--  ')).toBe('hello');
  });

  // Decomposing accents keeps non-ASCII names readable instead of mangling them.
  it('folds accented characters to their base letters', () => {
    expect(slugify('Pūrṇa Foundation')).toBe('purna-foundation');
    expect(slugify('Société Générale')).toBe('societe-generale');
  });

  it('returns an empty stem when nothing survives', () => {
    expect(slugify('日本語')).toBe('');
    expect(slugify('!!!')).toBe('');
  });

  it('caps the length and leaves no trailing hyphen', () => {
    const slug = slugify('a'.repeat(200));

    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('generateUniqueSlug', () => {
  const free = vi.fn(async () => false);

  it('uses the plain slug when it is available', async () => {
    await expect(generateUniqueSlug('Clean City', free)).resolves.toBe('clean-city');
  });

  it('appends a readable numeric suffix on collision', async () => {
    const taken = new Set(['clean-city']);

    await expect(
      generateUniqueSlug('Clean City', async (slug) => taken.has(slug)),
    ).resolves.toBe('clean-city-2');
  });

  it('keeps counting past several collisions', async () => {
    const taken = new Set(['clean-city', 'clean-city-2', 'clean-city-3']);

    await expect(
      generateUniqueSlug('Clean City', async (slug) => taken.has(slug)),
    ).resolves.toBe('clean-city-4');
  });

  it('falls back to a random suffix when numbering is exhausted', async () => {
    const result = await generateUniqueSlug('Clean City', async () => true, {
      maxAttempts: 3,
    });

    expect(result).toMatch(/^clean-city-[a-z0-9]{6}$/);
  });

  it('substitutes a stable stem for a name with no Latin characters', async () => {
    await expect(generateUniqueSlug('日本語', free)).resolves.toBe('organization');
  });

  it('never exceeds the length cap, even with a suffix', async () => {
    const taken = new Set([slugify('a'.repeat(200))]);

    const result = await generateUniqueSlug('a'.repeat(200), async (slug) =>
      taken.has(slug),
    );

    expect(result.length).toBeLessThanOrEqual(80);
  });
});
