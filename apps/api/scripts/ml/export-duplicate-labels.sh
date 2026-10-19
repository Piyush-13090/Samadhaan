#!/usr/bin/env bash
# Exports human-reviewed duplicate decisions as an ML dataset (Prompt 28).
#
#   ML_EXPORT_SALT=<secret> scripts/ml/export-duplicate-labels.sh <version> [reviewer-roles]
#
# Writes services/ai/ml_data/duplicate-pairs/<version>/{dataset.json,records.jsonl}
# (git-ignored). Contains only what the duplicate_pair schema allows: the stored
# 0–1 signals, the existing combined score (as a baseline, not a label), the
# human decision, the review date and the coarse city. Problem and candidate ids
# are replaced by salted SHA-256 pseudonyms — the salt is a secret kept outside
# the dataset, so ids cannot be reversed from it. No text, names, coordinates or
# reporter identity leave the database.
#
# Labels: CONFIRMED_DUPLICATE -> true, NOT_DUPLICATE -> false, and only when a
# person recorded the decision (reviewedById set). By default only decisions by
# GOVERNMENT or ADMIN reviewers are exported: a reporter confirming their own
# report is a real judgement but not an independent one. Pass
# "GOVERNMENT,ADMIN,CITIZEN" to include them, and say so in the manifest.
#
# Run against an authorised database only, under the data-access policy in
# docs/ML_DATASETS.md.
set -euo pipefail
cd "$(dirname "$0")/../.."

VERSION="${1:?usage: export-duplicate-labels.sh <version> [reviewer-roles]}"
ROLES="${2:-GOVERNMENT,ADMIN}"
: "${ML_EXPORT_SALT:?Set ML_EXPORT_SALT (a secret, 32+ characters) for pseudonymisation}"
[ "${#ML_EXPORT_SALT}" -ge 32 ] || { echo "ML_EXPORT_SALT must be 32+ characters" >&2; exit 1; }
[[ "$VERSION" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || { echo "version must match [a-z0-9][a-z0-9._-]*" >&2; exit 1; }

if [ -z "${DATABASE_URL:-}" ]; then
  for candidate in .env ../../.env; do
    [ -f "$candidate" ] && DATABASE_URL="$(grep -E '^DATABASE_URL=' "$candidate" | tail -1 | cut -d= -f2-)" && break
  done
fi
: "${DATABASE_URL:?DATABASE_URL is not set}"

OUT="../../services/ai/ml_data/duplicate-pairs/$VERSION"
[ -e "$OUT" ] && { echo "$OUT already exists; a dataset version is immutable" >&2; exit 1; }
mkdir -p "$OUT"

psql "${DATABASE_URL%%\?*}" -X -q -At -v ON_ERROR_STOP=1 -v salt="$ML_EXPORT_SALT" -v roles="$ROLES" > "$OUT/records.jsonl" <<'SQL'
SELECT json_strip_nulls(json_build_object(
  'record_id',             'pair-' || left(encode(sha256(convert_to(:'salt' || d.id::text, 'UTF8')), 'hex'), 24),
  'problem_a',             'p-' || left(encode(sha256(convert_to(:'salt' || d."problemId"::text, 'UTF8')), 'hex'), 24),
  'problem_b',             'p-' || left(encode(sha256(convert_to(:'salt' || d."candidateProblemId"::text, 'UTF8')), 'hex'), 24),
  'text_similarity',       d."textSimilarity"::float8,
  'geographic_similarity', d."geographicSimilarity"::float8,
  'category_similarity',   d."categorySimilarity"::float8,
  'image_similarity',      d."imageSimilarity"::float8,
  'baseline_score',        d."combinedScore"::float8,
  'is_duplicate',          d.status = 'CONFIRMED_DUPLICATE',
  'label_source',          'HUMAN_REVIEWED',
  'created_at',            to_char(d."reviewedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'city',                  p.city
))
FROM problem_duplicate_candidates d
JOIN problems p ON p.id = d."problemId"
JOIN users r ON r.id = d."reviewedById"
WHERE d.status IN ('CONFIRMED_DUPLICATE', 'NOT_DUPLICATE')
  AND d."reviewedById" IS NOT NULL
  AND r.role::text = ANY (string_to_array(:'roles', ','))
ORDER BY d.id;
SQL

COUNT=$(wc -l < "$OUT/records.jsonl" | tr -d ' ')
cat > "$OUT/dataset.json" <<JSON
{
  "name": "duplicate-pairs",
  "version": "$VERSION",
  "task": "duplicate_pair",
  "records_file": "records.jsonl",
  "description": "Reviewed duplicate candidate pairs exported from problem_duplicate_candidates ($COUNT records).",
  "owner": "Samadhaan platform team",
  "permitted_uses": ["training", "evaluation"],
  "retention": "Delete with the source decisions; re-export after deletion requests. Review yearly.",
  "collection": "Decisions recorded in the duplicate review flow by reviewers with roles $ROLES; signals computed by duplicate-detection at candidate time.",
  "consent_basis": "Platform terms: reports are processed to detect duplicates; export is pseudonymised and contains no report text.",
  "contains_personal_data": false,
  "synthetic": false,
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
echo "exported $COUNT reviewed pairs to $OUT"
