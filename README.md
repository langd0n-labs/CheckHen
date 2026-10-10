# CheckHen

CheckHen runs classroom check-in, chat, hand raising, and pace signals on an
instructor's computer. It uses Next.js, Socket.IO, PostgreSQL, and Prisma.

## Start the application

Install Podman, a Compose provider (podman-compose), and Python 3. On macOS or
Windows, initialize and start the Podman machine first. From a clean clone:

```sh
python3 scripts/start.py
```

On Windows use `py -3 scripts/start.py`. The command creates an ignored `.env`
with random local database and session secrets, builds the images, applies
database migrations, and starts the stack. Open http://localhost:3000.
The initial build needs internet access. Google sign-in requires the setup below.

The database is not published on a host port. App and socket ports bind to
loopback by default. Do not bind them to the uplink for classroom use.

Stop with `podman compose down`. Data stays in the named database volume.
Run the start command again after changing build-time settings
(`NEXT_PUBLIC_EMAIL_DOMAIN` or `NEXT_PUBLIC_SOCKET_URL`).

## Google sign-in and classroom HTTPS

Use a Google OAuth **Web application** client. For the configurable test
hostname `checkhen.rfkill.dev`, register:

- JavaScript origin: `https://checkhen.rfkill.dev`
- Redirect URI: `https://checkhen.rfkill.dev/api/auth/callback/google`

Set `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and `NEXTAUTH_URL` in the local
root `.env`. Never commit credentials. The default Workspace domain is
`bu.edu`. Existing admin configuration uses comma-separated usernames
(without `@bu.edu`) in `ADMIN_EMAILS`.

For a local-only Google test, register
`http://localhost:3000/api/auth/callback/google` as an additional redirect URI.
This does not test captive-portal sign-in from a student device.

Use Let's Encrypt DNS-01 for the classroom certificate. The ACME client
provides a TXT value for `_acme-challenge.checkhen.rfkill.dev`. A public A
record and inbound internet access to the classroom server are not required
for DNS-01. Classroom DNS must resolve the hostname to the AP address.
The hostname is deployment configuration, not a fixed application identity.

References:
[Google OAuth](https://developers.google.com/identity/protocols/oauth2/web-server),
[Let's Encrypt DNS-01](https://letsencrypt.org/docs/challenge-types/#dns-01-challenge).

## Acceptance checks

See [the build log](docs/build-log.md) for results and pending checks.
See [operator checks](docs/operator-checks.md) for macOS and Windows procedures.

## Development

Use Node.js 22 and Corepack. In `checkhen/`:

```sh
corepack yarn install --immutable
corepack yarn prisma generate
corepack yarn jest --runInBand
corepack yarn typecheck
```

Set `DATABASE_URL` for your development PostgreSQL instance. Use
`corepack yarn prisma migrate deploy` to apply committed migrations.
The canonical schema is `checkhen/prisma/schema.prisma`; synchronize the
socket copy with `corepack yarn prisma-gen` in `socket-server/` after a change.

Grafana is removed. The application has an analytics interface at
`/admin/analytics`.

## License

CheckHen is licensed under the GNU Affero General Public License, version 3 or later
(`LICENSE`). Anyone who runs a modified version as a service must offer its source to
the people who use it.
