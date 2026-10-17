# Module 4: Security and Authentication

[← Learning path](../LEARNING_PATH.md) · Previous: [Module 3](module-3-backend.md) · Next: [Module 5: Real-time](module-5-realtime.md)

Two different questions, often confused:
- **Authentication**: *who are you?* (login, tokens)
- **Authorization**: *what are you allowed to do?* (e.g. only you can see your portfolio)

Rule zero: **everything in the browser can be read and changed by the user.** Security decisions happen on the server.

---

## 4.1 Password hashing (Argon2), salts, timing attacks

**What it is.** We never store passwords, not even encrypted (encrypted means it can be *decrypted*, and
whoever steals the key gets every password). We store a **hash**: a one-way fingerprint. At login we hash the
typed password again and compare fingerprints.

**How it works.**
- Ordinary hashes (SHA-256) are designed to be **fast**: billions of guesses per second on a GPU. Password hashes
  are designed to be **slow and memory-hungry**, so each guess is expensive. **Argon2id** is the current
  recommendation (OWASP) [security.py:L14](../../backend/app/security.py#L14).
- A real hash from our database:
  ```
  $argon2id$v=19$m=65536,t=3,p=4$/QahGTOdM8J…   (97 characters)
  algorithm  ver  64 MB memory, 3 passes, 4 lanes   salt$hash
  ```
  The **salt** is random per user and stored inside the string. Two users with the same password get different
  hashes, so precomputed "rainbow tables" are useless.
- **Timing attack:** if login answered *faster* for unknown emails (no hash to check), an attacker could measure
  response times and learn which emails are registered. We hash against a dummy value in that case
  [security.py:L18](../../backend/app/security.py#L18) [security.py:L27-L31](../../backend/app/security.py#L27-L31), and return the same
  error message for both cases.

**Why we chose it.** Argon2id via `pwdlib`: modern default parameters, and the parameters are stored in the hash
string, so they can be raised later without breaking old accounts.

**How it helps.** Even if the database file leaks, passwords can't be read, and guessing them is very slow.

**At large scale.** Hashing is deliberately **CPU + memory heavy** (64 MB per login here!). A login spike or a
credential-stuffing attack can exhaust servers. Rate-limit login per IP/account (Backlog #25), size login servers
for it, consider a separate auth service, and offer passkeys / social login.

**Interview angle.** *"Why not encrypt passwords? Why not SHA-256?"* Encryption is reversible; SHA-256 is too fast.
*"What is a salt?"* Per-user randomness, stored with the hash, which defeats precomputed tables.
*"How do you avoid revealing which emails exist?"* Same error and same timing for both cases.

---

## 4.2 JWT: structure, signing (HS256 vs RS256), expiry

**What it is.** A **JSON Web Token** is a small signed note: "user 2, session 0600f6…, valid until 15:09". Anyone
can **read** it, but nobody can **change** it without the signature breaking, like a sealed letter in a glass envelope.

**How it works.** Three base64url parts joined by dots: `header.payload.signature`. A real access token from our
app (196 characters) decodes to:
```
header:  {"alg":"HS256","typ":"JWT"}
payload: {"sub":"2","sid":"0600f6cf594f4a1a8bb0a8fa10580978","iat":1792267597,"exp":1792268497}
```
`exp − iat` = 900 seconds = 15 minutes.
- **Signing:** signature = HMAC-SHA256(header + payload, **secret**) [security.py:L34-L42](../../backend/app/security.py#L34-L42).
  On every request the server recomputes it; a single changed character in the payload gives a different signature
  → rejected [security.py:L45-L47](../../backend/app/security.py#L45-L47).
- **HS256** (symmetric): the same secret signs and verifies. Fine when one party (our backend) does both. The secret
  comes from `JWT_SECRET` [config.py:L14](../../backend/app/config.py#L14), and leaking it means anyone can mint tokens (Backlog #23).
- **RS256** (asymmetric): a **private key** signs, a **public key** verifies. Google signs ID tokens this way; we can
  verify them but never create them (4.5).
- **Never put secrets in the payload**: it's only encoded, not encrypted.

**Why we chose it.** Verifying a JWT needs no database lookup in principle, so it's fast and stateless. We *add* one
cheap lookup (is session `sid` still active?) [deps.py:L23-L44](../../backend/app/deps.py#L23-L44) so that
logout and "logged in elsewhere" take effect immediately.

**How it helps.** Any backend instance can validate any token (they share the secret), with no shared memory needed.

**At large scale.** Rotate signing keys (a `kid` header + several valid keys); move to asymmetric keys so many services
can verify without being able to sign; cache the session check in Redis; keep access tokens short-lived so revocation gaps stay small.

**Interview angle.** *"Can a user edit their JWT to become admin?"* They can edit it, but the signature check fails.
*"How do you log someone out with stateless JWTs?"* Short expiry + revocable refresh token; or a session/denylist
check like ours. *"HS256 vs RS256?"* Shared secret vs public/private key pair.

---

## 4.3 Access + refresh tokens, sessions, revocation

**What it is.** Two keys for two jobs. Hotel analogy: the **access token** is a day pass checked at every door
(short-lived, shown often), and the **refresh token** is the booking confirmation kept in the safe (long-lived,
shown only at reception to get a new day pass).

**How it works.**
- **Access token**: JWT, 15 minutes, held **only in memory** in the browser [auth.service.ts:L42](../../frontend/src/app/core/auth/auth.service.ts#L42).
- **Refresh token**: 256 random bits, *not* a JWT [security.py:L77-L79](../../backend/app/security.py#L77-L79), in an
  httpOnly cookie for 7 days. The database stores only its **SHA-256 hash** [security.py:L82-L84](../../backend/app/security.py#L82-L84).
  SHA-256 is fine *here* (unlike passwords) because the token is random and long, so it can't be guessed.
- **Sessions table:** one row per login. A new login revokes the user's other sessions
  [auth.py:L110-L115](../../backend/app/routers/auth.py#L110-L115); logout revokes the current one.
- **Refresh** [auth.py:L172-L186](../../backend/app/routers/auth.py#L172-L186): valid, unexpired, unrevoked session →
  new access token.
- **Page reload:** memory is wiped, so the app calls `/refresh` at startup and the cookie restores the login (ANGULAR guide §25).

**Why we chose it.** A stolen access token works for at most 15 minutes. The long-lived secret is never readable by
JavaScript and never sent anywhere except `/api/auth/*`.

**How it helps.** Security *and* convenience: users stay logged in for a week without long-lived tokens floating around.

**At large scale / known gap.** We **don't rotate** refresh tokens (Backlog #19): a stolen cookie works until it expires
or the user logs in again. Best practice is rotation (a new refresh token on every use) + **reuse detection** (if an
old one shows up again, revoke the whole session family), with a short grace window so two tabs refreshing at once
don't log each other out. That race is exactly why we skipped it for now.

**Interview angle.** *"Why two tokens?"* Short exposure for the frequently-sent token; revocable long-term login.
*"Where do you store each?"* Memory / httpOnly cookie, and why not localStorage (0.5). *"What does rotation solve?"* Detecting a stolen refresh token.

---

## 4.4 XSS, CSRF, cookie flags, open redirects

**What it is.** The common web attacks and their antidotes. (0.5 explained XSS and CSRF; this is the checklist.)

| Attack | What the attacker does | Our defence |
|---|---|---|
| **XSS** | Runs their JavaScript inside our page | Angular escapes `{{ }}` output by default; refresh cookie `HttpOnly`; access token only in memory, 15 min |
| **CSRF** | Makes your browser send a request with your cookies from their site | `SameSite=Strict` [auth.py:L66-L75](../../backend/app/routers/auth.py#L66-L75) |
| **Open redirect** | `…/login?returnUrl=https://evil.com`, so after login you land on a fake site | Only same-app paths allowed [login.ts:L193](../../frontend/src/app/features/auth/login.ts#L193) |
| **SQL injection** | Puts SQL into input fields | Parameterised queries via SQLAlchemy (3.5) |
| **Credential stuffing** | Tries leaked email/password lists | Slow hashing today; rate limiting is missing (Backlog #25) |
| **Token theft from the DB** | Steals the database file | Passwords Argon2-hashed, refresh tokens SHA-256-hashed |

**Why we chose it / how it helps.** Each defence is cheap and removes a whole class of attack.

**At large scale.** Add a **Content-Security-Policy** header (only our scripts + `accounts.google.com`, Backlog #30), HTTPS
everywhere with HSTS, security headers fixed in nginx (Backlog #14), dependency scanning, a WAF in front, and
audit logs for logins.

**Interview angle.** *"Your app uses cookies. How do you stop CSRF?"* SameSite (+ CSRF tokens if cross-site).
*"How do you stop XSS?"* Escaping by default, never `innerHTML` with user data, CSP, HttpOnly cookies.

---

## 4.5 OAuth 2.0 / OpenID Connect and "Sign in with Google"

**What it is.** **OAuth 2.0** lets an app get *permission* to act on your behalf without your password ("let this
app read my calendar"). **OpenID Connect (OIDC)** adds *identity* on top: an **ID token** that says "this is
user X, email Y, verified by Google". Login with Google uses OIDC.

**How it works in our app.**
1. Google's button (their script, their iframe) asks you to choose an account in a Google popup.
2. Google gives our page an **ID token**: a JWT signed by Google with RS256, containing `iss` (Google), `aud`
   (**our** client ID), `sub` (your permanent Google user id), `email`, `email_verified`, `exp`.
3. The page sends it to `POST /api/auth/google`. The backend verifies [security.py:L56-L74](../../backend/app/security.py#L56-L74):
   the signature uses one of Google's current public keys (downloaded from Google and cached); `aud` must be our
   client ID, so a token Google issued to *another* website is useless here; `iss` must be Google; it must not be expired.
4. Find the user by `sub`, else link by verified email, else create one [auth.py:L138-L168](../../backend/app/routers/auth.py#L138-L168).
5. From then on it's **our** normal session (4.3). Google's token is used once and thrown away.

**Why we chose it.** The ID-token flow needs no client secret and reuses our whole session system. The alternative
(authorization-code redirect flow with a secret) is more work and only needed if we want Google API access or no
third-party script on the page.

**How it helps.** Users skip creating a password; we never handle their Google password at all.

**At large scale.** More providers (Apple, GitHub) → a library (Authlib) or an identity provider (Auth0, Cognito,
Keycloak). Account linking rules become a product decision. Watch the dependency on Google's availability: keep
password/passkey login as a fallback.

**Interview angle.** *"OAuth vs OIDC?"* Authorization (access to resources) vs authentication (who the user is).
*"How do you know the ID token is genuine and meant for you?"* Signature with Google's public keys + `aud` +
`iss` + `exp`. *"Why `sub` and not email as the key?"* Emails can change or be reassigned; `sub` never changes.
*"What's the `aud` check for?"* Stops a token issued to another site from being replayed against yours.
