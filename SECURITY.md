# Security Policy

## Reporting a Vulnerability

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, use [GitHub's private vulnerability reporting](https://github.com/codexstar69/pi-pompom/security/advisories/new).

## Scope

This extension runs in the Pi CLI process and has access to `process.stdout` and terminal input. Relevant concerns:

- Escape sequence injection via crafted speech text or particle data
- Denial of service via runaway rendering loops
- Input handler consuming keystrokes meant for the host application

## Response Timeline

- Acknowledgment within 48 hours
- Assessment within 7 days
- Patch within 14 days for confirmed vulnerabilities
