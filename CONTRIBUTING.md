# Contributing to CheckHen

## Data rule

The CheckHen source code is public. CheckHen data is private, for every
deployment. Private data includes rosters, student names and email addresses,
photos, attendance, chat messages, cold-call and check answers, and
office-hours visits.

- Never put real CheckHen data in this repository: code, tests, fixtures,
  screenshots, issues, pull requests, commit messages, or logs.
- Use synthetic data only. The demo seed (`checkhen/lib/demo.ts`) shows the
  style: made-up people at `demo.checkhen.invalid` addresses.
- If you find real data in the repository or in an issue, do not copy it.
  Report it with **Report a vulnerability** (see below).
- Never commit credentials or `.env` files.

## Set up

[The README](README.md) has the full setup steps.

- Install Podman, a Compose provider (podman-compose), Python 3, and Node.js 22
  with Corepack.
- Run the full stack with `python3 scripts/start.py`, then open
  http://localhost:3000. Google sign-in needs your own OAuth client; the
  README says how to set one up.
- To look around without a Google client, use the public demo at
  https://checkhen.langd0n.com. Everyone in it is fictional.

For application work, in `checkhen/`:

```sh
corepack yarn install --immutable
corepack yarn prisma generate
```

## Run the tests

Run these before you open a pull request. In `checkhen/`:

```sh
corepack yarn typecheck
corepack yarn jest --runInBand
```

The database integration tests need a local PostgreSQL server that you can
drop and create databases on. From the repository root:

```sh
CHECKHEN_TEST_PG_ADMIN_URL=postgresql://USER:PASSWORD@localhost:5432/postgres \
  scripts/test-postgres.sh
```

The script accepts only `localhost` or `127.0.0.1`. It drops and recreates the
`checkhen_test` and `checkhen_legacy_test` databases.

If you change the Slidev chat component, also run `scripts/test-slidev-chat.sh`.
If you change the classroom network tools, also run
`python3 -m unittest discover network/laptop`.

When a change breaks an existing test, update that test for the new behavior.
Do not delete or replace an existing test suite without asking a maintainer
first.

## Branches and pull requests

1. Fork the repository.
2. Create a branch from `main` with a short descriptive name, for example
   `roll-call-names`.
3. Keep each pull request to one change. Write a commit message that says
   what the change does.
4. Open a pull request against `main`. Say what changed, how you tested it,
   and which issue it closes, if any.
5. A maintainer reviews every pull request before it merges.

If you change the database schema, add a migration under
`checkhen/prisma/migrations/` and run `corepack yarn prisma-gen` in
`socket-server/` to update its copy of the schema.

## Report problems

File bugs and ideas as [GitHub issues](https://github.com/langd0n-labs/CheckHen/issues).
Report a security problem with **Report a vulnerability** on the repository's
[Security tab](https://github.com/langd0n-labs/CheckHen/security), not in a public issue.

## License

CheckHen is licensed under the GNU Affero General Public License, version 3 or
later. You contribute your changes under the same license.
