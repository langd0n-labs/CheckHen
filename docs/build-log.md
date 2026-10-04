# Build log

Branch: build/m0-m2. Scope: M0 through M3.

## Operator decisions

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
| Simulated clients sign in and use the uplink | PARTIAL: the operator's x1 `bash scripts/class-mode.sh namespace-test` run completed with `PASS: DHCP lease, captive redirect, pre-sign-in block, signed IP/MAC bind, and uplink access`. This proves the network path for one namespace client with a signed test identity; it does not exercise multiple namespace clients or live Google sign-in. |
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
| Check-in from outside the AP subnet fails | PASS in unit tests: the agent rejects an address outside its configured subnet; the app maps the agent's 403 to a failed check-in. A missing agent configuration also fails closed. Live AP testing remains part of the deferred M2 operator check. |
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
cycle. The root namespace test is written but has not run. The live AP and
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
socket isolation. On nimbus, the agent-test default is
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
