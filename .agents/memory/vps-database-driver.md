---
name: VPS database driver
description: Why the project must use the standard PostgreSQL driver for compatibility with its VPS deployment.
---

Use the standard Node PostgreSQL driver for database access; do not replace it with the Neon serverless WebSocket driver unless production infrastructure changes.

**Why:** The VPS runs PostgreSQL locally. The Neon WebSocket driver interprets the local database host as a secure WebSocket endpoint, causing TLS hostname mismatch errors and HTTP 500 responses in production.

**How to apply:** When changing database dependencies or merging generated Replit changes, preserve compatibility with both ordinary PostgreSQL connection strings and the hosted development database.