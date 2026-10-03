# CheckHen product brief

Status: draft for the build agent. Owner: Langdon White.

CheckHen is a classroom interaction system. One instructor runs it for one class
at a time, on a laptop in the room. Students connect to a classroom Wi-Fi access
point (AP). The laptop or an OpenWrt router provides the AP. Every feature uses
that connection.

## 1. Features

| # | Feature | Summary |
|---|---|---|
| F1 | Chat | Students post questions. Other students see an anonymous name. The instructor sees the real student. The chat can be projected. |
| F2 | Attendance | A student who signs in through the classroom AP is present. A student who is not connected is absent. |
| F3 | Hand raising | A student raises a virtual hand. The instructor acknowledges it and can rate the contribution. |
| F4 | Pace signals | A student signals "slow down" or "ready to move on". The instructor sees the counts. |
| F5 | Exam mode | The AP allows only an allowlist. A student who disconnects for more than 30 seconds fails automatically. The instructor can excuse a fail. |
| F6 | Cold calling | The instructor calls on a fairly sampled student and records the outcome with two taps. The record feeds a participation grade. |

## 2. Interfaces

Build all interfaces as one web application. Make every interface responsive.
Make the two mobile interfaces installable as a progressive web app (PWA). Do
not build native apps.

| # | Interface | User | Device | Features |
|---|---|---|---|---|
| I1 | Student web | Student | Laptop browser | F1–F5 |
| I2 | Student mobile | Student | Phone browser or PWA | F1–F4 |
| I3 | Instructor in-class | Instructor | Phone PWA | F2, F3, F4, F6, chat moderation, exam control |
| I4 | Instructor analytics and scoring | Instructor | Laptop browser, before or after class | Attendance, participation, cold-call grade, exports, configuration |
| I5 | Projection window | Room | Separate browser window on the projector | F1 read-only, optional hand-raise and pace counts |
| I6 | Slidev chat component | Room | Inside a Slidev deck | F1 read-only, as a Vue component that a deck imports |

Rules:

- The instructor can disable phones for a class. Then the server rejects I2
  sessions and students use I1.
- I5 and I6 show anonymous names only. They never show a real name.
- I6 is a separate package in this repository. A Slidev deck installs it and
  places it on a slide or in a global layer. It connects to the classroom server
  over the same socket API as I5.
- Google Slides integration is a non-goal for this build. Record any finding
  about it in the pilot notes.

## 3. Identity and sign-in

1. A student connects to the classroom AP.
2. A captive portal sends the student to sign in with Google. Only the
   institution's Google Workspace domain is accepted (configuration value,
   default `bu.edu`). The institution's single sign-on verifies the account.
3. Sign-in binds the device to the student for the class session. Record the
   student, the client IP address, and the client MAC address from the DHCP
   lease.
4. Internet access for students goes out through the AP's uplink (the laptop
   in profile A, the router in profile B). The instructor's institutional
   network login provides that uplink.

The instructor is an admin by configuration (allowlisted emails). Teaching
assistants are admins with the same rights in this build.

Sign-in happens at the start of class, before the instructor starts exam mode.
Exam mode does not need to allow a new Google sign-in.

## 4. Feature rules

### F1 Chat

- Each student gets one anonymous name per class session, such as "Swift
  Panda". The existing `anonymousNames` library generates it.
- Store the real user with every message. Show the real name only in instructor
  interfaces.
- The instructor can hide a message. Hiding writes a moderation event. It never
  deletes the message.
- The instructor can mute a student for the rest of the session.
- I5 and I6 show new messages in real time and hide hidden messages within one
  second.

### F2 Attendance

- A check-in is valid only if the request comes from the AP subnet and the
  session is signed in.
- The server accepts student requests only from the AP subnet. Do not expose
  it on the uplink.
- One device per student per session counts for attendance. A second device
  can use chat but does not change attendance.
- Record check-out when the device leaves the AP or the session ends.

### F3 Hand raising and F4 pace signals

Keep the existing behavior. Move every state change into the event log
(section 5).

An acknowledged hand raise that the instructor rates as productive counts as a
volunteer answer for F6.

### F5 Exam mode

Two network states exist after sign-in:

| State | Allowed destinations |
|---|---|
| Class mode | Internet, through the uplink |
| Exam mode | The CheckHen server and the exam allowlist only |

Enforce exam mode at the IP layer with nftables. Also run DNS filtering
(dnsmasq). Do not rely on DNS alone: browsers use DNS over HTTPS, and students
can set their own DNS servers.

Rules:

- The allowlist is a per-exam configuration of domains. Resolve the domains to
  IP sets when exam mode starts, and refresh the sets during the exam.
- Google IP ranges are open before sign-in only. When exam mode starts, close
  them for signed-in clients unless the exam allowlist contains a Google
  service. Google ranges also serve Gemini and Search.
- Track each signed-in exam client with a socket heartbeat and with AP station
  events (`hostapd_cli` or nl80211).
- If a client has no heartbeat and no AP association for more than 30 seconds,
  record an automatic fail event. Make the threshold a configuration value.
- The instructor can excuse a fail. Excusing writes an event with a reason. It
  does not delete the fail event.
- A student with a connection problem raises a physical hand. The instructor
  excuses the fail after a check.
- Show the instructor, in real time: connected, disconnected with a timer, and
  failed students.

Non-goal: detecting a second device on cellular data. Exam mode controls only the
classroom network. Human proctors watch for second devices.

### F6 Cold calling

Reproduce the design of `tools4ds/cold-call-app` (an iPhone app). The rules
below are complete. Do not depend on access to that repository.

Call loop:

1. The instructor taps "Call on someone". The sampler selects a student.
2. The screen shows the student's photo, preferred name, and name
   pronunciation.
3. The instructor taps one outcome: Answered, Pass, Retry, or Absent.

The common path is two taps. Do not add a dialog, scroll, or extra tap to it.
Undo is available immediately and never expires.

Eligibility today: the student is checked in (F2), was not called today without
an outstanding retry, and is active on the roster. Absent students are not
eligible.

Sampler weight for an eligible student:

```
weight = 1.0
       × (1 + pass_multiplier × min(passes_outstanding, pass_cap))
       × (1 + recency_multiplier × sessions_since_called)
       × (retry_multiplier        if a retry is outstanding,  else 1)
       × (never_called_multiplier if never called,            else 1)
       × (volunteer_damping       if the student volunteered, else 1)
weight = max(weight, minimum_weight)        # also when weight is not finite
```

Defaults: `pass_cap` 2, `pass_multiplier` 2.0, `recency_multiplier` 0.5,
`retry_multiplier` 3.0, `never_called_multiplier` 2.0, `volunteer_damping` 0.6,
`minimum_weight` 0.01. `sessions_since_called` counts class meetings, not
records.

Selection: sort candidates by student ID. Draw one with probability proportional
to weight. Use an injected, seeded random number generator so that a recorded
semester can be replayed exactly. Library code never uses a global random
source.

Participation grade:

- Projected answers for a student = answers so far × (total meetings in the
  term / meetings so far). Use 0 before the first meeting.
- Learned target `A` = round(`ratio` × median projected answers for the class),
  clamped to [`A_min`, `A_max`]. Defaults: `ratio` 0.7, `A_min` 3, `A_max` 8.
  Show `A` as provisional all term. Never let the instructor edit `A` directly.
- Opportunities = cold-call answers + passes + absences. A retry is not an
  opportunity until the student is asked again.
- Volunteer cap = ceil(`A` / 2). Volunteer answers above the cap earn no points.
- Score = min(1, (cold-call answers + min(volunteer answers, volunteer cap)) /
  min(`A`, opportunities)).
- `component_weight` (default 0.05) is the share of the course grade.
- Export the components (answers, passes, absences, opportunities, the `A` in
  force, the score), never the score alone.
- Stamp every configuration value in force onto every export.

## 5. Data rules

- The participation record is an append-only event log. Corrections, undo,
  moderation, excused fails, and late arrivals are new events that supersede old
  events. No code path deletes or edits a recorded event.
- An event is superseded when a later effective event names its ID. Order events
  by timestamp, then by ID.
- Compute derived state (pass debt, sessions since called, attendance totals,
  grades) from the log when read. Do not store derived state.
- Scope every record to a course and a class session. The current code treats
  "the most recent class" as the current class. Replace that assumption.
- Keep all student profile fields: display name, name pronunciation, pronouns,
  photo, food allergies, and bio. Show food allergies and bio only in instructor
  interfaces. Never show them to other students.

## 6. Deployment

The deployment has two layers:

- **Application layer:** the Next.js application, the socket server,
  PostgreSQL, and optional Grafana. It runs with Docker Compose or Podman
  Compose on Linux, macOS, and Windows. Test it on all three.
- **Network layer:** the AP, DHCP, DNS filtering, nftables enforcement, and the
  captive portal. It needs direct access to a Wi-Fi radio. On macOS and Windows,
  containers run in a Linux virtual machine that cannot reach the host's USB
  Wi-Fi adapter, so the network layer cannot run in a container there.

Two network profiles exist. Both must give the same behavior to the
application layer.

### Profile A: Linux laptop

- Host: a Linux laptop with a USB Wi-Fi adapter that supports AP mode. The
  laptop's built-in Wi-Fi or Ethernet is the uplink.
- Run the network layer in a privileged container with host networking, or as
  host scripts that one command installs. Choose one and document the reason.
- One command starts class mode. One command switches to exam mode and back.
  One command stops everything and restores the laptop's network.

### Profile B: OpenWrt router (macOS and Windows)

- An OpenWrt router runs the network layer: AP, DHCP, DNS filtering, nftables
  (fw4), and redirection to the captive portal.
- The laptop runs only the application layer. It connects to the router by
  Ethernet or Wi-Fi.
- The application controls the router through a defined interface (for example
  rpcd/ubus over HTTP, or SSH). It authorizes a signed-in client, switches class
  and exam mode, updates the allowlist, and reads DHCP leases and station
  events.
- The router's uplink uses the instructor's network login. Document how to
  configure it.
- Provide an install package or script for the router, and a list of tested
  router models.

### Both profiles

- Target: 150 concurrent student clients. The Raspberry Pi 3B+ did not reach
  this target in testing.
- Put the shared network rules (allowlist, nftables sets, captive-portal
  behavior) in one place that both profiles use.

Delete the Raspberry Pi path (`pi-setup/`) after profile A replaces it. Keep its
working parts, such as the NAT rules, where the profiles reuse them.

## 7. Starting point

The repository is `langd0n-labs/CheckHen`. Its `main` contains Alicia Cao's work
(`a1icja/CheckHen#48`): Auth.js with Google, anonymous names, pace signals,
check-out, class templates, student profiles, an analytics page, tests, and the
Raspberry Pi exam-network scripts.

Keep the stack: Next.js, a Socket.IO server, PostgreSQL with Prisma. Remove
Clerk remnants, such as `pages/api/get-clerk-info.ts`. Grafana is commented
out in `docker-compose.yml`. Only a provisioned dashboard
(`grafana/dashboards/student-statistics.json`) uses it; no application code
does. Decide whether to keep it as an optional profile for analytics or to
remove it. Record the decision and the reason in `docs/build-log.md`. If you
keep it, fix the datasource reference: Grafana assigns a random UID to the
datasource, and the provisioned dashboard then cannot find it. Set a fixed UID
in the datasource provisioning file.

The original README reported that the admin dashboard needs a manual refresh
before its socket connects. Check whether this defect still exists. Fix it in M0
if it does.

## 8. Milestones

Do the milestones in order. A milestone is complete only when each acceptance
check passes. Record the result of each check in `docs/build-log.md`.

Some checks need hardware that the build environment does not have: a USB Wi-Fi
adapter, a real router, a macOS or Windows laptop, phones. For each such check,
write a script or a step-by-step procedure that the operator runs. Mark the
check "waiting for operator" in the build log. Continue with the next milestone.

**M0. Baseline.**
- From a clean clone, one documented command starts the stack.
- All existing tests pass.
- No `.env` file or other secret is tracked. `.env.example` lists every
  variable.
- The application layer starts with Docker Compose on Linux.
- A documented procedure starts it with Docker Desktop or Podman on macOS and
  Windows. The operator runs this procedure; record the result when the
  operator reports it.
- The Grafana decision is recorded. If Grafana stays, its dashboard loads data
  from PostgreSQL without manual repair.

**M1. Domain model and event log.**
- Courses, rosters, class sessions, and the append-only event log exist.
- A test runs two courses in parallel and shows no data crossing between them.
- A test shows that undo and correction write new events and that the folded
  state matches the expected state.

**M2. Laptop network profile (class mode).**
- A captive portal signs a student in with Google and binds IP and MAC to the
  student.
- A test with simulated clients (network namespaces or equivalent) shows
  sign-in and internet access through the uplink.
- A load test reaches 150 concurrent socket clients with chat median latency
  under 1 second.

**M3. Attendance.**
- A check-in from outside the AP subnet fails. A test shows it.
- A second device for the same student does not change attendance.

**M4. Chat, moderation, projection.**
- Student, instructor, I5, and I6 views show the correct name rules. A test
  checks each view.
- A hidden message disappears from I5 and I6 within 1 second.
- A sample Slidev deck in `examples/` imports I6 and shows live chat.

**M5. Exam mode.**
- In a namespace test, an exam client reaches the server and allowlisted
  domains, and fails to reach a non-allowlisted IP, a public DNS-over-HTTPS
  resolver, and a Google range that is not on the allowlist.
- A client that drops for 31 seconds gets an automatic fail. A client that drops
  for 29 seconds does not.
- An excuse event clears the fail in the instructor view. The fail event stays
  in the log.

**M6. OpenWrt profile.**
- The M2, M3, and M5 acceptance checks pass against an OpenWrt image in a
  virtual machine or emulator, with the application layer on a separate host.
- A test script runs the same checks against a real router. The operator runs
  it with a macOS laptop; record the result when the operator reports it.
- The router install and the router-control interface are documented.

**M7. Cold calling.**
- Sampler tests: seeded replay gives identical selections. Input order does not
  change the result. Weights match the formula for each factor.
- Grade tests: `A`, volunteer cap, and score match hand-computed examples,
  including the bounds of `A`.
- The in-class interface (I3) completes Call → Answered in two taps.

**M8. Analytics and scoring (I4).**
- Attendance, participation, and exam events per student and per session.
- CSV export with the configuration stamp.


## 9. Open items

Record a decision or a finding for each item in `docs/build-log.md`:

1. Which USB Wi-Fi chipsets support AP mode with 150 associated clients. Test
   at least one adapter before M2 is complete.
2. Native network layer on macOS (Internet Sharing with `pf`). Do not build
   it. Record whether it could reach 150 clients. Windows Mobile Hotspot allows
   only 8 clients and is not a candidate.

## 10. Non-goals

- Native mobile apps.
- Google Slides integration.
- Detection of second devices on cellular networks.
- FERPA compliance work beyond the data rules in section 5. All data stays on
  the instructor's machine in this build.
- Merging changes into `tools4ds/cold-call-app`.
