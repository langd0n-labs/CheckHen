# CheckHen

CheckHen is a real-time classroom engagement tool for BU courses. It lets students check in, raise virtual hands, send chat messages, and signal pace preferences — all anonymously. Instructors get a live admin dashboard to monitor participation and pace.

## Table of Contents

- [Tech Stack](#tech-stack)
- [External Services Setup](#external-services-setup)
  - [Google Cloud Console (OAuth)](#1-google-cloud-console-oauth)
  - [ngrok](#2-ngrok)
- [Environment Variables](#environment-variables)
- [Development Mode](#development-mode)
- [Production Mode](#production-mode)
- [First-Time Database Setup](#first-time-database-setup)
- [Admin Access](#admin-access)
- [Pages Overview](#pages-overview)
- [Analytics Dashboard](#analytics-dashboard)
- [Test Data / Seed Scripts](#test-data--seed-scripts)
- [Running on a Raspberry Pi](#running-on-a-raspberry-pi)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (Pages Router) |
| Authentication | Auth.js v4 (NextAuth) with Google OAuth |
| Database ORM | Prisma 6 |
| UI Library | Mantine 7 |
| Real-time | Socket.io (server on port 6060) |
| Database | PostgreSQL 13 |
| Containerization | Docker + Docker Compose |
| Package Manager | Yarn 4 |

---

## External Services Setup

### 1. Google Cloud Console (OAuth)

This is required for authentication in both development and production. You only need to do this once, but you must add redirect URIs for every URL you plan to run the app from.

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and create a new project (or select an existing one).
2. In the left menu, go to **APIs & Services** > **Library**. Search for and enable the **Google+ API** (or **Google Identity**).
3. Go to **APIs & Services** > **Credentials**.
4. Click **Create Credentials** > **OAuth 2.0 Client IDs**.
5. Set the Application type to **Web application**.
6. Under **Authorized redirect URIs**, add all of the following that apply to you:

   ```
   # Always add for local dev (plain localhost):
   http://localhost:3000/api/auth/callback/google

   # Add if using ngrok for dev:
   https://checkhen.ngrok.io/api/auth/callback/google

   # Add for production:
   http://bu.checkhen.com:3000/api/auth/callback/google
   ```

7. Click **Create**. You'll receive a **Client ID** and **Client Secret** — save these, you'll need them in your `.env.local`.

> **Note on BU Google Workspace:** If you're using a BU Google account, the OAuth consent screen may need to be configured for internal use or have BU test users added. If sign-in fails with "access blocked", check the OAuth consent screen settings.

> **Testing with a non-BU email (e.g. Gmail):** Set the OAuth consent screen to **External** and add the email as a test user under **APIs & Services → OAuth consent screen → Test users**. Also add the full email to `ALLOWED_TEST_EMAILS` in your `.env.local`. When you're done testing, remove the email from both places and switch the consent screen back to **Internal** so only BU accounts can sign in.

---

### 2. ngrok

ngrok creates a public HTTPS tunnel to your local machine. This is needed when:
- You want to test on a phone or tablet (they can't reach `localhost`)
- You're testing from another computer on a different network
- You've configured Google OAuth to require HTTPS (some configurations)

**Setup (one-time):**

1. Sign up at [ngrok.com](https://ngrok.com/) and install the CLI.
2. Authenticate your ngrok installation:
   ```bash
   ngrok config add-authtoken <your-token>
   ```
3. Reserve a static domain. The project is configured to use `checkhen.ngrok.io` — you can reserve a custom static domain on the ngrok dashboard under **Domains**.

**Starting ngrok (every dev session where you need it):**

```bash
ngrok http --url=checkhen.ngrok.io 3000
```

This tunnels `https://checkhen.ngrok.io` → `http://localhost:3000`.

If you have the tunnel name saved in your local ngrok config file (`~/.config/ngrok/ngrok.yml`), you can also use the shorthand:

```bash
ngrok start checkhen
```

> If you only need to test on your own machine, you can skip ngrok entirely and just use `http://localhost:3000`.

---

## Environment Variables

Create a file called `.env.local` inside the `checkhen/` directory. Do **not** commit this file — it contains secrets.

```env
# ─── Database ────────────────────────────────────────────────────────────────
# For local dev (connects to the Docker db container via localhost)
DATABASE_URL=postgresql://ds490:ds490-secure-password@127.0.0.1:5432/postgres

# ─── Email / Admin Config ────────────────────────────────────────────────────
# Only users with this email domain can sign in
NEXT_PUBLIC_EMAIL_DOMAIN=bu.edu

# Comma-separated BU email prefixes (everything before @bu.edu) that get admin access
# Use ADMIN_EMAILS (not NEXT_PUBLIC_) — this is server-only and must not be exposed to the browser
ADMIN_EMAILS=alicja,langd0n,aploog

# Optional: comma-separated full email addresses allowed to sign in outside the BU domain (for testing).
# Remove this line (or leave it blank) to restrict sign-in to BU accounts only.
# Note: any email listed here must also be added as a test user in the GCP OAuth consent screen
# (APIs & Services → OAuth consent screen → Test users) while the app is in "External" testing mode.
ALLOWED_TEST_EMAILS=youremail@gmail.com

# ─── Auth.js (NextAuth) ──────────────────────────────────────────────────────
# Generate with: openssl rand -base64 32
AUTH_SECRET="your-generated-secret-here"

# From Google Cloud Console > Credentials > Your OAuth 2.0 Client
AUTH_GOOGLE_ID="your-client-id.apps.googleusercontent.com"
AUTH_GOOGLE_SECRET="your-google-client-secret"

# IMPORTANT: This must exactly match the URL you are accessing the app from.
# If this doesn't match, Google OAuth will fail or redirect to the wrong place.
#
# For local dev (no ngrok):
NEXTAUTH_URL=http://localhost:3000
#
# For local dev with ngrok:
# NEXTAUTH_URL=https://checkhen.ngrok.io
#
# For production:
# NEXTAUTH_URL=http://bu.checkhen.com:3000
```

---

## Development Mode

Development runs the Next.js app locally with `yarn dev`, while the database and socket server run in Docker.

### Step 1: Start the database and socket server

```bash
# From the repo root
docker compose up db socket -d
```

This starts:
- PostgreSQL on port `5432`
- Socket.io server on port `6060`

### Step 2: Install dependencies (first time or after pulling changes)

```bash
cd checkhen
yarn install
```

### Step 3: Set up your `.env.local`

Follow the [Environment Variables](#environment-variables) section above. Make sure `NEXTAUTH_URL` matches how you're accessing the app:
- `http://localhost:3000` if testing only on your machine
- `https://checkhen.ngrok.io` if using ngrok

> **Getting a 502 or auth error through ngrok?** The most common cause is a `NEXTAUTH_URL` mismatch — if `.env.local` has `NEXTAUTH_URL=http://localhost:3000` but you're accessing the app via `https://checkhen.ngrok.io`, NextAuth will generate wrong callback URLs and fail. Make sure the value matches exactly how you're opening the app.

> **BU network required:** Google OAuth with BU accounts requires you to be on **eduroam** (or BU VPN). Authentication will fail if you're on a non-BU network.

### Step 4: (If using ngrok) Start your ngrok tunnel

In a separate terminal:

```bash
ngrok http --url=checkhen.ngrok.io 3000
```

Keep this running in the background for the whole dev session.

### Step 5: Start the Next.js dev server

```bash
cd checkhen
yarn dev
```

> **OAuth "state mismatch" errors?** This is a known NextAuth v4 + Google PKCE timing issue in hot-reload mode — state cookies set during OAuth sometimes don't survive the redirect when Next.js reloads mid-auth. Use `yarn build && yarn start` instead of `yarn dev` if you hit this. See [Known Issues](#known-issues).

The app is now available at:
- `http://localhost:3000` (always)
- `https://checkhen.ngrok.io` (if ngrok is running)

### Step 6: Stop everything

```bash
# Stop Next.js: Ctrl+C in its terminal
# Stop Docker services:
docker compose down
```

---

## Production Mode

Production runs everything (Next.js, socket server, and database) in Docker Compose.

### Step 1: Set environment variables in your shell

The `docker-compose.yml` reads `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and `NEXTAUTH_URL` from your shell environment. Set them before running compose.

**Option A — Export in your shell:**
```bash
export AUTH_SECRET="your-secret"
export AUTH_GOOGLE_ID="your-client-id.apps.googleusercontent.com"
export AUTH_GOOGLE_SECRET="your-google-client-secret"
export NEXTAUTH_URL="http://bu.checkhen.com:3000"
```

**Option B — Create a `.env` file in the repo root** (Docker Compose reads it automatically):
```env
AUTH_SECRET=your-secret
AUTH_GOOGLE_ID=your-client-id.apps.googleusercontent.com
AUTH_GOOGLE_SECRET=your-google-client-secret
NEXTAUTH_URL=http://bu.checkhen.com:3000
```

> Do **not** commit this root `.env` file either — it's in `.gitignore`.

### Step 2: Build and start all services

```bash
# From the repo root
docker compose up --build -d
```

This builds and starts:
- PostgreSQL on port `5432`
- Socket.io server on port `6060`
- Next.js app on port `3000`

### Step 3: Access the app

Open `http://bu.checkhen.com:3000`, checkhen.ngrok.io, (or your actual production URL) in a browser.

### Step 4: Stop all services

```bash
docker compose down
```

---

## First-Time Database Setup

The first time you run the project (or after pulling schema changes), you need to apply Prisma migrations.

**For development:**
```bash
cd checkhen
yarn migrate:dev
```

**For production (inside Docker after containers are up):**
```bash
docker exec -it 490-test npx prisma migrate deploy
```

Or, if running outside Docker for the first time:
```bash
cd checkhen
npx prisma migrate deploy
```

---

## Admin Access

Admin access is determined by the `ADMIN_EMAILS` environment variable. It holds a comma-separated list of BU email prefixes (the part before `@bu.edu`).

For example:
```
ADMIN_EMAILS=alicja,langd0n,aploog
```

This grants admin access to `alicja@bu.edu`, `langd0n@bu.edu`, and `aploog@bu.edu`. All other `@bu.edu` users are treated as students.

> **Security note:** Use `ADMIN_EMAILS` (not `NEXT_PUBLIC_ADMIN_EMAILS`). Variables prefixed with `NEXT_PUBLIC_` are embedded in the browser bundle and visible to anyone — admin email prefixes should stay server-only.

All routes under `/admin/*` are protected by middleware and redirect unauthenticated users to sign in.

---

## Pages Overview

### Student Pages
| Page | Path | Description |
|---|---|---|
| Lobby | `/join` | Landing page after sign-in; shows active classes or "no class active"; students join from here |
| Home / Check-in | `/` | Check into the active class and receive your anonymous name |
| Student Dashboard | `/student` | Raise your hand, send chat messages, signal pace |
| Chat | `/chat` | View and send class chat messages |
| Profile | `/profile` | Set preferred name, pronouns, bio, fun fact, allergies, and profile picture |

### Admin Pages
| Page | Path | Description |
|---|---|---|
| Lobby | `/join` | Same lobby; instructors see a button to create a new class |
| Dashboard | `/admin/dashboard` | Start/end class, view check-ins, manage hand raises, monitor pace signals |
| Admin Chat | `/admin/chat` | View all student chat messages |
| Analytics | `/admin/analytics` | Per-session and all-time participation metrics; see [Analytics Dashboard](#analytics-dashboard) |

### Anonymous Names

When a student checks into a class, they are automatically assigned an anonymous name in the format **positive adjective + animal** (e.g., "Swift Panda", "Calm Otter"). All word lists use only positive adjectives — no negative words. This name is consistent for the student within a class session and is used in chat and hand raise displays so the instructor can distinguish students without seeing real names.

### Pace Signals

Students can send one of two pace signals:
- **Slow down** — the class is moving too fast
- **Ready to move on** — the student is ready for the next topic

The admin dashboard shows a live count of each signal. Admins can reset the counts at any time.

---

## Analytics Dashboard

The analytics page (`/admin/analytics`) has two views:

**Per-session view** — select a specific class session to see:
- Each student's duration, hand raise count, pace signals, and engagement score
- Sortable columns: Name (alphabetical), Duration, Hand Raises, Score
- Hover over bars in the pace signal chart to see student names

**All-sessions view** — aggregated across all sessions for a class template:
- Shows preferred name, email, total duration, total hand raises, and cumulative score
- Anonymous students and one-off columns (check-in/out times, pace signals) are omitted

**Engagement score** — displayed per student, max 100 points:
- Attendance: up to 50 pts (timestamped check-in)
- Hand raises: up to 30 pts (10 pts each, capped at 3)
- Pace signal participation: up to 20 pts

Hover the info icon (ⓘ) next to the score header in the UI for an explanation.

---

## Test Data / Seed Scripts

To populate the app with realistic fake data for testing the analytics dashboard:

```bash
cd checkhen

# Create a ClassTemplate and N sessions (spaced weekly), each with fake students,
# check-ins, hand raises, and pace signals
yarn seed --sessions=5

# Remove all generated test data
yarn seed:clean
```

---

## Running on a Raspberry Pi

You can run CheckHen on a Raspberry Pi 3B+ or better. This is useful for running the app on a local classroom network without internet access, using RaspAP to create a WiFi access point.

### Prerequisites
- Raspberry Pi 3B+ or newer
- USB WiFi dongle that supports AP mode
- microSD card with Raspberry Pi OS installed

The `pi-setup/` directory contains shell scripts that automate the full Pi configuration.

### First-time setup (run once)

```bash
git clone https://github.com/a1icja/checkhen.git
cd checkhen
sudo ./pi-setup/install.sh
```

`install.sh` installs `hostapd` and Docker, copies the systemd unit files, and makes the exam scripts executable. After it finishes, follow the printed instructions:

1. Edit `/etc/hostapd/hostapd-exam.conf` — set your SSID and passphrase.
2. Edit `dns/allowlist.conf` — update the `checkhen.local` IP to match your Pi's `wlan0` address (`ip addr show wlan0`).
3. Set your environment variables and start the app (see [Production Mode](#production-mode)):
   ```bash
   docker compose up --build -d
   ```

### Starting and stopping exam mode

Exam mode brings up the WiFi access point, NAT rules, and DNS filter — students connected to the Pi's network can only reach CheckHen.

```bash
# Start exam mode (AP + DNS filtering)
sudo ./pi-setup/start-exam.sh

# Stop exam mode
sudo ./pi-setup/stop-exam.sh
```

**4. Access the app:**
Connect to the Raspberry Pi's WiFi network and navigate to `http://<pi-wlan0-ip>:3000` in a browser.

---

## Known Issues

- **Admin dashboard socket connection:** The admin dashboard may require a manual page refresh after first load to fully connect to the socket server.

- **NextAuth PKCE / hot-reload bug:** State cookies set during OAuth can fail to survive the redirect when Next.js hot-reloads mid-auth. If you see a "state mismatch" or similar error during sign-in in `yarn dev`, use `yarn build && yarn start` instead.

- **Docker rebuild migrations:** After running `docker compose up --build`, apply any pending migrations inside the container:
  ```bash
  docker exec 490-test npx prisma migrate dev --name add_performance_indexes
  ```

## License

CheckHen is licensed under the GNU Affero General Public License, version 3 or later
(`LICENSE`). Anyone who runs a modified version as a service must offer its source to
the people who use it.
