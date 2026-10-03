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
