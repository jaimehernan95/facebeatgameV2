# Security Specification — FaceBeat Arcade Persistent Memory

## 1. Data Invariants
1. **Strict Ownership:** `/users/{userId}` and all subcollections (`/favoriteTracks/{trackKey}`, `/sessions/{sessionId}`) are strictly private to the verified authenticated owner (`request.auth.uid == userId && request.auth.token.email_verified == true`).
2. **Master Gate:** Subcollection writes (`favoriteTracks`, `sessions`) verify that the parent `/users/{userId}` document exists and is owned by `request.auth.uid`.
3. **Immutable History & Creation Timestamps:** `createdAt` is pinned to `request.time` on creation and cannot be mutated on update. `sessions` documents are append-only (`allow update: if false`).
4. **No Ghost Fields & Strict Bounds:** Every entity enforces exact key sets (`hasAll` + `hasOnly` on create; `affectedKeys().hasOnly(...)` on update), bounded strings, numeric range clamps, and bounded arrays (`tasteTags.size() <= 12`, `tasteCentroid.size() <= 32`, `tasteVector.size() <= 32`).
5. **No Blanket List Scraping:** `/users` prohibits `list`; subcollections enforce `resource.data.uid == request.auth.uid` on `list`.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Profile Read:** Unauthenticated `get(/users/alice)` -> DENIED.
2. **Cross-User Profile Read:** User `bob` reads `/users/alice` -> DENIED.
3. **Blanket User List Scrape:** User `bob` lists `/users` -> DENIED.
4. **UID Spoofing on Profile Create:** User `bob` creates `/users/bob` with `uid: "alice"` -> DENIED.
5. **Unverified Email Write:** User with `email_verified: false` attempts to create `/users/bob` -> DENIED.
6. **Ghost Field / Privilege Escalation:** User `bob` creates `/users/bob` including `isAdmin: true` -> DENIED.
7. **Timestamp Forgery:** User `bob` creates `/users/bob` with a backdated `createdAt` (`!= request.time`) -> DENIED.
8. **Out-of-Bounds Thresholds / Latency:** User `bob` updates `audioOffsetMs: 99999` or `mouthThreshold: 5.0` -> DENIED.
9. **Oversized Array / Denial of Wallet:** User `bob` writes `tasteVector` with 500 elements or `tasteSummary` > 600 chars -> DENIED.
10. **Orphan Subcollection Write:** User `bob` creates `/users/bob/favoriteTracks/yt_abc` without existing `/users/bob` -> DENIED.
11. **Session History Tampering:** User `bob` updates an existing `/users/bob/sessions/s1` to inflate `score: 999999` -> DENIED.
12. **Invalid Path ID Injection:** User `bob` writes to `/users/bob/favoriteTracks/bad$id!!` -> DENIED.
