# Security

Vault Sync holds the contents of people's notes, so security reports are welcome and taken seriously.

## Reporting a vulnerability

Open a [private security advisory](https://github.com/Kenth06/vault-sync/security/advisories/new) on GitHub. Please do not open a public issue for anything that could expose someone's vault.

Include what you found, how to reproduce it, and what an attacker could do with it. You will get an answer within a week.

## What is in scope

- The Worker (`apps/web/worker`, `apps/api`): authentication, the viewer's session cookie and proxy allowlist, file serving headers.
- The viewer: rendering of Markdown, canvases and embedded files from a vault.
- The CLI and the Obsidian plugin: path handling and anything that could read or write outside the vault folder.

## Hardening your deployment

- Use an `ADMIN_SECRET` of at least 32 random characters (the Worker refuses shorter ones), for example `openssl rand -base64 32`.
- Optionally add a Cloudflare rate-limiting rule for `/v1/devices/*` and `POST /api/session` on your Worker's route.
- Revoke devices you no longer use (`revoke` in the CLI, or **Sign out of this browser** in the viewer).

## Design notes

How tokens, the admin secret, the viewer session and file serving are protected is written down in [docs/decisions.md](docs/decisions.md).
