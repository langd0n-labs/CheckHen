# Operator acceptance checks

Send the platform, command, pass/fail result, and any error text back to the build
session. Do not send environment files, tokens, database records, or passwords.

## M0: macOS and Windows application startup

Prerequisites: Git, Python 3, Podman Desktop, and its Compose provider.
Run the following from a terminal (PowerShell on Windows):

```sh
git clone --branch build/m0-m2 https://github.com/langd0n-labs/CheckHen.git
cd CheckHen
podman machine init
podman machine start
```

If a Podman machine already exists, skip init. If it is running, skip start.

macOS:
```sh
python3 scripts/start.py
```

Windows:
```powershell
py -3 scripts/start.py
```

Then run:
```sh
podman compose ps
curl http://localhost:3000/api/ping
```

On Windows use `curl.exe` if PowerShell aliases `curl`. Expect all three services
running and HTTP 200 with `{"message":"Pong!"}`. Open http://localhost:3000.
The sign-in page must render. Live Google sign-in is a separate check.

Stop and restart without deleting the database:
```sh
podman compose down
podman compose up -d
```

Repeat the ping and browser checks. Report the OS version, Podman/Compose
versions, and both startup results.

Docker checks are deferred by operator instruction. When scheduled, repeat this
procedure with Docker Desktop running, replacing `podman compose` with
`docker compose`; the ignored root `.env` must already exist.

## M2: Linux laptop class mode on x1

Use a USB Wi-Fi adapter for the AP. Keep the built-in Wi-Fi connected as the
uplink. These commands run in an x1 terminal. The checkout command uses a new
directory; if that directory already exists, use the update commands instead.

```sh
git clone --branch build/m0-m2 --single-branch https://github.com/langd0n-labs/CheckHen.git ~/CheckHen-m2
cd ~/CheckHen-m2
```

For an existing checkout:

```sh
cd ~/CheckHen-m2
git fetch origin build/m0-m2
git checkout build/m0-m2
git pull --ff-only origin build/m0-m2
```

Install the two missing x1 services and make a local Certbot environment:

```sh
sudo dnf install -y hostapd nginx dhcp-client
python3 -m venv .build-cache/certbot
.build-cache/certbot/bin/pip install certbot certbot-dns-cloudflare
```

Populate the ignored application environment from Bitwarden Secrets Manager.
The commands never display the credential values. Certbot creates a DNS-01
certificate for the configured AP hostname. Its temporary Cloudflare token
file is removed when the command ends. Public A/AAAA records are not required
for this test: AP DNS resolves `checkhen.rfkill.dev` to the local AP address.

```sh
~/bin/agent-credential run --project fishjump -- python3 scripts/configure-credentials.py
~/bin/agent-credential run --project fishjump -- python3 scripts/issue-cert.py
python3 scripts/configure-admin.py
```

For the automated namespace check, the USB adapter is not needed. Enter the
instructor username locally when prompted. This test creates a temporary veth
pair and namespace, uses dnsmasq for DHCP, and restores host settings on exit:

```sh
sudo python3 network/laptop/test_namespace.py
```

For the adapter check, attach the USB radio and run:

```sh
python3 scripts/configure-ap.py
python3 scripts/configure-preauth.py discover
bash scripts/class-mode.sh check
bash scripts/class-mode.sh start
```

The configuration command selects an AP-capable USB interface, detects the
uplink, and prompts for a Wi-Fi passphrase without echoing it. `check` must
report no conflicting route before `start` changes the network. Connect one
laptop client to the CheckHen SSID. Its first HTTP request should redirect to
`https://checkhen.rfkill.dev/join`. Discovery mode temporarily allows HTTPS
before sign-in so the Google-to-BU redirect chain can be observed.

Before the first live student sign-in, the instructor signs in and creates a
course and active class session in the dashboard. The M1 draft has an admin
roster API but no roster form. In the instructor browser's Developer Tools
Console, run this to add one test student. Enter the BU email in the browser
prompt; do not put it in the build log.

```js
const courseId = JSON.parse(sessionStorage.getItem('checkhen.scope') || '{}').courseId;
if (!courseId) throw new Error('Select a course first');
const email = prompt('Test student BU email');
const response = await fetch(`/api/admin/roster?courseId=${encodeURIComponent(courseId)}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, active: true }),
});
if (!response.ok) throw new Error(`Roster update failed: HTTP ${response.status}`);
'Test student added';
```

On the client laptop, open browser Developer Tools → Network, enable
**Preserve log**, clear the log, then sign in with Google. Record only the
hostnames of the Google and BU sign-in requests. Do not export or send a HAR,
cookies, authorization codes, or request headers. With no other client on the
AP, compare those hosts with the DNS query hostnames:

```sh
sudo python3 network/laptop/show-domains.py
```

Send the hostnames and the sign-in result to the build session. The build agent
will supply the exact command to lock the pre-sign-in allowlist and repeat the
sign-in. After the allowlist is locked, Internet access should fail before
joining a class and work after a successful BU sign-in and check-in. Stop class
mode after the device checks:

```sh
bash scripts/class-mode.sh stop
```

Report the adapter model, USB ID (`lsusb`), how many real devices joined, the
namespace result, whether Google→BU sign-in completed, whether the DHCP IP and
MAC were recorded for the student, whether Internet worked after check-in, and
whether `stop` restored the laptop network. Do not send identifiers or secrets.

The 150-socket test uses a disposable Podman database and does not need the
adapter or root. The build agent runs it with:

```sh
podman compose -p checkhen-m2-load -f docker-compose.load.yml up -d db-test
podman compose -p checkhen-m2-load -f docker-compose.load.yml run --rm migrate-test
podman compose -p checkhen-m2-load -f docker-compose.load.yml up -d socket-test
podman compose -p checkhen-m2-load -f docker-compose.load.yml run --rm load-runner
podman compose -p checkhen-m2-load -f docker-compose.load.yml down -v
```
