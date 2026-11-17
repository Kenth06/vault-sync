# Vendored skill

- Source: https://github.com/cloudflare/security-audit-skill (`skills/security-audit`)
- Commit: c1c8a8c (2026-09-14, "Clarify guidance and full audit modes")
- License: MIT, see `LICENSE`

Update by re-copying `skills/security-audit` from a newer commit and changing the commit line above. Do not edit the vendored files in place.

## Platform note

The validators (`validate-findings.cjs`, `validate-coverage-ledger.cjs`) open files with `O_NOFOLLOW | O_NONBLOCK` and fail closed where those flags do not exist. On native Windows they refuse to run, so full audit mode (which requires both validators) must run under WSL, Linux or macOS. Guidance mode works everywhere. This is upstream behavior and is intentional.
