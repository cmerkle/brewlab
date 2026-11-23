# Security

Brewlab is a single-user, self-hosted app with **no authentication**. Treat network access to it as full access to its data.

- Keep it on a private network or VPN, or behind a reverse proxy that requires authentication.
- AI provider keys entered in the app are stored in `/data/secrets.json` (owner-only permissions) and are never returned by the API.
- The link importer refuses private, loopback and link-local addresses (checked on every redirect) so a pasted link can't reach your LAN.

Found a vulnerability? Please open a GitHub security advisory on this repository rather than a public issue.
