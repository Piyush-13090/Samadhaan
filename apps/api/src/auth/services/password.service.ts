import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@samadhaan/shared';

/**
 * Password hashing and strength assessment.
 *
 * Argon2id — the algorithm recommended by OWASP for new applications, and the
 * winner of the Password Hashing Competition. It resists both GPU cracking
 * (memory-hard) and side-channel attacks (the `id` variant), which bcrypt does
 * not do as well.
 *
 * Parameters follow OWASP's minimum guidance (19 MiB, 2 iterations, parallelism
 * 1). The `argon2` library encodes them in the hash string, so raising them
 * later does not invalidate existing hashes — old ones still verify, and
 * `needsRehash` reports which should be upgraded on next sign-in.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

/** Rejected outright regardless of length — these are the first guesses tried. */
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  'qwertyuiop',
  'letmein123',
  'iloveyou1',
  'admin12345',
  'welcome123',
  'samadhaan',
  'samadhaan1',
  'changeme123',
]);

export interface PasswordStrength {
  /** 0–4. Below 2 is rejected. */
  score: number;
  /** What the user should change. Empty when acceptable. */
  problems: string[];
}

@Injectable()
export class PasswordService {
  hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext, ARGON2_OPTIONS);
  }

  /**
   * Verifies a password. Never throws: a malformed stored hash is a server
   * problem, not a reason to tell the caller something unusual happened.
   */
  async verify(hash: string, plaintext: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plaintext);
    } catch {
      return false;
    }
  }

  /** True when the stored hash uses weaker parameters than current policy. */
  needsRehash(hash: string): boolean {
    try {
      return argon2.needsRehash(hash, ARGON2_OPTIONS);
    } catch {
      return true;
    }
  }

  /**
   * Composition-based strength check.
   *
   * Length is weighted most heavily because it matters most; a mandatory-symbol
   * rule mostly produces `Password1!`. The common-password list catches what
   * composition rules always miss.
   */
  assess(
    password: string,
    context: { email?: string; fullName?: string } = {},
  ): PasswordStrength {
    const problems: string[] = [];
    const normalized = password.toLowerCase();

    if (password.length < PASSWORD_MIN_LENGTH) {
      problems.push(`Use at least ${PASSWORD_MIN_LENGTH} characters`);
    }
    if (password.length > PASSWORD_MAX_LENGTH) {
      problems.push(`Use at most ${PASSWORD_MAX_LENGTH} characters`);
    }
    if (COMMON_PASSWORDS.has(normalized)) {
      problems.push('This password is too common');
    }

    // A password containing the user's own email or name is trivially guessable.
    const localPart = context.email?.split('@')[0]?.toLowerCase();
    if (localPart && localPart.length >= 3 && normalized.includes(localPart)) {
      problems.push('Do not include your email address');
    }
    for (const part of (context.fullName ?? '').toLowerCase().split(/\s+/)) {
      if (part.length >= 3 && normalized.includes(part)) {
        problems.push('Do not include your name');
        break;
      }
    }
    if (/^(.)\1+$/.test(password)) {
      problems.push('Do not repeat a single character');
    }

    let score = 0;
    if (password.length >= PASSWORD_MIN_LENGTH) score += 1;
    if (password.length >= 14) score += 1;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
    if (/\d/.test(password)) score += 0.5;
    if (/[^\w\s]/.test(password)) score += 0.5;

    return {
      score: problems.length > 0 ? Math.min(Math.floor(score), 1) : Math.floor(score),
      problems,
    };
  }
}
