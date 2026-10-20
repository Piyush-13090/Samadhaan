#!/usr/bin/env node
/**
 * Sensitivity analysis of the priority heuristic (Prompt 28).
 *
 *   npm run build && node scripts/ml/priority-sensitivity.mjs [--n=2000] [--seed=28] [--out=file.json]
 *
 * The priority engine (`priority-heuristic-v1`) has no independently adjudicated
 * priority labels to be evaluated against, so its *accuracy* cannot be measured
 * and this script does not try. It measures how the ranking it produces
 * responds to its own configuration: each feature weight is moved ±25% and the
 * perturbed ranking is compared with the baseline (Spearman correlation, tier
 * agreement, and churn in the top decile). It also reports how often the
 * documented safeguards fire — the community-impact share cap and the safety
 * floor — and how missing data moves scores.
 *
 * Inputs are synthetic feature vectors from a seeded generator, not real
 * problems: the question is how the scoring function behaves, not how real
 * problems score. Runs the compiled production code (dist/), not a copy.
 */
import { writeFileSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { PRIORITY_FEATURES } from '@samadhaan/shared';
import { AppConfig } from '../../dist/config/app.config.js';
import { validateEnv } from '../../dist/config/env.schema.js';
import {
  HeuristicPriorityModel,
  ENGAGEMENT_SHARE_CAP,
} from '../../dist/priority/priority-model.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  }),
);
const N = Number(args.n ?? 2000);
const SEED = Number(args.seed ?? 28);

// Default configuration, exactly as a deployment without overrides gets it.
const env = validateEnv({
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://unused:unused@localhost:5432/unused',
  REDIS_URL: 'redis://localhost:6379',
  AI_SERVICE_URL: 'http://localhost:8001',
  JWT_ACCESS_SECRET: 'sensitivity-analysis-only-not-a-real-secret-value',
});
const config = new AppConfig(new ConfigService(env)).priority;
const model = new HeuristicPriorityModel();

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(SEED);
const feature = (missingRate) => {
  const missing = rand() < missingRate;
  return {
    value: missing ? null : rand(),
    confidence: 0.4 + rand() * 0.6,
    source: 'synthetic',
    evidence: [],
    note: null,
    headline: null,
  };
};
const samples = Array.from({ length: N }, () =>
  Object.fromEntries(
    PRIORITY_FEATURES.map((key) => [key, feature(key === 'recency' ? 0 : 0.15)]),
  ),
);

function ranks(values) {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) out[order[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return out;
}
function spearman(x, y) {
  const rx = ranks(x);
  const ry = ranks(y);
  const mean = (rx.length - 1) / 2;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i] - mean) * (ry[i] - mean);
    dx += (rx[i] - mean) ** 2;
    dy += (ry[i] - mean) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}
const topDecile = (scores) =>
  new Set(
    scores
      .map((s, i) => [s, i])
      .sort((a, b) => b[0] - a[0] || a[1] - b[1])
      .slice(0, Math.ceil(scores.length / 10))
      .map(([, i]) => i),
  );
const round = (x) => Number(x.toFixed(4));

const baseline = samples.map((f) => model.score(f, config));
const baseScores = baseline.map((o) => o.score);
const baseTop = topDecile(baseScores);

const perturbations = [];
for (const key of PRIORITY_FEATURES) {
  for (const factor of [0.75, 1.25]) {
    const weights = { ...config.weights, [key]: config.weights[key] * factor };
    const out = samples.map((f) => model.score(f, { ...config, weights }));
    const scores = out.map((o) => o.score);
    const top = topDecile(scores);
    perturbations.push({
      feature: key,
      factor,
      spearman: round(spearman(baseScores, scores)),
      tierAgreement: round(out.filter((o, i) => o.tier === baseline[i].tier).length / N),
      topDecileOverlap: round(
        [...top].filter((i) => baseTop.has(i)).length / baseTop.size,
      ),
      meanAbsScoreChange: round(
        scores.reduce((s, v, i) => s + Math.abs(v - baseScores[i]), 0) / N,
      ),
    });
  }
}

const tiers = {};
for (const o of baseline) tiers[o.tier] = (tiers[o.tier] ?? 0) + 1;
const missingAny = samples.map((f) => PRIORITY_FEATURES.some((k) => f[k].value === null));
const meanScore = (pick) => {
  const xs = baseScores.filter((_, i) => pick(i));
  return xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
};

const report = {
  description:
    'Sensitivity of priority-heuristic-v1 to ±25% weight changes on seeded synthetic feature vectors. Not an accuracy evaluation: no independent priority labels exist.',
  scoringVersion: model.version,
  samples: N,
  seed: SEED,
  weights: config.weights,
  tiers: config.tiers,
  baselineTierDistribution: tiers,
  safeguards: {
    safetyFloorApplied: baseline.filter((o) => o.floor).length,
    engagementShareCap: ENGAGEMENT_SHARE_CAP,
    provisional: baseline.filter((o) => o.provisional).length,
  },
  missingData: {
    samplesWithAnyMissingFeature: missingAny.filter(Boolean).length,
    meanScoreWithMissing: meanScore((i) => missingAny[i]),
    meanScoreComplete: meanScore((i) => !missingAny[i]),
  },
  perturbations,
  leastStable: [...perturbations].sort((a, b) => a.spearman - b.spearman).slice(0, 3),
};

const text = JSON.stringify(report, null, 2);
if (args.out) writeFileSync(args.out, text + '\n');
console.log(text);
