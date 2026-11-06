# CheckHen project guidance

When a change breaks an existing test, update that test for the new behavior.
Do not delete or replace an existing test suite without asking the operator first.

Run installs, typecheck, tests, and builds in the development container, not with the host's Node: `scripts/dev-container yarn install --immutable`, `scripts/dev-container yarn jest`, and `scripts/dev-container ../scripts/test-postgres.sh`. Pass `--podman` to `launch_codex_bg.sh` for a sandboxed Codex run that needs them.
