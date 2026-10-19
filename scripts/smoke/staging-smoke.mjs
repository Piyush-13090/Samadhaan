#!/usr/bin/env node
/**
 * Samadhaan staging smoke test (Prompt 30). Dependency-free (Node 22+).
 *
 *   SMOKE_WEB_URL=https://staging.example.org \
 *   SMOKE_CITIZEN_EMAIL=... SMOKE_CITIZEN_PASSWORD=... \
 *   SMOKE_OFFICIAL_EMAIL=... SMOKE_OFFICIAL_PASSWORD=... SMOKE_OFFICE_SLUG=... \
 *   SMOKE_ORG_EMAIL=... SMOKE_ORG_PASSWORD=... SMOKE_ORG_SLUG=... SMOKE_ORG_ID=... \
 *   SMOKE_LATITUDE=18.52 SMOKE_LONGITUDE=73.85 SMOKE_CITY=Pune \
 *   node scripts/smoke/staging-smoke.mjs
 *
 * Walks the essential workflow through the public API with SYNTHETIC records
 * (titles start with "[SMOKE TEST"): health, sign-in, photo upload, a report,
 * the AI pipeline (or its graceful absence), similar problems, access
 * boundaries, government review, allocation, the resolution room, a project
 * task, evidence, human approval, notifications, analytics, sign-out.
 *
 * Every step prints PASS, FAIL, DEGRADED (works without an optional capability)
 * or NOT RUN (prerequisite credentials not supplied). Exit code 1 on any FAIL.
 *
 * NEVER point this at production: it creates reports and resolves them. Use
 * dedicated staging accounts (docs/STAGING_SMOKE_TESTS.md).
 *
 * Optional: SMOKE_API_URL (default: SMOKE_WEB_URL, i.e. through the web
 * proxy), SMOKE_OTHER_OFFICIAL_EMAIL/PASSWORD/SLUG (jurisdiction isolation),
 * SMOKE_AI_WAIT_SECONDS (default 90), SMOKE_INSECURE_TLS=1 (self-signed local
 * certificates only).
 */

const env = process.env;
if (env.SMOKE_INSECURE_TLS === '1') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const WEB = (env.SMOKE_WEB_URL ?? '').replace(/\/+$/, '');
const API = (env.SMOKE_API_URL ?? WEB).replace(/\/+$/, '') + '/api/v1';
const ORIGIN = env.SMOKE_ORIGIN ?? WEB;
if (!WEB) {
  console.error('Set SMOKE_WEB_URL (the staging web origin).');
  process.exit(2);
}
if (/samadhaan\.(in|org|gov)/.test(WEB) && env.SMOKE_I_KNOW_THIS_IS_STAGING !== '1') {
  console.error(
    'Refusing: the URL looks like production. Set SMOKE_I_KNOW_THIS_IS_STAGING=1 for a staging host on that domain.',
  );
  process.exit(2);
}

/** A valid 640×480 JPEG, so the script needs no image files. */
const JPEG = Buffer.from(
  '/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAHgAoADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAID/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AlAZrAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf/2Q==',
  'base64',
);
const RUN = new Date().toISOString().replace(/[:.]/g, '-');
const results = [];
const record = (step, status, detail = '') => {
  results.push({ step, status, detail });
  console.log(`${status.padEnd(9)} ${step}${detail ? ` — ${detail}` : ''}`);
};

class Session {
  constructor(name) {
    this.name = name;
    this.cookies = new Map();
  }
  async call(method, path, body, { multipart = false } = {}) {
    const headers = { origin: ORIGIN, accept: 'application/json' };
    if (this.cookies.size)
      headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    let payload;
    if (multipart) payload = body;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: payload,
      redirect: 'manual',
    });
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const i = pair.indexOf('=');
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    let data = null;
    let message = null;
    try {
      const json = await res.json();
      data = json?.data ?? null;
      message = json?.error?.message ?? null;
    } catch {
      /* not JSON */
    }
    return { status: res.status, data, message };
  }
  async login(email, password) {
    const r = await this.call('POST', '/auth/login', { email, password });
    return r.status === 200;
  }
}

const has = (...names) => names.every((n) => env[n]);
const form = (fields, file) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (file) fd.append('file', new Blob([file.bytes], { type: file.type }), file.name);
  return fd;
};

async function main() {
  // 1. The application loads.
  try {
    const res = await fetch(WEB + '/', { redirect: 'manual' });
    const html = await res.text();
    record(
      'Web app loads',
      res.status === 200 && /<html/i.test(html) ? 'PASS' : 'FAIL',
      `HTTP ${res.status}`,
    );
  } catch (e) {
    record('Web app loads', 'FAIL', String(e));
  }

  // 2. Health.
  const anon = new Session('anonymous');
  const live = await anon.call('GET', '/health/live');
  record('API liveness', live.status === 200 ? 'PASS' : 'FAIL', `HTTP ${live.status}`);
  const ready = await anon.call('GET', '/health');
  const deps = (ready.data?.dependencies ?? [])
    .map((d) => `${d.name}=${d.status}`)
    .join(', ');
  record(
    'API readiness',
    ready.status === 200 ? (ready.data?.status === 'ok' ? 'PASS' : 'DEGRADED') : 'FAIL',
    `${ready.data?.status ?? 'no body'} (${deps})`,
  );

  // 3. Citizen sign-in.
  if (!has('SMOKE_CITIZEN_EMAIL', 'SMOKE_CITIZEN_PASSWORD')) {
    record(
      'Citizen journey',
      'NOT RUN',
      'SMOKE_CITIZEN_EMAIL / SMOKE_CITIZEN_PASSWORD not set',
    );
    return;
  }
  const citizen = new Session('citizen');
  const signedIn = await citizen.login(
    env.SMOKE_CITIZEN_EMAIL,
    env.SMOKE_CITIZEN_PASSWORD,
  );
  record('Citizen login', signedIn ? 'PASS' : 'FAIL');
  if (!signedIn) return;
  const me = await citizen.call('GET', '/auth/me');
  record(
    'Authenticated API request',
    me.status === 200 ? 'PASS' : 'FAIL',
    `HTTP ${me.status}`,
  );

  // 4. Upload (configured storage) and refusal of a disguised file.
  const bad = await citizen.call(
    'POST',
    '/problems/images',
    form(
      {},
      { bytes: Buffer.from('not an image'), type: 'image/jpeg', name: 'fake.jpg' },
    ),
    { multipart: true },
  );
  record(
    'Invalid upload refused',
    bad.status >= 400 && bad.status < 500 ? 'PASS' : 'FAIL',
    `HTTP ${bad.status}`,
  );
  const up = await citizen.call(
    'POST',
    '/problems/images',
    form({}, { bytes: JPEG, type: 'image/jpeg', name: 'smoke.jpg' }),
    { multipart: true },
  );
  record('Image upload', up.status === 201 ? 'PASS' : 'FAIL', `HTTP ${up.status}`);
  if (up.status !== 201) return;

  // 5. A report.
  const created = await citizen.call('POST', '/problems', {
    title: `[SMOKE TEST ${RUN}] Blocked drain`,
    description:
      'Synthetic staging smoke-test report. Not a real civic problem; safe to archive.',
    category: 'DRAINAGE',
    location: {
      latitude: Number(env.SMOKE_LATITUDE ?? 18.52),
      longitude: Number(env.SMOKE_LONGITUDE ?? 73.85),
      city: env.SMOKE_CITY ?? 'Pune',
    },
    images: [{ storageKey: up.data.storageKey, sortOrder: 0, isPrimary: true }],
  });
  record(
    'Problem report submitted',
    created.status === 201 ? 'PASS' : 'FAIL',
    `HTTP ${created.status}`,
  );
  if (created.status !== 201) return;
  const publicId = created.data.publicId;
  const view = await citizen.call('GET', `/problems/${publicId}`);
  const photo = view.data?.images?.[0]?.url;
  const media = photo
    ? await fetch(photo.startsWith('http') ? photo : WEB + photo)
    : null;
  record(
    'Report and photo readable',
    view.status === 200 && media?.status === 200 ? 'PASS' : 'FAIL',
    `${publicId}, photo HTTP ${media?.status}`,
  );

  // 6. AI pipeline, or the report surviving without it.
  const deadline = Date.now() + Number(env.SMOKE_AI_WAIT_SECONDS ?? 90) * 1000;
  let analysis = null;
  while (Date.now() < deadline) {
    analysis = (await citizen.call('GET', `/problems/${publicId}/analysis`)).data;
    if (analysis && ['COMPLETED', 'FAILED'].includes(analysis.status)) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  const stillThere = (await citizen.call('GET', `/problems/${publicId}`)).status === 200;
  record(
    'AI analysis',
    analysis?.status === 'COMPLETED' ? 'PASS' : stillThere ? 'DEGRADED' : 'FAIL',
    analysis?.status === 'COMPLETED'
      ? 'completed'
      : `status ${analysis?.status ?? 'none'}; report still usable: ${stillThere}`,
  );
  const similar = await citizen.call('GET', `/problems/${publicId}/similar`);
  record(
    'Similar-problem retrieval',
    similar.status === 200 ? 'PASS' : 'FAIL',
    `HTTP ${similar.status}`,
  );

  // 7. Boundaries.
  if (has('SMOKE_OFFICE_SLUG')) {
    const denied = await citizen.call(
      'PATCH',
      `/government/${env.SMOKE_OFFICE_SLUG}/problems/${publicId}/status`,
      { status: 'UNDER_REVIEW' },
    );
    record(
      'Citizen cannot act as government',
      denied.status === 403 ? 'PASS' : 'FAIL',
      `HTTP ${denied.status}`,
    );
  }
  if (
    has(
      'SMOKE_OTHER_OFFICIAL_EMAIL',
      'SMOKE_OTHER_OFFICIAL_PASSWORD',
      'SMOKE_OTHER_OFFICE_SLUG',
    )
  ) {
    const other = new Session('other office');
    await other.login(env.SMOKE_OTHER_OFFICIAL_EMAIL, env.SMOKE_OTHER_OFFICIAL_PASSWORD);
    const r = await other.call(
      'GET',
      `/government/${env.SMOKE_OTHER_OFFICE_SLUG}/problems/${publicId}`,
    );
    record(
      'Other jurisdiction cannot read the report',
      [403, 404].includes(r.status) ? 'PASS' : 'FAIL',
      `HTTP ${r.status}`,
    );
  } else {
    record(
      'Other jurisdiction cannot read the report',
      'NOT RUN',
      'SMOKE_OTHER_OFFICIAL_* not set',
    );
  }

  // 8. Government review and allocation.
  if (!has('SMOKE_OFFICIAL_EMAIL', 'SMOKE_OFFICIAL_PASSWORD', 'SMOKE_OFFICE_SLUG')) {
    record(
      'Government, allocation and resolution',
      'NOT RUN',
      'SMOKE_OFFICIAL_* / SMOKE_OFFICE_SLUG not set',
    );
    return finishCitizen(citizen);
  }
  const official = new Session('official');
  record(
    'Official login',
    (await official.login(env.SMOKE_OFFICIAL_EMAIL, env.SMOKE_OFFICIAL_PASSWORD))
      ? 'PASS'
      : 'FAIL',
  );
  const gov = `/government/${env.SMOKE_OFFICE_SLUG}`;
  const detail = await official.call('GET', `${gov}/problems/${publicId}`);
  record(
    'Report in the office jurisdiction',
    detail.status === 200 ? 'PASS' : 'FAIL',
    `HTTP ${detail.status} (location must be inside the office's jurisdiction)`,
  );
  if (detail.status !== 200) return finishCitizen(citizen);
  const review = await official.call('PATCH', `${gov}/problems/${publicId}/status`, {
    status: 'UNDER_REVIEW',
  });
  const verify = await official.call('PATCH', `${gov}/problems/${publicId}/status`, {
    status: 'VERIFIED',
    note: 'Smoke test verification.',
  });
  record(
    'Government review and verification',
    review.status === 200 && verify.status === 200 ? 'PASS' : 'FAIL',
    `HTTP ${review.status}/${verify.status}`,
  );

  if (!has('SMOKE_ORG_EMAIL', 'SMOKE_ORG_PASSWORD', 'SMOKE_ORG_SLUG', 'SMOKE_ORG_ID')) {
    record('Allocation and resolution', 'NOT RUN', 'SMOKE_ORG_* not set');
    return finishCitizen(citizen, official, gov);
  }
  const allocation = await official.call(
    'POST',
    `${gov}/problems/${publicId}/allocations`,
    { organizationId: env.SMOKE_ORG_ID, instructions: 'Smoke test allocation.' },
  );
  record(
    'Allocation created',
    allocation.status === 201 ? 'PASS' : 'FAIL',
    `HTTP ${allocation.status}`,
  );
  if (allocation.status !== 201) return finishCitizen(citizen, official, gov);
  const org = new Session('organisation');
  record(
    'Organisation login',
    (await org.login(env.SMOKE_ORG_EMAIL, env.SMOKE_ORG_PASSWORD)) ? 'PASS' : 'FAIL',
  );
  const accepted = await org.call(
    'POST',
    `/organizations/${env.SMOKE_ORG_SLUG}/allocations/${allocation.data.id}/accept`,
    {},
  );
  const roomId = accepted.data?.roomId;
  record(
    'Allocation accepted, room opened',
    accepted.status === 200 && roomId ? 'PASS' : 'FAIL',
    `HTTP ${accepted.status}`,
  );
  if (!roomId) return finishCitizen(citizen, official, gov);

  // 9. Resolution.
  const msg = await org.call('POST', `/resolution-rooms/${roomId}/messages`, {
    body: 'Smoke test: work scheduled.',
  });
  const outsider = await citizen.call('GET', `/resolution-rooms/${roomId}`);
  record(
    'Room collaboration (private to participants)',
    msg.status === 201 && [403, 404].includes(outsider.status) ? 'PASS' : 'FAIL',
    `post ${msg.status}, citizen ${outsider.status}`,
  );
  const project = (await org.call('GET', `/resolution-rooms/${roomId}/project`)).data;
  const projectId = project?.id ?? project?.project?.id;
  const activated = await org.call('POST', `/resolution-projects/${projectId}/status`, {
    status: 'ACTIVE',
  });
  const task = await org.call('POST', `/resolution-projects/${projectId}/tasks`, {
    title: 'Smoke test task',
  });
  // Tasks move TODO -> IN_PROGRESS -> COMPLETED (the state machine refuses a jump).
  const started = task.data?.id
    ? await org.call(
        'POST',
        `/resolution-projects/${projectId}/tasks/${task.data.id}/status`,
        { status: 'IN_PROGRESS' },
      )
    : { status: 0 };
  const done = task.data?.id
    ? await org.call(
        'POST',
        `/resolution-projects/${projectId}/tasks/${task.data.id}/status`,
        { status: 'COMPLETED' },
      )
    : { status: 0 };
  record(
    'Project and task',
    activated.status === 200 &&
      task.status === 201 &&
      started.status === 200 &&
      done.status === 200
      ? 'PASS'
      : 'FAIL',
    `${activated.status}/${task.status}/${started.status}/${done.status}${done.message ? ` ${done.message}` : ''}`,
  );
  const evidence = await org.call('POST', `/resolution-projects/${projectId}/evidence`, {
    evidenceType: 'AFTER_IMAGE',
    title: 'Smoke test evidence',
  });
  const file = evidence.data?.id
    ? await org.call(
        'POST',
        `/evidence/${evidence.data.id}/files`,
        form({ role: 'AFTER' }, { bytes: JPEG, type: 'image/jpeg', name: 'after.jpg' }),
        { multipart: true },
      )
    : { status: 0 };
  const submitted = evidence.data?.id
    ? await org.call('POST', `/evidence/${evidence.data.id}/submit`)
    : { status: 0 };
  record(
    'Evidence submitted',
    evidence.status === 201 && file.status === 201 && submitted.status === 200
      ? 'PASS'
      : 'FAIL',
    `${evidence.status}/${file.status}/${submitted.status}`,
  );
  // The evidence AI review runs asynchronously: requesting verification is
  // refused (409) until it has finished, so retry for up to a minute.
  let requested = { status: 0, message: null };
  for (let i = 0; i < 20; i++) {
    requested = await org.call(
      'POST',
      `/resolution-projects/${projectId}/verification/request`,
      { note: 'Smoke test: complete.' },
    );
    if (requested.status !== 409) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  const approved = await official.call(
    'POST',
    `${gov}/problems/${publicId}/verification/approve`,
    { note: 'Smoke test approval.' },
  );
  const final = await citizen.call('GET', `/problems/${publicId}`);
  record(
    'Human approval resolves the problem',
    requested.status === 200 &&
      approved.status === 200 &&
      final.data?.status === 'RESOLVED'
      ? 'PASS'
      : 'FAIL',
    `request ${requested.status}${requested.message ? ` (${requested.message})` : ''}, approve ${approved.status}${approved.message ? ` (${approved.message})` : ''}, status ${final.data?.status}`,
  );

  return finishCitizen(citizen, official, gov);
}

async function finishCitizen(citizen, official, gov) {
  const notes = await citizen.call('GET', '/notifications');
  const unread = await citizen.call('GET', '/notifications/unread-count');
  record(
    'Notifications',
    notes.status === 200 && unread.status === 200 ? 'PASS' : 'FAIL',
    `HTTP ${notes.status}/${unread.status}`,
  );
  if (official && gov) {
    const a = await official.call('GET', `${gov}/analytics/overview`);
    const c = await citizen.call('GET', `${gov}/analytics/overview`);
    record(
      'Analytics (authorised only)',
      a.status === 200 && c.status === 403 ? 'PASS' : 'FAIL',
      `official ${a.status}, citizen ${c.status}`,
    );
  } else {
    record('Analytics (authorised only)', 'NOT RUN', 'no official session');
  }
  const out = await citizen.call('POST', '/auth/logout');
  const after = await citizen.call('GET', '/auth/me');
  record(
    'Logout revokes the session',
    out.status === 204 && after.status === 401 ? 'PASS' : 'FAIL',
    `logout ${out.status}, me ${after.status}`,
  );
}

try {
  await main();
} catch (error) {
  record('Smoke run', 'FAIL', error instanceof Error ? error.message : String(error));
}
const counts = results.reduce(
  (m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }),
  {},
);
console.log(`\nSummary: ${JSON.stringify(counts)}`);
process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
