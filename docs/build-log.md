# Build log

Branch: build/m0-m2. Scope: M0 through M5, then M7 and M8.

## Operator decisions

- 2026-10-05: Class on Thursday 2026-10-08 needs M0 to M4, M7, and M8. M3
  attendance is optional for that class; M5 exam mode is not needed. Order:
  fix M5 review finding 5, build M7, build M8, then the M5 fix backlog below.
  M6 follows. Relayed by AICP.
- 2026-10-05: Use the `frontend-design` skill while building the M7 and M8
  screens. Run `/impeccable audit` on them before each milestone report; fix
  only findings that affect use in class and list the rest as open items. Do
  not enable impeccable hooks. Relayed by AICP.
- 2026-10-05, operator, cold-call outcomes. These replace the brief's
  eligibility rule and AICP's relayed "call again" wording:
  - A student called earlier in the meeting stays callable at reduced weight
    (`called_today_damping`, default 0.2, to tune in practice), so being called
    does not take them off the hook.
  - Answered + follow-up records an Answered call and keeps the same student on
    screen for a deeper or variant question. Each question is its own event and
    counts toward participation; the run counts once for recency. Follow-ups
    offer Answered, Answered + follow-up, Pass, and Retry.
  - Skip (student briefly out of the room) is recorded and changes nothing.
  - Absent means the student left early: it counts as an absence and checks
    the student out. Excused absences come with M8.
  - Retry is the same question asked again later; the instructor records the
    outcome once it resolves.
  - No separate wrong-answer outcome: an attempt is Answered.
- 2026-10-06, operator (review item m3): a Pass on a follow-up question is
  recorded but is neither an opportunity nor pass debt. A follow-up is a
  stretch question: answering earns credit, passing costs nothing.
- 2026-10-06, operator: a Pass on a follow-up question stays free, including a
  follow-up Pass that resolves an outstanding Retry. A later fresh draw that
  resolves a follow-up Retry is an ordinary call: a Pass on it is an
  opportunity and pass debt. Relayed by AICP.
- 2026-10-06, operator: the student help page explains no participation or
  grading rules. It says only that the instructor may call on students in
  class and that no student screen shows anything about cold calls. Relayed
  by AICP.
- 2026-10-06, operator, help pages: describe exam mode's intended behavior and
  mark it "being finished; do not use in class yet"; write "a volunteer answer
  is an acknowledged raised hand" as the rule, to be reviewed in the UI; leave
  `/admin/analytics` out as legacy. The student grading section and the
  course-record section are on hold. Relayed by AICP.
- 2026-10-06, operator: undoing the first call of a follow-up run keeps the
  follow-ups, which stay counted and labeled "(follow-up)". The operator will
  watch whether the case occurs in class. Relayed by AICP.
- 2026-10-06, operator: a Retry student comes back by chance, at the retry
  weight, until user testing says otherwise. No call-back control.
- 2026-10-06, operator: the call screen (I3) is the instructor's private phone
  view and is not designed for projection; the brief projects only I5 and I6.
  A projected cold-call view, if one is ever built, shows who is called and
  never the outcome.
- 2026-10-03: Use Podman for this build session. Defer Docker testing.
- 2026-10-03: A configurable test hostname may use fishjump.com, rfkill.dev,
  or rfkill.com. Test hostname: checkhen.rfkill.dev.
- 2026-10-03: Google OAuth credentials are available in Bitwarden Secrets
  Manager project `fishjump` as `CHECKHEN_GOOGLE_CLIENT_ID` and
  `CHECKHEN_GOOGLE_CLIENT_SECRET`. Use `~/bin/agent-credential run --project
  fishjump -- COMMAND` for build and test commands. Never print credentials,
  pass them as command arguments, or write them to tracked files. The app reads
  its own ignored environment file. Use Let's Encrypt DNS-01 for TLS.
- The Google Web application client uses origin `https://checkhen.rfkill.dev`,
  callback `https://checkhen.rfkill.dev/api/auth/callback/google`, and scopes
  `openid`, `email`, and `profile`. Only `bu.edu` accounts may sign in. BU's
  Google flow redirects to BU single sign-on; capture the actual live redirect
  chain on x1 and allow exactly those domains before sign-in.
- 2026-10-03: Cloudflare hosts rfkill.dev. Use Certbot dns-cloudflare with the
  Zone:DNS:Edit token restricted to rfkill.dev. Its source is now Bitwarden
  Secrets Manager key `BUZZ_CLOUDFLARE_DNS_TOKEN`, accessed only through the
  credential runner; the earlier local-token-file instruction is superseded.
- 2026-10-03: Default AP subnet is 172.16.77.0/24; AP address is 172.16.77.1.
  Make both configurable. Refuse startup when the AP subnet overlaps an existing
  host route. Do not use campus 10.x, container pools 172.17.0.0/16 through
  172.31.0.0/16, or the operator VPN subnet 172.16.100.0/24.
- 2026-10-03: Operator approved assigning all existing sessions to one Imported
  course, preserving the original records.
- Send decision requests to Telegram alerts as well as the build session.
- 2026-10-03: Nimbus has no Wi-Fi radio. The operator runs checks requiring
  root, the USB adapter, or real clients on x1 using exact checkout and test
  commands supplied by the build agent. The build agent may use `ssh x1` for
  checks that do not require root. M2 targets one
  working adapter, a few real devices, and the simulated 150-client load test;
  record hardware coverage gaps. Stop and consult the operator before building
  around an incorrect brief requirement, unreasonable check, or simpler design.
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

Working draft for software and namespace testing; the operator
deferred the live USB-adapter and real-client check until the adapter arrives.
At the operator's request, Profile A packages the AP, DHCP, DNS, firewall
rules, and signed binding helper in one privileged,
host-network Podman service. Nginx is a separate host-network service in the
same Compose stack as the app, socket, and database. Rootful Podman Compose
starts and stops class mode; its preflight rejects an AP subnet overlapping an
existing host route before services start. The host needs Podman and a Compose
provider, not host installations of these daemons. The one-off namespace test
runs from the network image and starts Nginx there only to exercise the shared
proxy template with a simulated AP client. A namespace uses a signed test
identity; live Google-to-BU sign-in still needs a browser on x1.

| Acceptance check | Result |
| --- | --- |
| Captive portal signs a student in with Google and binds IP and MAC | DEFERRED LIVE CHECK: the Auth.js callback requires a verified `bu.edu` Workspace identity, and check-in calls a signed local helper that reads the DHCP lease, grants the IP/MAC pair, and appends the binding to the event log. Four OAuth-domain cases and four portal check-in cases pass; a fresh PostgreSQL migration and event-store integration test accept `DEVICE_BOUND`. The operator deferred the live x1 Google→BU redirect trace, real sign-in, and adapter/client check until the USB radio arrives. This acceptance check is not yet proven end to end. |
| Simulated clients sign in and use the uplink | PASS for simulated clients: on 2026-10-05, the operator ran `bash scripts/class-mode.sh namespace-test` on x1 (Fedora 44) at `d87b82f` in the rebuilt network image. Result: `PASS: dual-stack and IPv6-only SLAAC clients, unbound isolation, revoke, link flap, private blocks, and second class cycle`. The test uses signed test identities; live Google sign-in and USB adapter checks remain open. |
| 150 concurrent socket clients, median chat latency < 1 second | PASS on Nimbus, isolated disposable Podman database and socket service: 150 connected, 150 received, 0 failures, 16.8 ms median from event-write start to socket notification, 5.3 ms event write. The isolated stack and volume were removed after the run. This measures socket fanout after one direct event-log write; it does not simulate 150 simultaneous chat submissions. |

The default AP subnet is configurable and the start command checks every
existing IPv4 host route for overlap before starting services. The class-mode
script runs that check before starting the app. Unit tests cover an
overlapping route, a nonoverlapping VPN route, and reserved ranges. The live
x1 route check with a real AP interface is pending.
Final local draft checks: 15 Jest suites and 129 tests pass; TypeScript,
targeted ESLint and Prettier, Python compilation and route-guard tests, and
`git diff --check` pass. The production app image builds. Targeted ESLint
reports two expected `console` warnings in the load-test CLI and no errors.

x1 inventory without root: Fedora Linux 44; built-in Wi-Fi uplink is present;
Podman 5.8.7 with Compose, dnsmasq 2.92 with nftset support, nft, iw, ip,
and dhclient are installed. System hostapd and nginx are no longer required;
the USB AP adapter is not yet present. `sudo -n` requires an operator password. The Bitwarden
project and all three named keys were
checked for access without printing values. The x1 root namespace result is
recorded above; live USB hardware checks remain open.

The pushed draft commit `3354298` was cloned on x1. Before the container revision, a local Certbot venv was
installed, the ignored app `.env` received OAuth credentials through the
Bitwarden runner, and Certbot successfully issued a DNS-01 certificate for
`checkhen.rfkill.dev` (expiry 2027-01-02). No public A/AAAA record was needed;
the AP's dnsmasq resolves the hostname locally. The x1 Podman app build and
start passed: database healthy, app healthy, socket running, and the loopback
`/api/ping` returned HTTP 200 with `Pong!`. The certificate and ignored `.env`
exist, no temporary Cloudflare token file remains, the checkout has no
untracked environment file, and x1 currently has no route overlapping
172.16.77.0/24. The generated x1 dnsmasq configuration passes
`dnsmasq --test` without root. The live start guard still needs the root run
with an AP interface.

Container revision checks on Nimbus: the AP, proxy, and setup/Certbot images
build successfully. The AP image contains hostapd, dnsmasq, nftables,
NetworkManager and firewalld clients, plus test-only Nginx; the production
proxy has its own image and Compose service. Test-only Nginx preserves the
captive-redirect check in the isolated namespace test. The Compose laptop
profile parses successfully. The privileged AP service receives only AP,
pre-auth, binding, and URL settings; it does not receive the OAuth or database
secrets. One-off AP checks use a mode-600 temporary env file with the same
selected settings, then remove it. The proxy template passes `nginx -t` in an
isolated container network with a disposable certificate, and that proxy
returns HTTP 302 for an HTTP request. Host-network binding to the configured
AP address still needs x1. Four route-guard tests
pass both on Nimbus and inside the AP image, including a preflight rejection
of an overlapping host route. Python compilation, shell syntax, and
`git diff --check` pass. No host-script network runtime remains;
`scripts/start.py` is the older M0 app-only development entry point and is
not used by class mode. The setup commands run from a tools image. Rootful
Compose start/stop, network restoration with a real AP, and adapter path
are awaiting x1 checks.

On x1, `agent-credential run --project fishjump -- podman info` succeeds
without displaying credential values. This checks that the containerized
credential and certificate setup commands can launch Podman through the
required Bitwarden runner; those setup commands themselves have not been
rerun on x1 after the container revision.

The pushed container revision `499e99f` is checked out cleanly on x1.
The existing ignored certificate files are present. The laptop Compose
profile parses on x1 without displaying `.env` values, and the rootless
setup/Certbot image builds there. The proxy image also builds on x1 and
passes `nginx -t` with the existing real certificate mounted read-only in
an isolated container network. `iw dev` shows only the built-in managed
Wi-Fi interface; `lsusb` shows no external Wi-Fi adapter. After the namespace
run, x1 shows no test namespace, `chveth0`, or `172.16.77.1` address. The
earlier rootless app stack is stopped; the unrelated `langdon_distrobox`
container remains running.

Independent Claude personal review found one startup blocker: the AP service
healthcheck contacted loopback although the signed binding helper listens on
`AP_ADDRESS`. The healthcheck now uses `AP_ADDRESS`. The reviewer also flagged
unnecessary OAuth and database secrets in the privileged AP environment;
the environment was narrowed to AP and binding settings during review. No
other defect was reported. The rootful healthcheck still needs an x1 run.

Hardware coverage still open: one AP-capable USB radio, a few real client
devices, live Google/BU redirect hosts and locked pre-auth allowlist, restored
network state after stop, and any 150-station radio-association capacity. The
150-socket test does not establish that a single radio can host 150 stations.
Profile A adapter choice and tested USB ID will be recorded after the x1 run.

Read-only x1 radio inspection: the built-in Intel Wi-Fi interface uses the
`iwlwifi` driver with `iwlmvm`, advertises AP mode, and advertises concurrent managed+AP
interfaces only on one channel. Its current uplink is on 5 GHz channel 157.
[Linux Wireless documents 2.4 GHz AP support for iwlmvm devices](https://wireless.docs.kernel.org/en/latest/en/users/drivers/iwlwifi.html).
With the reported one-channel concurrency limit, that documented AP mode
would require changing the current 5 GHz uplink. Whether this specific
driver and firmware can keep the current uplink while serving an AP remains
untested. No radio mode or connection was changed.

Without the adapter, x1's default app-only Compose profile started the
database (healthy), app (healthy), and socket service. The loopback
`/api/ping` returned HTTP 200 with `Pong!`; the Google sign-in page route
returned HTTP 200, which does not prove a completed OAuth exchange. The
app-only stack was stopped, and no CheckHen containers remain running.
Podman Compose had to send SIGKILL to the app and socket containers after
their 10-second SIGTERM grace period; it removed the containers and network.
The `checkhen-m2_pgdata` database volume remains present.

Independent Codex bulk review found a database trigger that rejected the new
`DEVICE_BOUND` event. A forward migration now expands the trigger; all 17
migrations applied to a fresh PostgreSQL database, and the event-store
integration test appended the device event while preserving attendance and
event-log immutability. The reviewer also identified the
namespace test's manual DHCP address assignment; the test now requires DHCP to
configure the address and default route itself. The reviewer confirmed that
the load result is socket fanout coverage only, as stated in the table.
Native macOS AP networking with Internet Sharing and `pf` is outside scope;
no evidence establishes 150-client capacity for it. Windows Mobile Hotspot's
brief-stated 8-client limit makes it unsuitable for the target.

## M3 — attendance

Merged `origin/main` before M3. The only merge conflict was `.gitignore`;
both sets of ignore rules were retained. Check-in now requires the configured
portal agent and its control secret. The agent verifies that the proxy's client
address belongs to the AP subnet and has a live DHCP lease before a check-in
event is appended. An app-only deployment without the agent returns 503 for
check-in.

| Acceptance check | Result |
| --- | --- |
| Check-in from outside the AP subnet fails | PASS: unit tests show the agent rejecting addresses outside its subnet and the app mapping its 403 to a failed check-in. The 2026-10-05 x1 namespace test at `d87b82f` also rejected an outside-subnet bind request. Live USB adapter testing remains open. |
| A second device does not change attendance | PASS: the check-in route records `DEVICE_BOUND` rather than another `CHECK_IN`; the event fold retains one attendance record and its primary device. A second device's checkout revokes only that binding and appends no `CHECK_OUT`. |

Initial M3 verification: 16 Jest suites and 133 tests passed; TypeScript
typecheck and two Python agent tests passed. The M2 live AP and Google sign-in checks remain
deferred until the operator has the adapter.

## Resume

M0 is committed (`86eabe9`); M1 is committed (`e7fdfab`). The post-M1 test
repair is committed (`51b78b4`). M2 is a software and namespace working
draft with the live AP/Google/client acceptance check explicitly deferred
by the operator until the USB adapter arrives. When it does, use
`docs/operator-checks.md` and record each result here. Docker acceptance
remains deferred at the operator's request. M3 software checks are complete;
live AP validation remains pending with M2.

## M0–M2 independent review follow-up

The independent M0–M2 review report identified seven findings.
Finding 3 was fixed in the first M3 commit. Findings 1, 2, 4, and 5 are
addressed in this follow-up: the agent reconciles saved bindings with live
leases and nftables after restart; a new class discards old bindings; checkout,
session end and lease expiry revoke matching devices; brief AP station
departures keep their binding for reassociation. The AP isolates wireless
stations and blocks private IPv4 uplink destinations; student
chat responses omit the stable `userId`.

The route suites now include per-route 401 checks, no-active-check-in cases,
the missing-email case, attendance response fields and name derivation, and
instructor exclusion. The following old cases are represented by changed
behavior rather than restored verbatim:

| Old case | Reason |
| --- | --- |
| Missing class returned 500 | Scope selection now returns 404; check-in and shared scope tests cover this path. |
| Ended class returned 500 for chat or attendance | Chat and check-in now return 400; instructor attendance can read ended sessions. |
| Missing database user in the pace route returned 404 | `requireScope` now resolves the signed-in user before the participation handler. |
| Pace update deleted the previous row | Pace changes append events; deleting a recorded event violates the M1 log. |
| Attendance query excluded admin emails in SQL | Attendance is folded from events; a response-level instructor exclusion test replaces the removed query assertion. |
| Check-in name generator excluded null names | Folded attendance names are required strings; the null legacy fallback happens during migration. |

New tests cover signed agent requests, expiry, subnet and lease denial, changed
MAC, revoke scope, session revocation, and agent restart with a stale
`bindings.json`. Portal client tests cover header validation, fail-closed
configuration, timeout, and response mapping.

## M3 follow-up review and dual-stack AP

The agent retains bindings during AP station departures. Lease expiry removes
the matching nft entries and sends a signed checkout notification to the app,
retrying if the app is temporarily unavailable. IPv6-only bindings expire
after 12 hours or an explicit revoke. The app folds `DEVICE_BOUND` and
`DEVICE_UNBOUND`, so a primary device that obtains a new IP can check out.
Nft add and destroy operations are idempotent; failed prune operations do not
block later bindings. Check-in cleanup preserves the original append error.
Concurrent check-ins serialize inside the event-store transaction.

A scheduled app job revokes access and appends `CHECK_OUT` and `SESSION_ENDED`
when a class duration lapses. Revocation remains a prerequisite for checkout
and session-end writes, including in the app-only profile; when the agent is
unavailable, these writes retry rather than claiming access ended. The socket
server broadcasts notifications from persisted events and ignores client
broadcast requests.

The laptop AP config now advertises a ULA /64 by SLAAC, resolves the portal on
both families, authorizes IPv6 by MAC, and applies host, private-range, and
pre-binding uplink blocks to both families. IPv4 remains available without an
IPv6 uplink. The namespace script covers a dual-stack client, an IPv6-only
client, unbound traffic on both families, private destination blocks, agent
restart with a stale `bindings.json`, reassociation, revoke, and a second class
cycle. The root namespace test passed on x1 on 2026-10-05. The live AP and
Google sign-in checks remain pending.

The disposable PostgreSQL script passed against a local test server on
2026-10-04: event store, route-to-store attendance and concurrent check-ins,
legacy migration, session expiry, and socket isolation. The laptop Python
unit tests, Jest suite, and TypeScript typecheck passed locally.

## M3 second review fix pass

PREAUTH DNS lookup failures are handled separately for IPv4 and IPv6, so a
missing AAAA record does not stop class mode. The student heartbeat now uses
`/api/student/re-bind`; it cannot create a `CHECK_IN` after checkout, and the
page reports when the device has no uplink. The IPv6 forward rule requires
both an authorized MAC and a source in the AP ULA prefix. It also blocks the
mapped, NAT64, 6to4, and Teredo ranges. Class start sets `accept_ra=2` on the
uplink and every interface with an RA default route before setting
`all/forwarding=1`. It saves and restores the prior forwarding and RA values,
and adds the AP IPv6 address with `nodad` so
dnsmasq can bind immediately.

The agent requires two missing lease reads at least one second apart before
pruning an IPv4 binding. Restart reconciliation also retries a missing lease
before removing a saved binding. Duration expiry skips sessions older than seven days and
sessions with no check-in, continues after one session fails, and timestamps
checkout at the lapse time unless a later event requires a later timestamp.
`CHECK_IN` corrections now bypass repeat-check-in handling.

The namespace script restores the client's default route after a link flap.
It measures the IPv6 forward accept and block counters, adding and then
removing a narrow test route when the host has no IPv6 uplink. On such a host,
it also checks plain `curl` after removing that route. The root namespace
test has not run; the operator will run it on x1 after this commit.

Local verification on 2026-10-04: 25 laptop Python tests, 172 Jest tests,
TypeScript typecheck, and the disposable Postgres script passed. The Postgres
script covered six route-to-store integration cases, legacy import, and
socket isolation. On the build host, the agent-test default is
`CHECKHEN_TEST_PG_ADMIN_URL=postgresql://agent:agent@127.0.0.1:55432/postgres`.
It is a loopback-only disposable test server.

Departure checkout and its 30-second reassociation grace are M5 work. They
require station departure tracking and a delayed checkout decision; M3 keeps
the device binding through brief departures. Review finding 10, handoff of a
shared device to another student, is deferred to the M5 excuse flow because
clearing the first student's binding without a verified checkout would grant
access under the wrong identity. Review finding 11 is deferred: retry policy,
socket poll ordering, event log growth, admin correction scope, and the other
listed maintenance items do not block the M3 network and attendance checks.

## M4 — chat, moderation, projection

Chat moderation now appends `CHAT_HIDDEN` events that supersede the target
message and `STUDENT_MUTED` events scoped to the class session. The original
message remains in the immutable event log. A mute rejects later chat from
that student. Student responses expose anonymous names and an `isOwn` flag;
instructor responses include the real author; projection responses contain
only the message, anonymous name, ID, and timestamp.

The instructor dashboard can hide a message, mute its author, open an I5
projection window, and copy a short-lived projection ticket for I6. The
ticket is signed for one course and class and expires at class end or after
four hours. Both projection clients use the anonymous projection API and the
same socket notification channel. Socket polling runs every 200 ms; clients
also refresh every 500 ms. The Slidev component is a separate package in
`packages/slidev-chat`, imported by the sample deck in
`examples/slidev-chat`. Slidev's exact origin is configured through
`SLIDEV_ORIGIN` when the deck runs on another origin.

| M4 acceptance check | Result |
| --- | --- |
| Correct name rules in student, instructor, I5, and I6 views | PASS: chat-view unit tests check each payload; API and projection page tests check that room views reveal no student identity. |
| Hidden message leaves I5 and I6 within one second | PASS (unit and socket level): the hide event reached the projection socket in less than one second and the folded message list became empty. Projection page and Slidev feed tests use mocked fetch responses. A browser run remains open. |
| Sample Slidev deck imports I6 and shows live chat | PASS (unit and socket level): the sample imports the package, its production build succeeds with Slidev 53, and the feed unit test verifies socket refresh and anonymous output. A live deck run remains open. |

Verification on 2026-10-04: 21 Jest suites and 192 tests, seven
route-to-store Postgres integration tests, the event-store and legacy
migration scripts, socket isolation and moderation latency, the Slidev feed
unit test, TypeScript checks for the app and socket server, and the app and
sample deck production builds passed. M4 did not change the AP network layer. The
root x1 namespace test remains a prerequisite before M5.

The M4 review fixes restore kernel IPv6 forwarding through `all/forwarding`,
preserve RA acceptance on each interface with an RA default route, and save
and restore every forwarding value touched by that sysctl. The namespace
script checks `all/forwarding`, runs plain `curl` while its IPv4 client is
still bound, and names the link flap accurately. Instructor chat now retains
hidden messages with a visible flag and can unhide one through an `UNDO`
event. The Slidev feed test runs in `scripts/test-postgres.sh`. The x1 root
namespace check remains pending for the operator.

The first x1 namespace run at `bb9d65f` stopped while setting a client
`accept_ra` value: the image does not include `sysctl`. The test now writes
the value through `/proc` inside each namespace. The network image checks
every executable used by the namespace test and classroom layer during its
build. The namespace test still needs an operator rerun.

The next x1 run at `ddc5672` reached the IPv6 block check, where no packet
reached the forward chain. The host's narrow test route did not guarantee a
route inside either client namespace. The test now installs narrow client
routes to the public test target via the AP address when the host has no IPv6
uplink, plus a route for the private IPv6 block check. It removes them during
cleanup and prints client routes, addresses, curl errors, and forward counters
if an IPv6 counter check fails. The failed run did not capture client routes,
so its exact cause remains unconfirmed pending the operator rerun.

The x1 run at `5514d6e` showed that both clients had IPv6 routes, but the
unbound port-80 probe returned successfully with all IPv6 forward counters
unchanged. The firewall redirects port 80 to the local captive portal in
prerouting. Forward-chain probes now use port 8080; a separate unbound IPv6
port-80 check requires the portal redirect. The IPv4 private-address counter
probe also uses port 8080. The operator rerun remains pending.

The x1 run at `a57046d` passed the forwarding and agent restart checks, then
hit an `IndexError` when `ip -j -4 address` returned `[]` for the intentionally
IPv6-only second client. Address reads now treat an empty result as no
addresses. Required link and uplink-route reads report a clear error if
`ip -j` returns no entries. The operator namespace rerun remains pending.

On 2026-10-05, the operator reran `bash scripts/class-mode.sh namespace-test`
on x1 (Fedora 44) at commit `d87b82f` in the rebuilt network image. It
reported `PASS: dual-stack and IPv6-only SLAAC clients, unbound isolation,
revoke, link flap, private blocks, and second class cycle`. The live USB
adapter, real AP client, and Google sign-in checks remain open.

## M5 — exam mode: implementation verified; x1 namespace check pending

The instructor configures domains and a disconnect threshold before starting
an exam. The network agent resolves the domains into IPv4 and IPv6 nftables
sets, refreshes them every 30 seconds, and makes dnsmasq answer only the
allowlisted names. The exam gate runs before class-mode authorization and
preauth rules. Existing checked-in devices retain access to CheckHen; new
device binds are refused during the exam. Socket heartbeats and nl80211 station
polls provide independent connection evidence. The agent reports a fail after
both are absent longer than the configured threshold. A signed callback writes
the fail to the immutable event log. An instructor excuse supersedes the fail
with a reason; the original fail remains stored. Session end stops exam mode.

| M5 acceptance check | Result |
| --- | --- |
| Exam client reaches CheckHen and allowed domains; nonallowed IP, DoH, and Google range are blocked | Waiting for operator: run the extended x1 namespace test against this commit. Local isolated-container checks validated the generated IPv4 and IPv6 nftables policy syntax and verified dnsmasq gives NXDOMAIN for an unlisted name and resolves an allowed name. |
| 29-second drop does not fail; 31-second drop fails | Waiting for operator: the extended x1 namespace test checks both timings and receives the signed fail callback. Python unit tests cover the threshold, callback retry, and fail persistence after reconnection with controlled time. |
| Excuse clears fail in instructor view while fail remains in log | PASS: PostgreSQL route-to-store integration test reads the instructor status after an excuse and confirms the original `EXAM_FAILED` and superseding `EXAM_EXCUSED` rows both remain. |

Verification on 2026-10-05: 23 Jest suites and 208 tests, 40 Python unit
tests, TypeScript checks for app and socket server, a Next.js production build,
PostgreSQL event-store and legacy migrations, route-to-store integration,
and live socket isolation and signed heartbeat checks passed. The extended
namespace test is in
`network/laptop/test_namespace.py`; run `bash scripts/class-mode.sh namespace-test`
on x1 from the committed checkout. It includes the stale-bindings agent
restart from the M2/M3 check. The USB adapter and real-client checks remain
open as previously recorded.

The first local production build exited zero. A repeat after the final UI
change compiled and generated static pages, but its redirected log write hit
the sandbox's `/tmp` quota and the shell exited nonzero.

### M5 review: finding 5 fixed; fix backlog open

The independent review of `738ea01` rejected M5. Per the 2026-10-05 operator
decision, only finding 5 is fixed before M7 and M8:

- Students send `exam-heartbeat` only while their exam status shows an active
  exam. An ordinary class sends none.
- The socket server forwards at most one heartbeat per student per 4 seconds,
  across all of that student's sockets. The socket integration test sends a
  burst and checks that one request reaches the agent.
- Starting an exam now asks the instructor to confirm the allowlist and
  threshold. Without a started exam, the agent's `exam_gate` chains stay
  empty, so an ordinary class never passes through the exam gate.

Verification on 2026-10-05 (Nimbus): TypeScript checks for app and socket
server, 23 Jest suites and 208 tests, and `scripts/test-postgres.sh`
(event store, legacy migration, route integration, socket isolation with the
heartbeat burst check) passed.

M5 fix backlog, after M8. Branch `m5-fix-pass-wip` (`ee96c76`) holds an
unfinished, unreviewed pass over these items. Its Python unit tests pass;
nothing else on it has run.

1. Blocker: the 5-second station grace lets a 31-second drop pass, and the
   unit test asserts that wrong threshold. hostapd's 300-second default
   inactivity keeps a vanished station listed.
2. A timed-out exam start leaves the filter applied with no way to release it.
   Stop and session end should call `exam-stop` unconditionally.
3. An excused student cannot fail again in the same exam.
4. Allowlist addresses come from the laptop resolver and are replaced every
   30 seconds; CDN-hosted sites can fail. Use dnsmasq `nftset`.
6. Closed with the M7 review fixes: the generic `admin/events` endpoint
   refuses `EXAM_*` and `COLD_CALL` events and any supersession chain that
   reaches one.
7. A failed `iw` call counts every device as disconnected.
8. A heartbeat is accepted without proof that it came through the AP (M6
   topology).
9. The signature does not cover the agent action.
10. An exam with an unreportable fail cannot be stopped.
11. Fails disappear from the instructor view after the exam ends.
12. `docs/network-filtering.md` describes the old Pi and iptables design.

Test gaps from the `7e3b844` review: closed on 2026-10-06.
- `__tests__/pages/admin-dashboard.test.tsx`: declining the exam-start
  confirmation sends nothing; accepting sends the start with the allowlist.
- `__tests__/pages/student-heartbeat.test.tsx`: a checked-in student in an
  ordinary class emits no exam heartbeat over 30 s of simulated time, then
  starts once exam status turns active. It fails if the exam gate is removed.
- `scripts/test-socket-isolation.ts`: two sockets of one student forward one
  heartbeat per interval between them.
- `test_exam.py` and `test_agent.py`: with no exam running, the monitor and
  a heartbeat run no nft, DNS, or callback work and create no exam state.

Test gaps from the `738ea01` review: the station-list path, the start-timeout path,
re-fail after excuse, `EXAM_*` through `admin/events`, `iw` failure,
post-stop cleanup reachability, and heartbeat load against the agent.

## M7 — cold calling: implemented; independent review pending

`lib/cold-call.ts` holds the sampler, eligibility, and grade as pure functions.
`/admin/call` is the in-class screen (I3): "Call on someone" draws a student and
shows photo, preferred name, pronunciation, and pronouns; one tap records
Answered, Pass, Retry, or Absent. Answered is the largest control. Each outcome
is a `COLD_CALL` event with the draw's seed. Undo writes an `UNDO` event and has
no time limit; every call of the session is listed with its own undo. Course
settings live in `Course.config`; missing keys use the brief's defaults.

Interpretations where the brief is silent:

- A volunteer answer is an acknowledged raised hand (`HAND_ACKNOWLEDGED`).
  "The student volunteered" means a hand was acknowledged in this meeting.
- `passes_outstanding` counts passes since the student's last Answered call.
- An Absent outcome makes the student ineligible until they check in again.
  It does not count as being called for recency or retry. (Superseded by the
  operator's outcome decisions above: Absent also checks the student out.)
- `sessions_since_called` counts the meetings between the last call and this
  one: a student called in meeting 1 and sampled in meeting 3 has 1. A student
  never called counts as called before meeting 1, so all earlier meetings
  count. The brief fixes only the unit ("class meetings, not records"); the
  first M7 commit counted the call's own meeting, which treated the two cases
  differently.
- A meeting is a class session of the course that has started.
- Projected answers use cold-call answers only; volunteer answers are capped by
  `A`, which depends on the projection. With `term_meetings` unset, the
  projection uses the meetings held so far.
- A score with no opportunities is empty, or 1 when counted volunteer answers
  exist.
- Each draw is a `COLD_CALL_DRAWN` event with its seed; it has no grade
  effect. The draw returns a signed token (session, student, seed, 30-minute
  lifetime); recording requires it and requires that it be the session's latest
  draw, so a newer draw on any phone replaces earlier ones.

| M7 acceptance check | Result |
| --- | --- |
| Seeded replay gives identical selections; input order does not change the result; weights match the formula for each factor | PASS: `__tests__/lib/cold-call.test.ts` replays 50 draws per seed, compares 200 seeds across reversed input, checks each factor, the product, the minimum and non-finite weights, and a 20,000-draw proportion. |
| `A`, volunteer cap, and score match hand-computed examples, including the bounds of `A` | PASS: a four-student, four-meeting class computed by hand (A = 3, cap = 2), clamping to `A_max` and `A_min`, before the first meeting, and a capped volunteer case. |
| I3 completes Call → Answered in two taps | PASS: `__tests__/pages/cold-call.test.tsx` taps "Call on someone" then "Answered", checks exactly two requests and no dialog. The PostgreSQL route test draws, records, refuses a second draw for an answered student, undoes, and draws again. |

Verification on 2026-10-05 (Nimbus): TypeScript, ESLint on the new files,
25 Jest suites and 227 tests, and `scripts/test-postgres.sh` (10 route
integration cases, including the cold-call case; migration with the new
`COLD_CALL` kind), and a Next.js production build.

`/impeccable audit` of `/admin/call`: the detector reported no findings. Fixed
for class use: low-contrast Retry and Answered buttons, a Dashboard link and an
Undo button under 44 px, and a fixed dark-gray pronunciation that failed in dark
mode. Open: no `PRODUCT.md` or `DESIGN.md`; sizes are fixed pixels instead of
theme tokens; the screen has not been checked on a physical phone; the I3 PWA
manifest and the other I3 features (attendance, hands, pace, moderation, exam
control) remain on the dashboard.

### M7 review fixes

The independent review of `835180f` found four defects; all are fixed. Its
blocker, no runtime grade view or export, is M8 scope.

- Recording requires the signed draw token. Inside the session lock it refuses
  a second record of the same draw and a student who is no longer eligible
  (checked out, absent, or already called without a retry), so a double tap or
  a second phone records once.
- `sessions_since_called` counts intervening meetings (see the interpretations
  above).
- `admin/events` refuses `COLD_CALL` and `EXAM_*` events and any `UNDO` or
  correction whose supersession chain reaches one.
- `appendEvent` takes a guard that runs inside the session lock. Undo uses it,
  so two phones cannot both undo one call.

Verification on 2026-10-05 (Nimbus): TypeScript, ESLint on the new code,
26 Jest suites and 238 tests, `scripts/test-postgres.sh` (15 route
integration cases: forged, missing, and stale draw tokens; a double tap; two
phones; concurrent undo; empty and one-student rosters), and a Next.js
production build.

### M7 second review: superseded draws

The review of `267d5a1` found that an earlier draw's token stayed valid after
a newer draw. Each draw is now a `COLD_CALL_DRAWN` event (migration
`20261006010000_cold_call_draw`); inside the session lock, a record must match
the latest draw's seed and student. Repeated calls on one student (the
review's decision B) and the Absent and Skip outcomes are waiting for the
operator's definitions.

Verification on 2026-10-05 (Nimbus): TypeScript, 26 Jest suites and 239 tests,
and `scripts/test-postgres.sh` with 18 route integration cases (adds: earlier
token after a newer draw, expired token, token for another session, and Absent
then Undo making the student callable again).

### Operator cold-call outcomes: follow-up, skip, absent check-out

Implements the operator's 2026-10-05 outcome decisions (see Operator
decisions). Changes:

- Eligibility no longer removes a student called earlier in the meeting. The
  weight takes `called_today_damping` (0.2) unless a retry is outstanding,
  which takes the retry multiplier instead.
- "Answered + follow-up" returns a signed follow-up token. A follow-up record
  must name the session's latest call, with no newer draw, checked inside the
  session lock. Its event carries `followUpOf`.
- Skip is a `COLD_CALL` with outcome `skip`; eligibility and grades ignore it.
- Absent appends a `CHECK_OUT` linked to the call (`coldCallId`). Undoing the
  Absent call also undoes that check-out, so a mistaken Absent does not leave
  the student checked out. A student marked absent becomes callable again when
  they check in.
- The call screen adds "Skip (out of the room)" for a fresh draw and "Done with
  follow-ups" during a run, apart from the outcome buttons; Absent and Skip are
  hidden during follow-ups.

Verification on 2026-10-05 (Nimbus): TypeScript, ESLint on the changed files,
26 Jest suites and 244 tests, `scripts/test-postgres.sh` with 21 route
integration cases (adds: repeated Answered calls on one student, Absent
check-out and its undo, re-check-in after Absent, Skip, follow-up double tap,
follow-up outcomes, and a follow-up after a newer draw), the impeccable
detector on `/admin/call` (no findings), and a Next.js production build.

### M7 reviews of e66fe5e and 3896c62

Both reviews approve for Thursday after these fixes, which are done:

- Blocker B1 (3896c62): the call list and the follow-up check read a filtered
  set of event kinds, and `effectiveEvents` throws when an `UNDO` targets an
  event outside the set. Undoing an Absent (its linked `CHECK_OUT`) or
  unhiding a chat message then broke the call list and every follow-up for
  the meeting. Both now read every event in the session.
- The call screen clears the student card when a record or Skip is refused
  (400 or 409), so a stale card on a second phone cannot block calling. A
  failed call-list request shows a notice.
- The follow-up indicator is a high-contrast badge with the follow-up count
  ("Follow-up 2"). (The call screen is not designed for projection; see the
  2026-10-06 operator decision.)

Verification on 2026-10-06 (Nimbus): 26 Jest suites and 249 tests, and
`scripts/test-postgres.sh` with 22 route integration cases. The new B1 case
fails with the old filtered query and passes with the fix.

Open after M8, from these reviews, in this order:

1. (Dropped by operator decision 2026-10-06: Retry call-back. A Retry student
   returns by chance at the retry weight.)
2. Done (m1): `appendEvent` takes a `then` callback whose events are written
   in the same transaction. An Absent call and its check-out, and the undo of
   both, each commit or fail as one step; the linked check-out lookup is
   ordered and limited to the recording instructor's check-outs. Verified by
   28 Jest suites and 260 tests and 26 route integration cases (adds: a failing
   follow-on writes nothing; Absent and its undo each as one step).
3. Done (3896c62 review m2, m4, m5 and test gaps):
   - m2: the generic `admin/events` endpoint refuses a `CHECK_OUT` that carries
     a `coldCallId`, and any supersession chain that reaches one, so an Absent's
     check-out can be neither forged nor undone outside the call screen.
   - m4: undoing the first call of a follow-up run keeps the follow-ups, which
     were real questions; they stay counted and are labeled "(follow-up)" in
     the call list.
   - m5: every Answered returns a follow-up token, so after a plain Answered
     the result line offers "Ask a follow-up". During a run the screen shows
     the outcome just recorded with an Undo.
   - An Absent is recorded even if the student already checked out; other
     outcomes still need the student present.
   - Tests added: undoing the first call of a run (list and grades), Absent
     after check-out, a follow-up racing a draw, the generic endpoint refusing
     a linked check-out, and the call-screen follow-up and undo paths.
     Verified by 28 Jest suites and 262 tests and 29 route integration cases.
4. Done (e66fe5e review items 3 to 5): a token for a session with no draw
   event is refused with "This draw is no longer valid. Call on someone
   again."; the two-phone test is renamed and checks the newer-draw message,
   and the double-tap test checks the "already recorded" message; a new test
   runs a draw and a record at the same time. Verified by 28 Jest suites and
   271 tests and 32 route integration cases.

Review item m3 is decided (see Operator decisions, 2026-10-06): a Pass on a
follow-up neither lowers the score nor adds pass debt. Implemented; verified
by 28 Jest suites and 260 tests and 24 route integration cases.

## M8 — analytics and scoring: implemented; independent review pending

`/admin/course` is the course record (I4), opened from the dashboard's "Course
record" button for the selected course. It shows the provisional target `A`
(never editable), meetings held, and four tabs:

- Students: sessions attended, answers, passes, absences (with excused
  absences), volunteer answers (with the cap that counts), opportunities,
  score, and exam fails (with excused fails).
- Sessions: per meeting, checked in, cold calls, answers, volunteer answers,
  absences, and exam fails.
- Absences: every Absent call, with an Excuse control that takes a reason.
- Settings: every grade and sampler setting, with its default. Meetings in the
  term may be left empty to project from the meetings held.

`lib/course-report.ts` computes the record from the event log with `grades()`;
it reads only named kinds, so `COLD_CALL_DRAWN` and skips have no effect.
`/api/admin/course-report` serves the record, two CSV exports (students and
sessions), settings changes, and excuses.

Excused absences: `COLD_CALL_EXCUSED` (migration
`20261006020000_cold_call_excused`) supersedes the student's Absent call with
a reason. The Absent call stays in the log; while excused it is not an
opportunity. An excused absence cannot be undone from the call screen. The
check-out the Absent wrote stays, since the student did leave.

Interpretations:

- The record covers students active on the roster. Inactive students are not
  graded or exported.
- Each CSV row carries every setting in force (`config_*` columns) and the
  export time, so a file stays self-describing when rows are copied out. Text
  that a spreadsheet would run as a formula is prefixed with `'`.
- The student export lists the components the brief names (answers, passes,
  absences, opportunities, `A` in force) with the score, never the score alone.
- Settings are saved only when every value is valid; the lowest `A` may not
  exceed the highest.

| M8 acceptance check | Result |
| --- | --- |
| Attendance, participation, and exam events per student and per session | PASS: `__tests__/lib/course-report.test.ts` checks a hand-built two-meeting course (attendance, answers, passes, excused and unexcused absences, volunteers, exam fails and excused fails, per-session totals). The PostgreSQL route test checks the record before and after an excuse. `__tests__/pages/course-record.test.tsx` checks the student table. |
| CSV export with the configuration stamp | PASS: unit tests check every `config_*` column on every student and session row, the component columns, and CSV quoting and formula neutralizing. The route test saves settings, downloads both CSVs, and checks the stamped values on each row. |

Verification on 2026-10-06 (Nimbus): TypeScript, ESLint on the new files,
28 Jest suites and 259 tests, `scripts/test-postgres.sh` with 24 route
integration cases (adds: excuse flow with refusals, settings validation, and
both CSV exports), and a Next.js production build.

`/impeccable audit` of `/admin/course` and `/admin/call`: the detector reported
no findings. Fixed: the course record showed a blank page while loading, and an
empty score was an unlabeled dash. Open: settings fields revert silently when
cleared (other than meetings in the term); fixed pixel widths in the absences
list; no `PRODUCT.md` or `DESIGN.md`; not checked in a browser on a phone.

### M8 review (f513b5e): major fixes

- M1: an excuse can be undone. The Absences tab has "Undo excuse"; the route
  writes an `UNDO` on the excuse, so the Absent call is in force again and
  counts. Excuse and undo checks now ask whether an event is in force
  (`isEffective`), not whether anything ever superseded it, so an absence whose
  excuse was undone can be excused again.
- M2: exam fails are counted from every exam in a meeting. The attendance fold
  keeps only the latest exam's fails, so the course record now reads
  `EXAM_FAILED` and `EXAM_EXCUSED` from the log directly.

Verified on 2026-10-06 (Nimbus): 28 Jest suites and 264 tests, and
`scripts/test-postgres.sh` with 30 route integration cases (adds: excuse, undo
excuse, refused second undo, and a new excuse).

### M8 review (f513b5e): course record minor fixes

- Session totals include excused absences: "Questions asked" counts every
  recorded question (follow-ups included, skips not), and an excused Absent
  call counts as a question and in a new Excused column. The Sessions tab
  says that a follow-up Pass is a question but not an opportunity. The
  sessions CSV renames `cold_calls` to `questions_asked` and adds
  `excused_absences`.
- The whole record, including the absences list and session totals, covers
  only students active on the roster.
- Settings: a body is merged into the current settings, so omitted keys keep
  their values. Each refusal names the problem, including A of 0 or a
  fraction, a ratio of 0, a grade share above 1, and the lowest A above the
  highest. A cleared field stays empty, shows the default, and blocks saving.
- Both CSVs begin with a UTF-8 byte-order mark for Excel.
- A failed load shows "Try again"; a save that cannot reach the server shows
  a notice. Each Excuse and Undo-excuse button names the student and date.
  The empty score has visually hidden text for screen readers.

Review m6 and m9 are fixed (see "f513b5e m6" below; the absences list now
sizes its date, name, and reason with flexible widths instead of fixed pixels).

Verified on 2026-10-06 (Nimbus): 28 Jest suites and 269 tests, and
`scripts/test-postgres.sh` with 30 route integration cases.

### M8 review (f513b5e): call screen and wording

- The call screen clears the card only when a record is refused (400 or 409).
  After a server error, or when the server cannot be reached, the card stays
  for another tap and a notice explains. Draw and undo also show a notice when
  the server cannot be reached.
- Call-screen notices appear at the top center, so they do not cover "Call on
  someone" on a phone.
- The build log no longer describes the follow-up badge as readable on a
  projector, in line with the 2026-10-06 decision on I3.

Verified on 2026-10-06 (Nimbus): 28 Jest suites and 271 tests, a Next.js
production build, and the impeccable detector on `/admin/call` and
`/admin/course` (no findings).

### Course record review (b658301, 1e6b7bd) fixes

- F1 (major, my error in 1e6b7bd): the "Excused" header went into the Students
  table and its cell into the Sessions table, so both tables showed values
  under the wrong headers. The header is now in the Sessions table. A page
  test maps every header to the cell under it in both tables; it fails on the
  old layout.
- F2: the Sessions note names all three questions that are not opportunities:
  a Pass on a follow-up, a Retry, and an excused absence.
- F3: settings keys are checked with `Object.hasOwn`, so names such as
  `toString` or `__proto__` are refused.
- F4: saved settings are checked when read (`courseConfig`). Settings saved
  before validation that break the grade fall back to the defaults, and the
  course record shows the problem.

Verified on 2026-10-06 (Nimbus): 28 Jest suites and 274 tests, and
`scripts/test-postgres.sh` with 33 route integration cases.

### Cold-call review (1642e6f to a1e6099) minor fixes

- m-2: an Absent keeps every eligibility check except presence. It is
  refused after the session ends and for a student no longer active on the
  roster. Any record or follow-up after the session ends is refused.
- m-1: an Undo during a follow-up run steps back to the previous question
  with the same student, instead of ending the run. To allow this, a draw or
  follow-up is "used" only while its call is in force: after an undo, the
  corrected outcome can be recorded with the same token.
- Nits: `appendEvent`'s follow-on option is renamed `alsoWrite` (a property
  named `then` made the input a thenable), and a follow-on that carries its
  own guard or follow-ons is refused.
- Tests added: injected database failures inside the route's Absent and undo
  transactions write nothing; Absent after session end and for an inactive
  student; re-recording after an undo with a draw token and a follow-up
  token; the "(follow-up)" label; undo inside a run.

Verified on 2026-10-06 (Nimbus): 28 Jest suites and 276 tests, and
`scripts/test-postgres.sh` with 37 route integration cases. One full Jest run
of 12 had one failing test; the 98ebb6d-55a18cf review traced it to a page
test that clicked a button while it was still disabled (fixed below).

### f513b5e m6: a follow-up Retry stays a follow-up

The call that resolves a Retry on a follow-up question is a fresh draw, but it
asks the same stretch question, so a Pass on it costs nothing. A Pass on a
follow-up is now recorded as a free call: it counts as being called (recency)
and resolves an outstanding Retry, but is neither an opportunity nor pass
debt. Before this, an excluded follow-up Pass could leave a Retry outstanding
indefinitely. Verified: 28 Jest suites and 277 tests; 37 route integration
cases.

### Review of 98ebb6d to 55a18cf: minor fixes

- Flaky test: call-screen tests clicked outcome buttons that can still be
  disabled while a request runs. Every button click in those tests now waits
  until the button is enabled. Three consecutive full runs passed.
- An excused Absent keeps its draw token used: only an undo frees a draw.
- An Undo on the result line after an outcome ended a follow-up run (Pass,
  Retry, or plain Answered) steps back into the run, like the in-run Undo.
- Only an Absent is refused after the session ends; follow-ups are accepted
  again, as before 128ade3.
- Invalid saved settings: only the settings at fault take their defaults; the
  others keep their saved values. The call screen shows a notice between
  calls, and the course record's notice says saving replaces them.

Decided on 2026-10-06 (see Operator decisions): the Pass on a later fresh draw
that resolves a follow-up Retry counts as an ordinary Pass. The rule 556690a
added for it is removed; the free follow-up Pass that resolves a Retry stays.
The case of an Absent between the Retry and that Pass no longer applies.

Verified on 2026-10-06 (Nimbus): 29 Jest suites and 281 tests in three
consecutive runs, and `scripts/test-postgres.sh` with 39 route integration
cases.

## UI readiness for operator testing (item 5)

Method: the production build ran on a local port with a test-only auth secret
and signed test sessions. Every API call was stubbed with fixtures, and the
local Playwright image rendered each page at 375x667, 390x844, and 1280x800,
including the call screen's drawn and follow-up states. The check measured
whether Answered stays above the fold and whether any page scrolls
sideways. The harness is a scratch tool and is not committed.

Fixed for use in class:

- Call screen at 375x667: the Pass, Retry, and Absent labels were truncated
  ("Retr", "Abse"), and Answered sat below the fold (bottom at 703 px drawn,
  799 px in a follow-up run). Outcome buttons now use 18 px labels in a
  56 px row. The photo and name scale with screen height, smaller during a
  run. The run badge and "Recorded" line share one row. Answered now ends at
  655 px (drawn) and 658 px (run) on a 667 px screen.
- Student page on phones: the header wrapped over the content, and the
  two-column layout clipped "Raise Hand". Phones now get a one-row header
  (Profile and Sign out as labeled icon buttons, the anonymous name never
  truncated), with Raise Hand and the two pace buttons above the chat.
- Profile on narrow phones: the pronoun choices stack vertically, so "Other"
  is no longer cut off.
- Course picker: the "New course" field is a styled input, and the selects
  span the width on phones.

The impeccable detector over all 20 page and component files found two
cosmetic "side-tab" left borders, in `/admin/analytics` and `/join`. Neither
affects use in class; both are left open.

### Help pages

Three help pages, one per audience, using the operator's 2026-10-06 answers
on the outline:

- `/help/student`: checking in and out, chat, hands and pace, the profile
  and who sees it, and exam mode. Linked from the student page (Help), `/join`
  (checking in), and `/profile` (who sees your profile).
- `/help/instructor`: the dashboard, cold calling (every outcome, follow-up
  runs, Undo, who gets drawn, two phones), and exam mode. Linked from the
  dashboard (Help, and "How exam mode works") and the call screen (Help).
- `/help/projection`: the projection window and the Slidev chat component.
  Linked from the dashboard's projection controls; the room-facing views do
  not link to it.

Both exam sections describe the intended behavior and say "being finished; do
not use in class yet". The volunteer rule is written as an acknowledged
raised hand. The student page has a "Being called on" section
with no grading rules (operator decision). On hold: the instructor
course-record section, pending the grading-scope decision. `/admin/analytics` is left
out as legacy. Each page has a section list and anchors; the help pages hide
the course picker. Rendered at 375x667 and 1280x800 with no sideways scroll.
Verified: 30 Jest suites and 285 tests.

## M5 fix backlog

Started 2026-10-06 on AICP's instruction, one fix per commit, porting from the
parked branch `m5-fix-pass-wip`.

### Fix 1: disconnect detection (M5 review findings 1, 5, 7)

- Finding 1 (blocker): the 5-second grace after a station was seen is gone, so
  a 31-second drop fails and a 29-second drop does not. The test that asserted
  the old, wrong threshold is replaced by one that checks 29 and 31 seconds
  from the last evidence.
- A listed station counts only from its last activity: `iw station dump`'s
  "inactive time". A device that vanished but is still listed is not
  connected. hostapd polls idle stations after 10 s (`ap_max_inactivity`,
  default 300), so a departed device leaves the list and a present one's
  activity stays recent.
- Finding 5 (rest): the agent's monitor runs in its own thread every 0.5 s,
  off the request path. Requests and the monitor share a lock; fail and
  checkout callbacks run outside it. Heartbeats are kept in memory and folded
  into the exam state by the monitor, so a heartbeat costs no file write. The
  request backlog is 128.
- Finding 7: when `iw` fails, station data is "unavailable" and no new fail
  is recorded until it returns; the drop still fails afterward if it lasted.

Verified: Python unit tests (45). The station-list path needs the live USB
adapter check on x1; the namespace test still covers the heartbeat path at
29 and 31 seconds.

### Fix 2: the allowlist follows the answers clients receive (finding 4)

- dnsmasq's catch-all `nftset=/#/...` adds every answer it gives to the
  `exam4`/`exam6` sets. During an exam only allowlisted names reach an
  upstream resolver, so the sets hold exactly the addresses clients were given,
  and entries are added, never replaced. A CDN that rotates answers no longer
  breaks an open connection.
- Exam start no longer resolves domains. It writes the DNS filter, waits 1 s
  for dnsmasq to apply it, then flushes the sets and turns on the gate in one
  nft transaction. A start therefore takes about a second, well inside the
  app's 5-second limit (part of finding 2).
- dnsmasq gives a name only its most specific `nftset`, so an allowlisted name
  under a preauth (sign-in) domain reaches only the preauth set. The agent
  seeds those names every 30 s by asking the AP's own dnsmasq, and adds the
  answers to the exam sets.
- Outside an exam the agent flushes the exam sets every 60 s, so the
  catch-all cannot grow them without bound.
- Verified earlier on Nimbus in the network image: dnsmasq 2.92 accepts the
  catch-all line, puts ordinary answers in the exam set and sign-in answers
  only in the preauth set, and the seeding client parses real answers,
  including CNAME chains.
- The namespace test now checks that the exam client's answer appears in
  `exam4`, and that a real domain off the allowlist does not resolve during the
  exam. After exam-stop it checks that the DNS filter is empty, that the domain
  resolves, and that an address off the allowlist is reachable (review test
  gap).

Verified: Python unit tests (50). Operator check: rerun the namespace test on x1.

### Fix 3: a fail per drop, kept after the exam (findings 3 and 11)

- Finding 3: each disconnection gets its own fail ID. After a reported drop
  ends, the agent re-arms, so a student excused once can fail again on a later
  drop. The callback carries the fail ID and is refused without one; a
  retried report of the same drop is stored once, checked inside the
  serialized append.
- Finding 11: the fold keeps every fail, keyed by its event, with its exam.
  Starting a new exam no longer clears earlier fails. The dashboard shows
  each student's open and excused fails in the current exam, and lists fails
  from ended or earlier exams with an Excuse control. An excuse records the
  fail's own exam.
- The instructor help's exam section says each disconnection is its own fail
  and that fails stay excusable after the exam.

Verified: Python unit tests (53); 30 Jest suites and 288 tests;
`scripts/test-postgres.sh` with 40 route integration cases (adds: the same
drop reported twice is stored once; a later drop after an excuse is a second
fail; fails stay after the exam ends).

### Review of b933f3a to 8e5f57c: fixes

- Phone layout (F5): the UI check now also renders 375x553, Safari's visible
  height on a small iPhone with toolbars. The call screen's spacing, photo,
  and pronunciation scale with dynamic viewport height, the outcome rows are
  52 px, and pronouns are hidden during a follow-up run. Answered ends at
  545 px on a 553 px screen, drawn and in a run (657 px on 667, 832 px on 844).
- Student page (F3, F4): on phones the header shows the logo, not the word
  "CheckHen", and the logo no longer shrinks. The course picker is no longer
  shown above the student page, so the chat input stays on screen.
- Call screen (F1, F6): the result-line and earlier-call Undo buttons are
  disabled while a request runs and hold the screen busy until the undo
  returns, so Call on someone cannot race them. The Help link opens in a new
  tab, keeping the current card.
- Settings (F2): saved values that the reader replaces silently (negative,
  not a number, or the lowest A above the highest) are reported in the
  settings notice.
- Help pages: closing or reloading the class page checks the student out;
  some phones do not report it; and leaving from a second device ends only
  that device's access. The older phone clears its card on its next tap. Undo
  has no time limit, but recording a corrected outcome on the same card works
  for 30 minutes after the draw. Projection access lasts until the scheduled
  end, and End Class does not close it.
- F13: `/help/instructor` requires an instructor sign-in, checked on the
  server. Signed-out visitors go to sign-in; signed-in students get "not
  found".

Waiting on the operator: F9, the Absent bullet on `/help/student`, stays as
written until the operator sees it in the demo.

Verified on 2026-10-07 (Nimbus): 30 Jest suites and 292 tests (twice),
`scripts/test-postgres.sh` with 40 route integration cases, and the browser
check at 375x553, 375x667, 390x844, and 1280x800 with no sideways scroll.

## Issue #1: hosted mode (operator decision 2026-10-06)

Hosted and demo mode come before the rest of the M5 backlog. The one public
instance, checkhen-demo.rfkill.dev, runs hosted mode with demo data only.

### Step 1: mode setting and exam gate

- `CHECKHEN_MODE=classroom|hosted` (default classroom), passed to the app in
  `docker-compose.yml` and listed in both `.env.example` files. `/api/mode`
  reports it to the pages without sign-in.
- Hosted mode refuses exam start and stop ("Exam mode needs the classroom
  access point...") and the dashboard shows that sentence in place of the
  exam controls.
- An empty `NEXT_PUBLIC_SOCKET_URL` makes the browser use the page's own
  origin for the socket, so one build works behind any proxy that sends
  `/socket.io/` to the socket server; unset keeps the development default.
- The help pages say which features depend on the mode.

Open with AICP: how a student's own Join counts in hosted mode (self-reported
attendance, participation only, or wait for roll call).

### Step 2: hosted stack on loopback

- `network/hosted/` is a small nginx image: one loopback origin that sends
  `/socket.io/` to the socket server and everything else to the app, as the
  classroom proxy does on the access point.
- Compose profile `hosted` adds that proxy; profile `tunnel` adds cloudflared,
  which reads `CHECKHEN_DEMO_TUNNEL_TOKEN` from the environment at run time. The
  app and socket host ports are now variables (`APP_PORT`, `SOCKET_PORT`), so a
  second stack can run beside another.
- `NEXT_PUBLIC_SOCKET_URL` now keeps an empty value at build time (`${VAR-...}`),
  which hosted mode needs for a same-origin socket.
- On the build host: compose project `checkhen-demo`, settings in the gitignored
  `.env.hosted` (generated secrets, `CHECKHEN_MODE=hosted`, app 3100, socket
  6160, proxy 8180, all on 127.0.0.1). Start:
  `podman-compose -p checkhen-demo --env-file .env.hosted --profile hosted up -d --build`.
  Checked on 2026-10-07: `/api/mode` reports hosted; `/join` and `/help/student`
  return 200; the socket.io handshake succeeds through the proxy.

### Step 3: roll call

- In hosted mode, the call screen has a Roll call button. It steps through
  the active roster, alphabetically, asking "Present?" with Present and Absent
  buttons, and lists every student with their mark so a mark can be changed.
- Present writes the same `CHECK_IN` event network attendance writes, by the
  instructor, with a generated anonymous name and `rollCall: true`; marking
  twice writes one check-in. Absent on a present student writes `CHECK_OUT`.
  A roll-called student can be cold-called.
- The roll-call API actions answer 409 in classroom mode, where the access
  point takes attendance.

Verified: 31 Jest suites and 297 tests; 41 route integration cases (adds the
hosted roll-call case).

## Issue #2: demo mode

- `CHECKHEN_DEMO=1` (hosted mode only) replaces Google sign-in with a persona
  picker at `/demo`: the instructor (Professor Hoot) or one of ten farm-animal
  students. Personas use the reserved `demo.checkhen.invalid` domain, the
  credentials provider accepts only those addresses, and in demo mode the
  demo instructor is the only instructor, so a demo deployment cannot admit a
  real account.
- Avatars are generated SVGs (the animal emoji on a soft circle), so the
  repository ships no image files to license.
- The seed (`lib/demo.ts`): one course, "Demo: Farm Science 101", with four
  past meetings on fixed dates (Tuesdays in September 2026) and a week-long
  live session with everyone checked in by roll call. It covers check-ins
  and roll call, chat, hands, pace, every cold-call outcome, follow-up runs,
  a Retry, a Skip, Absents with one excused, and the patterns the issue names
  (Sage never called, Gus passes often, Daisy volunteers often).
- Reset: the event log is append-only, so a reset never deletes. It creates a
  new demo course from the seed, and demo mode shows only the newest one. The
  dashboard has Reset demo for the instructor; `/api/demo` seeds a fresh
  deployment on first use.
- Verified on 2026-10-07: 33 Jest suites and 300 tests; 42 route integration
  cases (adds: the seed folds in every session, includes every outcome, an
  excuse, and a follow-up, and a reset makes a new course without touching the
  old one). End to end on the loopback demo stack in headless Chromium, with no
  stubs: persona sign-in as the instructor (dashboard, course record), a real
  draw and record on the call screen at 375x667, roll call, and persona
  sign-in as a student to the student page. No page errors.

## Review of 8fd5f4d to c0b5b4b (hosted and demo)

Report: AICP review `review-8fd5f4d-c0b5b4b-hosted-demo.md` (kept outside the repository).
The tunnel stays off until M1 and M2 are fixed and AICP confirms.

### M1: demo mode only on a hosted, demo-only database

- `isDemo()` is true only when `CHECKHEN_DEMO=1` and `CHECKHEN_MODE=hosted`. In
  classroom mode the flag is ignored: Google sign-in and the real instructors stay.
- Demo mode serves only a database where every user has a demo address and every
  course came from the seed. On any other database, every API request through
  `requireIdentity` and `/api/demo` returns 503 with the reason, the persona sign-in
  refuses, and the seed never runs. The demo page shows the reason.
- Migration `20261007000000_demo_course_marker` adds `Course.demo`. Only the seed
  sets it, and the current demo course is the newest marked one, not the newest
  with the demo name.
- The demo stack on the build host predates the marker, so its database must be recreated
  before the tunnel opens.
- A course with no sessions and no roster does not count as real data: the events
  migration creates an empty "Imported course" in every database, so a fresh demo
  database was refused until this was allowed.

### M2: narrow what a demo visitor can write

- Rate limits on every demo write (`lib/demo-guard.ts`, applied in
  `requireIdentity` and the profile routes): 60 writes a minute per client
  (Cloudflare's `cf-connecting-ip`), 600 a minute overall. Reset has its own
  limit: 3 an hour per client, 12 an hour overall. Over a limit: 429 with
  `Retry-After`. Reads are not limited.
- Size cap: demo writes stop with 507 when the database reaches
  `DEMO_MAX_DATABASE_MB` (default 512). The event log is append-only, so a full
  demo database is recreated, not cleaned.
- Roster add accepts only `demo.checkhen.invalid` addresses in demo mode; course
  creation is refused; profile photo uploads are refused and the profile page
  shows the photo as fixed.
- Profile text fields are capped in every mode: display name and pronunciation 80
  characters, pronouns 40, food allergies 200, bio 280 (unchanged). This replaces a
  test that recorded the missing display-name limit as a known bug.
- Reset restores every profile field of every persona, not only the name and photo.
- Not done: a Cloudflare rate-limit rule. The in-process limits cover the demo
  without one.

### M3: a roll-call Absent removes the attendance credit

- Absent on a student marked Present by roll call now undoes the roll-call
  check-in, so the course record does not count the session as attended. Marking
  Present again writes a new check-in and restores the credit.
- A student who checked in on their own (network attendance) is checked out, as
  before: that session still counts as attended.

### Minors m1-m3: tunnel and proxy containers

- cloudflared is pinned to 2026.10.0. Its `--help` confirms the review's concern:
  with no `--metrics` address it binds every interface when containerized, and the
  service uses host networking. It now binds metrics to `127.0.0.1:20241`.
- The tunnel token is the external podman secret `checkhen_demo_tunnel_token`,
  read with `--token-file`. Checked with a fake value: the token does not appear in
  `podman inspect` or `podman-compose config`. Stacks without the `tunnel` profile
  start without the secret; the `tunnel` profile fails with "no such secret".
- The hosted proxy builds from `network/hosted` only, so the `.env` files never
  enter its build context.

### Hosted demo runbook (build host)

1. Create the tunnel secret once, from Secrets Manager:
   `agent-credential run --project fishjump -- podman secret create --env=true checkhen_demo_tunnel_token CHECKHEN_DEMO_TUNNEL_TOKEN`
2. Start: `podman-compose -p checkhen-demo --env-file .env.hosted --profile hosted --profile tunnel up -d --build`.
   After a rebuild, add `--force-recreate`: podman-compose does not replace a running
   container when only its image changed.
3. A fresh demo database: `podman-compose -p checkhen-demo --env-file .env.hosted --profile hosted down -v`,
   then start. The first visit to `/demo` seeds it.

Checked on 2026-10-07 after recreating the demo database: `/api/demo` lists 11
personas and a live session; persona sign-in for the instructor, the call screen
at 375x667, and a student pass end to end in headless Chromium with no page errors.

### Minor m4: one instructor check

- `lib/instructor.ts` holds `isInstructor`; the sign-in callbacks, `is-admin`,
  `get-user-info`, and the student-profile, new-class, templates, and analytics
  routes use it (the last four through `requireIdentity`), so they also pass the
  demo gate. Before, these read `ADMIN_EMAILS` themselves and refused the demo
  instructor.
- One behavior change: an `ADMIN_EMAILS` entry that already has a domain is used
  as written in these routes too, as `requireIdentity` already did.

### Minor m9: tests for the uncovered changes

- Demo persona sign-in: domain check, unknown persona, a database with real data,
  Google kept in classroom mode.
- Same-origin socket: an empty `NEXT_PUBLIC_SOCKET_URL` connects to the page origin.
- F1: Undo is disabled while an undo runs, and a second tap sends nothing.
- Each test fails when its fix is reverted (checked by mutation).

Verified: Jest 37 suites, 328 tests; PostgreSQL integration 42 cases.

## Review of M5 fixes 1-3 (550aaa7, 4fd7284, 622f656)

Report: AICP review `review-550aaa7-622f656-exam.md` (kept outside the repository).

### M1: a drop that ends between passes still fails

- A fail now also records when evidence returns after a gap longer than the
  threshold, not only when a pass sees the student missing. Heartbeats keep the
  first and last arrival since the last fold, so the gap uses the first.
- Station evidence shows a gap only when the polls around it were at most 2 s
  apart: after a longer stall, a station's latest activity says nothing about the
  time in between, so no gap fail is invented. With polls every 0.5 s, 29 s away
  still passes and 31 s fails.
- The agent runs two threads. Detection (`detect_pass`) does only local, bounded
  work: `iw` (1 s timeout), binding upkeep, and the fold. The worker
  (`worker_pass`) sends checkouts, fail callbacks, and allowlist seeding.
- `/exam-status` is read-only. It reports what detection last folded, so a stale
  station snapshot can no longer credit a departed device. It also reports
  detection health; the dashboard shows "Connection checks have stopped" when no
  pass has finished for 5 s.
- `/exam-stop` sends pending fails without holding the lock (review minor m1).
- A binding-upkeep error no longer skips exam detection, and a fail saved without a
  fail ID gets one instead of raising on every pass (part of minor m2).
- Tests: a request waits for the lock; fail callbacks from the worker and from
  `/exam-stop` run with the lock free; the gap cases above; status does not fold.
  Removing the lock from requests, or moving either callback path inside it, fails
  a test.

### M2: an idle device that is present stays present

- Confirmed from hostapd source (`src/ap/sta_info.c`, `ap_handle_timer`): an idle
  station's next check is scheduled at `ap_max_inactivity + fuzz - inactive`, with
  `fuzz = os_random() % 20`. With `ap_max_inactivity=10`, a present, idle station
  can reach about 29 s of inactive time before hostapd polls it.
- Rule: detection sends each exam device that has been idle for 3 s one UDP
  datagram to the discard port on each bound address, at most every 2 s. The
  device's 802.11 ACK, ARP reply, or ICMP reply resets its inactive time (mac80211
  counts the last ACK as activity). The send never blocks.
- The disconnect limit is now 10 to 3600 s (was 1 to 3600), in the agent, the app,
  and the dashboard input: heartbeats are 5 s apart.
- Operator check on x1 (replaces review check 2): during an exam with an idle phone
  (screen off, CheckHen closed) and an idle laptop, run
  `iw dev <ap> station dump` every 0.5 s for 5 minutes. Expect `inactive time` to
  stay under about 5 s for both. If it does not, the driver does not count the
  probe's ACK; record the driver and the largest value seen.

### M3: sites opened before the start load again quickly

- Exam start still empties the exam sets (they hold every answer from before the
  exam). The first worker pass after the start now seeds every allowlisted name
  through the AP's dnsmasq, not only sign-in names, so their current addresses are
  in the sets within about a second.
- dnsmasq caps the TTL it gives clients at 30 s (`max-ttl=30`), so names a client
  cached before the start, including other names an allowed site uses, are asked
  again within 30 s and then enter the sets.
- The instructor help says a student may need to reload an allowed site once.
- Operator check on x1 (review check 5): on real clients, open a CDN-hosted
  allowlisted site (for example Google Docs or a CloudFront LMS) before the start.
  Check that it loads, after at most one reload, during the first 5 minutes.

### M4: sign-in names under an allowlisted parent

- Seeding now covers both directions: allowlisted names at or under a sign-in name,
  and sign-in names under an allowlisted name (`google.com` on the allowlist seeds
  `accounts.google.com` from `PREAUTH_DOMAINS`). dnsmasq sends sign-in names to the
  preauth sets only, so without seeding they were blocked during the exam.
- Seeding repeats every 10 s (was 30 s), so a refreshed or rotating answer reaches
  the exam sets sooner.
- Limit: only the sign-in names themselves are seeded, not names under them.
- Operator check on x1 (review check 6): allowlist `google.com` and check that
  `accounts.google.com` and `ssl.gstatic.com` load during the exam.

### M5: evidence comes from the exam device only

- The exam device is the student's primary device: the one they checked in with
  first (a later check-in on another device only adds that device).
- Heartbeats now name their device. The classroom proxy sets `X-Real-IP` on
  `/socket.io/`, the socket server forwards it with each heartbeat (one per device
  per interval), and the agent credits the heartbeat to the MAC bound to that
  address for that student. A heartbeat from another device, an unbound address,
  or no address counts for no one. Station evidence was already the exam device's
  only.
- Closes case 1 of the review (a phone with the class page open covering the
  laptop's departure). Case 2 remains by design: a student whose first check-in was
  the phone is watched on the phone. The help pages tell students to take the
  exam on the device they checked in with first.
- Operator check on x1 (review check 7): a student with a phone (checked in
  second, class page open) and a laptop (checked in first) moves the laptop to a
  phone hotspot. Expect a fail after the limit.

### Operator checks on x1 (real hardware)

From the review, updated for the fixes above. Run each before exam mode is used in
class, and record the result here.

1. `bash scripts/class-mode.sh namespace-test`: `exam4` contents, NXDOMAIN off the
   allowlist, the 29 s and 31 s heartbeat path (heartbeats now carry the client
   address), and reachability after stop.
2. Idle presence (M2): with an idle phone (screen off, CheckHen closed) and an idle
   laptop in an exam, run `iw dev <ap> station dump` every 0.5 s for 5 minutes.
   Expect `inactive time` under about 5 s for both. Confirm the driver prints
   `inactive time`.
3. Real departures, with the CheckHen page closed (station path only) and open:
   Wi-Fi off for 29 s and for 31 s, and walking out of range. Expect no fail at
   29 s and a fail at 31 s.
4. Make `iw` fail during an exam (take the interface down briefly). Expect no fails
   during the outage, a fail afterward if the drop lasted, and the dashboard's
   "Connection checks have stopped" while detection is down for over 5 s.
5. Sites opened before the start (M3): open a CDN-hosted allowlisted site on real
   clients before the start. Expect it to load, after at most one reload, during
   the first 5 minutes.
6. Sign-in names (M4): allowlist `google.com`. Expect `accounts.google.com` and
   `ssl.gstatic.com` to load during the exam.
7. Two devices (M5): laptop checked in first, phone second with the class page
   open. Move the laptop to a phone hotspot. Expect a fail after the limit.
8. After stop, on a client with a warm DNS cache: a site off the allowlist
   resolves and loads.
9. Restart the agent mid-exam. Expect no mass fail, and detection resumes.
10. With a full class during an exam, run a heartbeat burst while timing `/bind`
    and `/exam-stop`.

Verified: Python 69 tests; Jest 37 suites, 330 tests.

### Fix 4: releasing the exam network (M5 review findings 2 and 10)

- `releaseExamNetwork` (`lib/exam-control.ts`) calls the agent's `exam-stop`
  whatever the event log shows. Stop, end class, and session expiry all use it, so
  an exam a failed start left on the agent no longer locks the class network.
  Without a configured agent it does nothing.
- Start releases first, then starts; if the start or its `EXAM_STARTED` write fails
  (including a timeout after the agent applied the gate), it releases again.
- Stop with no exam in the log releases the network and returns 200 (was 409).
- Finding 10: `/exam-stop` always stops. Fails the agent could not deliver come
  back in its response (`unreported`), and the app records them, deduplicated by
  fail ID as before. A failing callback can no longer keep an exam running or block
  session expiry.

Verified: Python 70 tests; Jest 37 suites, 334 tests; PostgreSQL integration 42
cases.

### Fix 5: the signature covers the action (M5 review finding 9)

- Every body signed with `PORTAL_CONTROL_SECRET` names its action: the app's and
  socket server's calls to the agent (`bind`, `revoke`, `revoke-student`,
  `revoke-session`, `exam-start`, `exam-stop`, `exam-status`, `exam-heartbeat`),
  and the agent's callbacks to the app (`portal-expired`, `exam-failed`). Each
  receiver refuses a body whose action does not match the route, so a captured
  heartbeat or callback cannot be replayed against another action.
- The session-expiry call signs with `AUTH_SECRET`, a different key, so it is
  unchanged.
- The namespace test signs its actions too.

Verified: Python 71 tests; Jest 37 suites, 336 tests.
