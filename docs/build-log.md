# Build log

Branch: build/m0-m2. Scope: M0, M1, M2 only.

## Operator decisions

- 2026-10-03: Use Podman for this build session. Defer Docker testing.
- 2026-10-03: A configurable test hostname may use fishjump.com, rfkill.dev,
  or rfkill.com. Test hostname: checkhen.rfkill.dev.
- Live Google OAuth testing is deferred until credentials are available.
  Automated checks use simulated identities. Use Let's Encrypt DNS-01 for TLS.
- 2026-10-03: Cloudflare hosts rfkill.dev. Use Certbot dns-cloudflare with a
  Zone:DNS:Edit token restricted to rfkill.dev, read from an ignored environment
  file as CLOUDFLARE_API_TOKEN.
- 2026-10-03: Default AP subnet is 172.16.77.0/24; AP address is 172.16.77.1.
  Make both configurable. Refuse startup when the AP subnet overlaps an existing
  host route. Do not use campus 10.x, container pools 172.17.0.0/16 through
  172.31.0.0/16, or the operator VPN subnet 172.16.100.0/24.
- 2026-10-03: Operator approved assigning all existing sessions to one Imported
  course, preserving the original records.
- Send decision requests to Telegram alerts as well as the build session.

## M0 — implementation verified; operator checks pending

| Acceptance check | Result |
| --- | --- |
| Clean clone starts with one documented command | PASS: python3 scripts/start.py builds both images, creates local secrets, replays all migrations on a new database, and starts three services |
| All existing tests pass | PASS: 10 Jest suites, 65 tests; TypeScript passes. Includes all 64 existing tests and the first-load socket regression |
| No tracked secrets; complete .env.example | PASS: no tracked .env secrets or private-key/token signatures found; root and application examples list referenced variables; image contexts exclude environment files |
| Application starts with Docker Compose on Linux | Docker deferred by operator. PASS on Linux with rootless Podman Compose: app and database healthy, socket running; /api/ping and / return HTTP 200 |
| macOS and Windows procedure | Waiting for operator: docs/operator-checks.md, M0 macOS/Windows procedure |
| Grafana decision and dashboard if retained | Remove Grafana: no application code consumes it; application analytics already exists |

Runtime: Linux, Podman 5.8.4, podman-compose 1.6.0, Node.js 22.
The documented down/up procedure passes against the retained database.
Podman Compose restart reports a dependency ordering error; use down/up.
Container stop currently requires the runtime's SIGKILL fallback after 10 seconds.
Independent checks: git diff --check passes; secret signature scan has no matches.

Additional baseline findings:
- Dockerfiles omitted the Yarn patch and misplaced the Prisma schema.
- Chart package major version did not match Mantine core.
- Admin socket effect already waits for user and class ID. Regression test confirms
  first-load connection without refresh. Missing disconnect cleanup is repaired.
- No get-clerk-info.ts remains in this checkout. Historical migration references
  to Clerk must stay for migration replay.
- Startup instrumentation sent the public IP to an external notification service.
  Removed that behavior to keep startup local.

Independent review: a separate Codex session found no clear M0 defect.
Its sandbox could not run Podman or find Node on PATH. The primary session ran
those checks successfully. No merge is performed in this task.

## M1 — domain model and event log

In progress. Work-in-progress commit; not complete. All three acceptance checks
pending.

State at the checkpoint (2026-10-03, session stopped at the usage limit):
- Schema: `Course`, `RosterEntry`, and `ParticipationEvent` added; `courseId`
  added to scoped models. Migration `20261003000000_courses_and_events` and
  `prisma/sql/event-guards.sql` written. Assignment of existing sessions to one
  Imported course is approved (see Operator decisions); confirm the migration
  implements it.
- New libraries: `lib/events.ts` (event types and fold), `lib/event-store.ts`
  (append and read), `lib/participation-api.ts` (one handler for the
  participation routes), `lib/request-scope.ts`, `lib/scoped-fetch.ts`.
- New routes: `api/courses.ts`, `api/sessions.ts`, `api/admin/events.ts`,
  `api/admin/roster.ts`.
- The participation API routes now delegate to `participationHandler(...)`.
- New tests: `__tests__/lib/events.test.ts`, `scripts/test-event-store.ts`.

Failures at the checkpoint:
- Jest: 5 suites failed, 33 of 71 tests failed. The failing suites are the
  existing route tests (check-in, send-chat, send-pace-signal, ack-hand-raise,
  fetch-check-ins). They mock the old per-route Prisma calls; update them to the
  event-store design.
- Typecheck: 7 errors. `lib/events.ts` iterates a Map without
  `downlevelIteration` or an ES2015+ target. `api/admin/class-templates.ts` and
  `scripts/seed-test-data.ts` create class templates and classes without the new
  required `course` relation.

## M2 — laptop network profile, class mode

Not started. Portal binding, simulated uplink, 150-client latency, and physical
adapter checks are pending. No adapter has been validated for 150 stations.

## Resume

M0 is committed (`86eabe9`). Continue M1 from the checkpoint above:
1. Fix the typecheck errors.
2. Update the failing route tests to the event-store design.
3. Confirm the Imported-course migration preserves every existing record.
4. Run the three M1 acceptance checks and record the results.
Then do M2. Docker acceptance remains deferred at the operator's request. Do
not start M3.
