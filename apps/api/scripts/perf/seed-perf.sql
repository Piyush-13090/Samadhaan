-- ===========================================================================
-- Synthetic performance dataset (Prompt 27).
--
-- For a DEDICATED benchmark database only (e.g. samadhaan_perf). Never run it
-- against development or production data. Deterministic (setseed), so runs
-- are comparable. All content is synthetic.
--
--   psql "$PERF_DATABASE_URL" -v pwhash="'<argon2 hash>'" -f scripts/perf/seed-perf.sql
--
-- Scale (defaults): 20 cities · 20,000 users · 20 government offices ·
-- 400 NGOs · 100,000 problems · 300,000 supports · ~160,000 audit rows ·
-- 200,000 notifications · 120,000 ledger rows · 100,000 problem embeddings ·
-- 20,000 knowledge chunks.
-- ===========================================================================
\set ON_ERROR_STOP on
SELECT setseed(0.27);

CREATE TEMP TABLE city(i int PRIMARY KEY, name text, state text, lat float8, lng float8);
INSERT INTO city VALUES
 (0,'Pune','Maharashtra',18.52,73.86),(1,'Mumbai','Maharashtra',19.07,72.88),
 (2,'Nagpur','Maharashtra',21.15,79.09),(3,'Gurugram','Haryana',28.46,77.03),
 (4,'Delhi','Delhi',28.61,77.21),(5,'Bengaluru','Karnataka',12.97,77.59),
 (6,'Chennai','Tamil Nadu',13.08,80.27),(7,'Hyderabad','Telangana',17.39,78.49),
 (8,'Kolkata','West Bengal',22.57,88.36),(9,'Ahmedabad','Gujarat',23.02,72.57),
 (10,'Jaipur','Rajasthan',26.91,75.79),(11,'Lucknow','Uttar Pradesh',26.85,80.95),
 (12,'Bhopal','Madhya Pradesh',23.26,77.41),(13,'Indore','Madhya Pradesh',22.72,75.86),
 (14,'Patna','Bihar',25.59,85.14),(15,'Kochi','Kerala',9.93,76.27),
 (16,'Chandigarh','Punjab',30.73,76.78),(17,'Surat','Gujarat',21.17,72.83),
 (18,'Nashik','Maharashtra',19.99,73.79),(19,'Mysuru','Karnataka',12.30,76.64);

-- --------------------------------------------------------------- users
INSERT INTO users (id, email, "passwordHash", "fullName", "displayName", role, status, city, "createdAt", "updatedAt")
SELECT gen_random_uuid(), format('perf-user-%s@perf.test', g), :pwhash, format('Perf User %s', g),
       format('perfuser%s', g),
       (CASE WHEN g <= 40 THEN 'GOVERNMENT' WHEN g <= 840 THEN 'NGO' ELSE 'CITIZEN' END)::"UserRole",
       'ACTIVE', (SELECT name FROM city WHERE i = g % 20), now() - make_interval(secs => (random() * 400) * 86400), now()
FROM generate_series(1, 20000) g;

-- ------------------------------------------------------- organisations
INSERT INTO organizations (id, name, slug, type, "verificationStatus", city, state, "jurisdictionType",
                           "jurisdictionName", "jurisdictionCities", description, "createdAt", "updatedAt")
SELECT gen_random_uuid(), format('%s Municipal Office', c.name), format('perf-office-%s', c.i), 'GOVERNMENT',
       'VERIFIED', c.name, c.state, 'MUNICIPAL_CORPORATION', c.name, ARRAY[c.name], 'Municipal corporation', now(), now()
FROM city c;
INSERT INTO organizations (id, name, slug, type, "verificationStatus", city, state, description, "createdAt", "updatedAt")
SELECT gen_random_uuid(), format('Perf Civic Trust %s', g), format('perf-ngo-%s', g), 'NGO',
       (CASE WHEN g % 10 = 0 THEN 'PENDING' ELSE 'VERIFIED' END)::"VerificationStatus",
       c.name, c.state,
       (ARRAY['waste management and sanitation drives','road repair and pothole surveys',
              'drainage and stormwater cleanup','street lighting audits','water supply advocacy'])[1 + g % 5],
       now(), now()
FROM generate_series(1, 400) g JOIN city c ON c.i = g % 20;

-- Government officials (users 1..40): two per office.
INSERT INTO organization_members (id, "organizationId", "userId", "membershipRole", status, "joinedAt", "updatedAt")
SELECT gen_random_uuid(), o.id, u.id, 'OWNER', 'ACTIVE', now(), now()
FROM users u
JOIN organizations o ON o.slug = format('perf-office-%s', (substring(u.email from 'perf-user-(\d+)@')::int - 1) % 20)
WHERE u.role = 'GOVERNMENT' AND u.email LIKE 'perf-user-%';
-- NGO members (users 41..840): two per NGO.
INSERT INTO organization_members (id, "organizationId", "userId", "membershipRole", status, "joinedAt", "updatedAt")
SELECT gen_random_uuid(), o.id, u.id, 'OWNER', 'ACTIVE', now(), now()
FROM users u
JOIN organizations o ON o.slug = format('perf-ngo-%s', 1 + (substring(u.email from 'perf-user-(\d+)@')::int - 41) % 400)
WHERE u.role = 'NGO' AND u.email LIKE 'perf-user-%';

-- ------------------------------------------------------------ problems
CREATE TEMP TABLE citizen AS
SELECT id, row_number() OVER (ORDER BY email) AS n FROM users WHERE role = 'CITIZEN';
CREATE INDEX ON citizen(n);

INSERT INTO problems (id, "reporterId", title, description, category, subcategory, status, severity, urgency,
                      address, city, state, "postalCode", latitude, longitude, "voteCount", "commentCount",
                      "submittedAt", "resolvedAt", "createdAt", "updatedAt", "priorityTier", "priorityScore")
SELECT gen_random_uuid(),
       (SELECT id FROM citizen WHERE n = 1 + (g * 7919) % 19160),
       format('%s near %s %s', t.title, (ARRAY['Sector','Main Road','Market','Ward','Colony'])[1 + g % 5], 1 + g % 90),
       format('%s. Reported by residents of %s; it has been like this for %s days.', t.body, c.name, 1 + g % 40),
       t.category::"ProblemCategory", t.sub,
       s.status::"ProblemStatus",
       (ARRAY['LOW','MEDIUM','MEDIUM','HIGH','CRITICAL'])[1 + g % 5]::"ProblemSeverity",
       (ARRAY['LOW','MEDIUM','HIGH','CRITICAL'])[1 + (g / 3) % 4]::"ProblemUrgency",
       format('%s %s, %s', 1 + g % 300, (ARRAY['MG Road','Link Road','Station Road','Ring Road'])[1 + g % 4], c.name),
       c.name, c.state, format('%s', 400000 + c.i * 1000 + g % 50),
       round((c.lat + (random() - 0.5) * 0.3)::numeric, 6), round((c.lng + (random() - 0.5) * 0.3)::numeric, 6),
       (random() * random() * 60)::int, (random() * 8)::int,
       d.created, CASE WHEN s.status = 'RESOLVED' THEN d.created + make_interval(secs => (random() * 30) * 86400) END,
       d.created, d.created,
       (ARRAY[NULL,'LOW','MEDIUM','HIGH','CRITICAL'])[1 + g % 5]::"PriorityTier", (g % 100)::numeric
FROM generate_series(1, 100000) g
JOIN city c ON c.i = g % 20
CROSS JOIN LATERAL (SELECT now() - make_interval(secs => power(random(), 1.6) * 365 * 86400) AS created) d
CROSS JOIN LATERAL (
  SELECT (ARRAY['SUBMITTED','SUBMITTED','UNDER_REVIEW','VERIFIED','VERIFIED','IN_PROGRESS','RESOLVED','RESOLVED','REJECTED','DUPLICATE'])[1 + g % 10] AS status
) s
CROSS JOIN LATERAL (
  SELECT * FROM (VALUES
    ('Blocked storm drain flooding the lane','Water collects after every shower because the drain is choked','DRAINAGE','blocked drain'),
    ('Deep pothole on the carriageway','A large pothole is damaging vehicles and causing accidents','POTHOLES','pothole'),
    ('Garbage pile not collected','Household waste has been dumped and not picked up','GARBAGE','uncollected waste'),
    ('Streetlight not working','The streetlight has been dark for a week making the road unsafe at night','STREETLIGHTS','dark streetlight'),
    ('Water pipeline leaking','Drinking water is leaking from a burst pipe','WATER','pipe leak'),
    ('Open manhole on footpath','An uncovered manhole is a danger to pedestrians','PUBLIC_SAFETY','open manhole'),
    ('Broken road surface','The road surface has crumbled after the monsoon','ROADS','broken road'),
    ('Sewage overflowing','Sewage is overflowing onto the street','SANITATION','sewage overflow'),
    ('Traffic signal not working','The signal at the junction is off causing jams','TRAFFIC','signal failure'),
    ('Park equipment damaged','Swings in the children''s park are broken','PARKS','damaged equipment')
  ) v(title, body, category, sub) OFFSET g % 10 LIMIT 1
) t;

ANALYZE problems;

-- -------------------------------------------------- votes and follows
INSERT INTO problem_votes (id, "problemId", "userId", "createdAt")
SELECT gen_random_uuid(), p.id, c.id, p."createdAt" + interval '1 hour'
FROM (SELECT id, "createdAt", row_number() OVER () AS r FROM problems) p
JOIN LATERAL generate_series(0, 2) k ON true
JOIN citizen c ON c.n = 1 + ((p.r * 31 + k * 977) % 19160)
ON CONFLICT DO NOTHING;
INSERT INTO problem_follows (id, "problemId", "userId", "createdAt")
SELECT gen_random_uuid(), p.id, c.id, now()
FROM (SELECT id, row_number() OVER () AS r FROM problems WHERE random() < 0.5) p
JOIN citizen c ON c.n = 1 + ((p.r * 53) % 19160)
ON CONFLICT DO NOTHING;

-- --------------------------------------------- audit trail (status changes)
INSERT INTO audit_logs (id, "actorUserId", action, "entityType", "entityId", metadata, "createdAt")
SELECT gen_random_uuid(), NULL, 'PROBLEM_STATUS_CHANGED', 'Problem', p.id,
       jsonb_build_object('from', 'SUBMITTED', 'to', 'UNDER_REVIEW'), p."createdAt" + interval '6 hours'
FROM problems p WHERE p.status NOT IN ('SUBMITTED');
INSERT INTO audit_logs (id, "actorUserId", action, "entityType", "entityId", metadata, "createdAt")
SELECT gen_random_uuid(), NULL, 'PROBLEM_STATUS_CHANGED', 'Problem', p.id,
       jsonb_build_object('from', 'UNDER_REVIEW', 'to', 'VERIFIED'), p."createdAt" + interval '2 days'
FROM problems p WHERE p.status IN ('VERIFIED','IN_PROGRESS','RESOLVED');

-- ------------------------------------------------------- AI analyses
INSERT INTO problem_ai_analyses (id, "problemId", "modelName", "modelVersion", "analysisType", category, severity,
                                 summary, confidence, "processingStatus", "createdAt", "updatedAt")
SELECT gen_random_uuid(), p.id, 'synthetic', '1', 'INITIAL_ANALYSIS', p.category, p.severity,
       'Synthetic summary: ' || lower(p.title), 0.8, 'COMPLETED', p."createdAt", p."createdAt"
FROM problems p WHERE random() < 0.4;

-- ------------------------------------------------------ notifications
INSERT INTO notifications (id, "recipientId", type, title, message, "entityType", "entityId", "dedupeKey", "readAt", "createdAt")
SELECT gen_random_uuid(), c.id, 'PROBLEM_SUPPORTED', 'Someone supported your report', 'Your report has a new supporter.',
       'PROBLEM', NULL, format('perf:%s', g), CASE WHEN g % 3 = 0 THEN NULL ELSE now() END,
       now() - make_interval(secs => (random() * 120) * 86400)
FROM generate_series(1, 200000) g JOIN citizen c ON c.n = 1 + (g % 19160);

-- --------------------------------------------------------- impact ledger
INSERT INTO impact_point_transactions (id, "userId", amount, type, reason, "problemId", "ruleVersion", "idempotencyKey", "createdAt")
SELECT gen_random_uuid(), p."reporterId", 20, 'PROBLEM_VERIFIED', 'Synthetic award', p.id, 'POINT_RULES_V1',
       'PROBLEM_VERIFIED:' || p.id || ':' || p."reporterId", p."createdAt" + interval '2 days'
FROM problems p WHERE p.status IN ('VERIFIED','IN_PROGRESS','RESOLVED');
INSERT INTO impact_point_transactions (id, "userId", amount, type, reason, "problemId", "ruleVersion", "idempotencyKey", "createdAt")
SELECT gen_random_uuid(), p."reporterId", 30, 'PROBLEM_RESOLVED', 'Synthetic award', p.id, 'POINT_RULES_V1',
       'PROBLEM_RESOLVED:' || p.id || ':' || p."reporterId" || ':reporter', COALESCE(p."resolvedAt", now())
FROM problems p WHERE p.status = 'RESOLVED';
INSERT INTO user_impact_stats ("userId", "impactPoints", "resolvedContributions", "updatedAt")
SELECT "userId", sum(amount), count(*) FILTER (WHERE type = 'PROBLEM_RESOLVED'), now()
FROM impact_point_transactions GROUP BY 1;

-- ------------------------------------------- embeddings (random, 384-d)
-- Bulk load without the HNSW indexes, then rebuild them once (much faster
-- than maintaining the graph row by row). post-migrate.sql recreates them.
DROP INDEX IF EXISTS problem_embeddings_vector_hnsw;
DROP INDEX IF EXISTS knowledge_chunks_embedding_hnsw;
-- Random unit vectors: realistic for latency and index build cost, a
-- worst case for ANN recall (no cluster structure).
INSERT INTO problem_embeddings (id, "problemId", "embeddingType", "modelName", "modelVersion", dimensions, embedding, "createdAt")
SELECT gen_random_uuid(), p.id, 'TEXT', 'sentence-transformers/all-MiniLM-L6-v2', 'perf-synthetic', 384,
       (SELECT array_agg(random() - 0.5) FROM generate_series(1, 384) WHERE p.id IS NOT NULL)::vector, now()
FROM problems p;

-- --------------------------------------------------------- knowledge
INSERT INTO knowledge_sources (id, title, "sourceType", visibility, status, "chunkCount", "embeddingModel",
                               "embeddingVersion", "createdAt", "updatedAt")
SELECT gen_random_uuid(), format('Perf civic guideline %s', g), 'CIVIC_GUIDELINE', 'PUBLIC', 'COMPLETED', 100,
       'sentence-transformers/all-MiniLM-L6-v2', 'perf-synthetic', now(), now()
FROM generate_series(1, 200) g;
INSERT INTO knowledge_documents (id, "knowledgeSourceId", title, content, "contentHash", "updatedAt")
SELECT gen_random_uuid(), s.id, s.title, 'synthetic', md5(s.id::text), now() FROM knowledge_sources s;
INSERT INTO knowledge_chunks (id, "documentId", "sourceId", "chunkIndex", content, "tokenCount", "contentHash",
                              embedding, "embeddingModel", "embeddingVersion", "createdAt", "updatedAt")
SELECT gen_random_uuid(), d.id, d."knowledgeSourceId", k,
       format('Guidance section %s: clear storm drains, repair potholes and keep streetlights working before the monsoon.', k),
       40, md5(d.id::text || k),
       (SELECT array_agg(random() - 0.5) FROM generate_series(1, 384) WHERE k IS NOT NULL)::vector,
       'sentence-transformers/all-MiniLM-L6-v2', 'perf-synthetic', now(), now()
FROM knowledge_documents d CROSS JOIN generate_series(0, 99) k;

\timing on
CREATE INDEX problem_embeddings_vector_hnsw ON problem_embeddings USING hnsw (embedding vector_cosine_ops);
CREATE INDEX knowledge_chunks_embedding_hnsw ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
\timing off
VACUUM ANALYZE;
