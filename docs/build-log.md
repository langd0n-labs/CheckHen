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
- 2026-10-03: Preserve existing test suites. If a change breaks a test, update
  it for the new design. Ask before deleting or replacing a suite. This rule
  is also in `OPS.md`.

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

## M1 — domain model and event log: complete

Implementation: `Course`, `RosterEntry`, `ParticipationEvent`, and course-scoped
sessions and templates are migrated. Existing sessions, users, profiles, and
participation rows are assigned to one Imported course; legacy rows remain as
an archive. Writes use an append-only event store. Student and instructor APIs,
analytics, and socket rooms use explicit course and session scope. Socket
tickets are signed, short-lived, and checked against the active roster at
connection. The interface provides course and session selection.

| Acceptance check | Result |
| --- | --- |
| Courses, rosters, class sessions, and append-only event log exist | PASS: clean and populated PostgreSQL migrations succeeded. The populated legacy fixture retained user profile fields and check-in, hand, pace, and chat records. Direct update, delete, and truncate attempts on the event log fail. Legacy tables reject new writes. |
| Two courses run in parallel without crossing data | PASS: `test-event-store.ts` writes to both courses concurrently and verifies distinct folded attendance, isolation of pace events, and rejection of cross-course session and undo references. A live Socket.IO check verifies room isolation and rejects a mismatched course/session ticket. |
| Undo and correction append new events; folded state is correct | PASS: `test-event-store.ts` records an original pace event, correction, undo, and undo of undo; reads after each operation match the expected state. The original event remains unchanged and 12 concurrent appends receive distinct order timestamps. |

Verification: the populated legacy migration passes `test-legacy-import.ts`.
M1 milestone results: TypeScript passes; Jest passes 8 suites and 49 tests. The live
socket test passes cross-course isolation, mismatched-ticket rejection, and
inactive-roster rejection. The final Podman production image builds, migration
`20261003000000_courses_and_events` applies to the retained database, all three
services run, and `/api/ping` and `/` return HTTP 200. `git diff --check` passes.
Live Google OAuth remains deferred until credentials are supplied.

Independent review: a Codex bulk session flagged socket roster validation and
the unused socket argument; both were fixed. It also claimed repeated trigger
names block migration. PostgreSQL scopes trigger names by table; both clean and
populated migrations applied successfully. The reviewer had no Node runtime.

Post-M1 test repair: the five deleted route suites were restored and updated
for the event-backed API.

| Requested check | Result |
| --- | --- |
| Every instructor route returns 403 for a non-instructor | PASS: the route contract suite exercises the real authorization path for all 14 instructor routes. |
| Chat rejects missing, empty, whitespace-only, and over-1000-character messages | PASS: the restored chat suite checks all four cases and confirms no event is appended. |
| Pace rejects a missing or invalid signal type | PASS: the restored pace suite checks absent, empty, and unknown types and confirms no event is appended. |
| Every route rejects the wrong HTTP method | PASS: the route contract suite checks an unsupported method on all 36 first-party API routes, excluding the framework-managed NextAuth handler. The sweep found that `/api/ping` accepted unsupported methods; it now returns 405. |
| Check-in and chat reject an ended session | PASS: the restored suites check both 400 responses and confirm no event is appended. |
| Instructor attendance reports per-student hand-raise counts | PASS: the restored attendance suite checks counts of two and zero for two different students. |

Final verification: 14 Jest suites and 121 tests pass, TypeScript and targeted
ESLint/Prettier pass, and
`git diff --check` passes. An independent Codex bulk review found no
implementation defect. It noted that the restored instructor suites mock a
scope denial; those tests also assert the instructor-only scope request, while
the route contract suite exercises the real non-instructor 403 path.

## M2 — laptop network profile, class mode

Not started. Portal binding, simulated uplink, 150-client latency, and physical
adapter checks are pending. No adapter has been validated for 150 stations.

## Resume

M0 is committed (`86eabe9`); M1 is committed (`e7fdfab`). The operator was
notified in the build session and Telegram alerts. The post-M1 test repair is
complete; pause before M2 for further operator guidance. Docker acceptance
remains deferred at the operator's request. Do not start M3.
