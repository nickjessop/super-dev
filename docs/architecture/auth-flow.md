---
title: Authentication & Session Lifecycle
---

# Authentication & Session Lifecycle

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Client as Web App
  participant Auth as Auth Service
  participant DB as User Store
  participant Cache as Session Cache

  User->>Client: Submit credentials
  Client->>Auth: POST /auth/login
  Auth->>DB: Query user record & verify bcrypt hash
  DB-->>Auth: User record valid
  Auth->>Cache: Store session token with 7d TTL
  Cache-->>Auth: OK
  Auth-->>Client: Set HttpOnly JWT cookie
  Client-->>User: Redirect to dashboard
```

## 1. Credentials Submission
Status: existing
Summary: Client collects user credentials over TLS.

## 2. Token Generation
Status: existing
Summary: Cryptographically signed JWT issued with 7-day expiration.

## 3. Session Cache
Status: new
Summary: Low-latency Redis cluster for active session invalidation on logout.
