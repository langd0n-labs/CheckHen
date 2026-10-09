# Network filtering: class network and exam mode

CheckHen's classroom mode runs on a laptop that is also the class Wi-Fi access
point (AP). The laptop's network container controls which clients reach the
internet, and during an exam, which addresses they reach. Hosted mode has no AP
and none of this filtering.

## Components

All of these run in the privileged network container that
`scripts/class-mode.sh` starts with host networking. Their state is in
`/run/checkhen` (`.build-cache/laptop-state` on the host).

| Component | Role |
|---|---|
| `hostapd` | The AP on `AP_INTERFACE`, with client isolation (`ap_isolate=1`) and `ap_max_inactivity=10`. |
| `dnsmasq` | DHCP, IPv6 router advertisements, and DNS for AP clients. It fills the nftables address sets from the answers it gives. |
| nftables | Tables `ip checkhen` and `ip6 checkhen6` (`classroom.py`, `firewall.nft`). |
| Portal agent (`agent.py`, port 7878 on `AP_ADDRESS`) | Binds signed-in devices, runs exam mode, and watches exam connections. Only the app and socket server call it. |

## The class network

1. A device joins the AP and gets an address by DHCP (IPv4) or SLAAC (IPv6).
2. Until the device is bound, its HTTP requests go to the CheckHen portal, and it
   reaches the internet only for sign-in: TCP 443 to addresses in `preauth4` and
   `preauth6`. dnsmasq adds the answers for `PREAUTH_DOMAINS` and their subdomains
   to those sets, with a 5-minute timeout.
3. The student signs in and checks in. The app calls the agent's `/bind` with the
   client's address. The agent finds the MAC from the DHCP lease (IPv4) or the
   neighbor table (IPv6). It then adds the address and MAC pair to `authorized4`
   and the MAC to `authorized6`. A later check-in from a second device of the same
   student binds that device too.
4. Bound devices reach the uplink, except private and special-purpose ranges
   (`private4`, `private6`), which are always dropped.
5. Checkout, session end, and an expired DHCP lease remove the binding. The agent
   tells the app about an expired lease, and the app checks the student out.

The AP's own address accepts only DHCP, DNS, and HTTP/HTTPS from AP clients.

### Sign-in domains

`PREAUTH_DOMAINS` lists the exact hosts that the Google-to-BU sign-in redirect
chain uses. To find them, set `PREAUTH_DISCOVERY=1`, sign in once from a client,
and run `bash scripts/class-mode.sh domains`, which lists the names that clients
queried. Set `PREAUTH_DISCOVERY=0` again: while it is 1, unbound clients can reach
any address on ports 80 and 443.

## Exam mode

The instructor starts an exam on the dashboard with an allowlist (1 to 50
domains, each covering its subdomains) and a disconnect limit (10 to 3600 s). Only
checked-in students take part. Each student's exam device is their primary
device: the one they checked in with first.

### Start

1. The agent writes `exam-servers` for dnsmasq: `server=/#/` makes every name
   local (no answer), and each allowlisted domain goes to 1.1.1.1 and 9.9.9.9. A
   SIGHUP makes dnsmasq reload the file and clear its cache.
2. After 1 s, one nftables transaction empties `exam4` and `exam6` and fills the
   `exam_gate` chains. The gate accepts traffic from bound clients to addresses in
   the exam sets on the uplink, and drops all other forwarded traffic from the AP.
3. The agent saves the exam in `exam.json`. Devices that were not bound before the
   start cannot bind during the exam.

If the start fails, the agent restores the DNS file and the gate. The app also
calls `exam-stop` after a failed start, and before every start.

### Allowed addresses

- dnsmasq adds every answer it gives to `exam4` and `exam6`
  (`nftset=/#/...`). During an exam only allowlisted names get answers, so the
  sets hold exactly the addresses clients were given. Addresses are added, never
  replaced, so a rotating CDN answer does not break an open connection. Outside
  an exam the agent empties the sets every 60 s.
- dnsmasq caps the TTL it gives clients at 30 s, so addresses that clients cached
  before the start are asked for again soon. A site opened before the start may
  need one reload.
- dnsmasq puts an answer only in the set of the most specific matching `nftset`
  line. Sign-in names therefore reach only the preauth sets. Every 10 s, the agent
  asks the AP's dnsmasq for each allowlisted name and for each sign-in name under
  an allowlisted domain, and adds the global addresses to the exam sets. The first
  pass after the start seeds every allowlisted name.

### Connection checks

The agent's detection thread runs every 0.5 s. It reads
`iw dev <AP> station dump` (1 s timeout) and the class page's heartbeats.

- Station evidence: the time since the AP last heard the exam device. A device
  that left but is still listed does not count.
- Heartbeats: the class page sends one every 5 s while an exam runs. The socket
  server forwards it with the client address, which the classroom proxy sets in
  `X-Real-IP`. The agent counts it only for the device bound to that address, so
  another device of the same student does not count.
- An exam device idle for 3 s gets a UDP datagram to the discard port on each
  bound address, at most every 2 s. Its 802.11 ACK or reply resets its inactive
  time. Without this probe, hostapd checks an idle station only after up to 29 s.
- A fail is recorded when evidence is missing for longer than the limit, or
  when evidence returns after a gap longer than the limit. A station gap counts
  only when the polls around it were at most 2 s apart. When `iw` fails, no new
  fail is recorded until station data returns.
- Each drop is its own fail with its own ID. After a reported fail, the student
  can fail again once they are back.
- A worker thread sends fails to the app (`/api/internal/exam-failed`) with the
  lock released. The app stores each fail ID once.
- `/exam-status` is read-only. It reports what detection last saw, and whether a
  detection pass finished in the last 5 s. The dashboard shows "Connection checks
  have stopped" when none did.

### Stop

Stop, end class, and session expiry all call `exam-stop`, whether or not the app
shows an exam. The agent sends pending fails, removes the gate and the DNS filter,
deletes `exam.json`, and returns any fails it could not deliver. The app records
those fails.

## Signed requests

Every request between the app, the socket server, and the agent carries an
HMAC-SHA256 of the body, made with `PORTAL_CONTROL_SECRET`, in
`X-CheckHen-Signature`. The body includes the action and a timestamp. The receiver
refuses a wrong signature, an action that does not match the route, and a
timestamp more than 30 s away. Port 7878 is not reachable from AP clients.

## Limits

- The allowlist works by IP address. A site on a shared CDN address (Cloudflare,
  Fastly, CloudFront) lets a client reach other sites on the same address,
  including DNS-over-HTTPS endpoints that share it.
- A student whose first check-in was a phone is watched on the phone.
- Times are measured from the last evidence, not from the moment a device left.

## Commands

| Command | Effect |
|---|---|
| `bash scripts/class-mode.sh start` | Checks the host, then starts the AP, the network container, and the app. |
| `bash scripts/class-mode.sh stop` | Stops the app and restores the host network. |
| `bash scripts/class-mode.sh check` | Checks the host and settings without starting. |
| `bash scripts/class-mode.sh namespace-test` | Runs the end-to-end network test with simulated clients in network namespaces. |
| `bash scripts/class-mode.sh domains` | Lists the names that clients queried. |

## Troubleshooting

- **Students reach nothing after check-in:** see whether the device is bound
  (`nft list set ip checkhen authorized4`). A device that changed its MAC
  (private Wi-Fi address) must check in again.
- **Sign-in fails on the portal:** the redirect chain uses a host that is not in
  `PREAUTH_DOMAINS`. Discover the names again as described above.
- **An allowlisted site does not load during an exam:** reload it once. Then see
  whether its address is in `nft list set ip checkhen exam4`. A site that loads
  content from other domains needs those domains on the allowlist too.
- **The network stays locked after an exam:** end the exam or the class on the
  dashboard; both release the network. If the app is down, `classroom.py stop`
  (part of `class-mode.sh stop`) removes the exam state.
