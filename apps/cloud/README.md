# SYNC-THINK Cloud Account Service

This is a separate, self-hosted account service and public website. It uses Node.js,
Better Auth, a dedicated SQLite database, and SMTP. Local desktop projects,
conversations, provider keys, and task execution stay in the desktop Runtime.
Signing in to this website does not sign in to or synchronize the desktop app.

## Development

The workspace pins Node.js 20.20.2 and pnpm 10.28.2. Use the managed `pnpm`
commands; cloud dependencies require Node.js 20.19 or newer within Node 20.
The workspace pins Kysely 0.28.17 because its 0.29 line requires Node 22.

From the repository root:

```sh
pnpm install
pnpm dev:cloud
```

Open `http://127.0.0.1:4175`. With no auth secret configured, the website renders
and account requests return `AUTH_NOT_CONFIGURED`; no placeholder accounts exist.
Copy `.env.example` to `apps/cloud/.env`, generate a random secret, and configure
SMTP to exercise email verification and password reset. The entrypoint reads only
`apps/cloud/.env`; existing process environment takes precedence.

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
pnpm --filter @sync-think/cloud test
pnpm --filter @sync-think/cloud typecheck
```

Use `CLOUD_PORT` and `CLOUD_ORIGIN` together for a different port. A browser must
use the configured origin exactly, including `127.0.0.1` versus `localhost`.

The `/demo` ChatApp imports the desktop's actual React components, shell CSS, and
font subsets. Install workspace development dependencies before running
`pnpm build:cloud`; the website build reads workspace source exports directly and
does not require an Electron build or previously generated package `dist` files.
Only static assets are deployed to `apps/website/dist`. The 13 demo scenes use an
isolated memory-only bridge: no model, shell, filesystem, or account operations.
The demo CSP allows inline styles for CodeMirror while still blocking connections,
inline scripts, and form submissions. Other pages keep their existing CSP.

The homepage embeds three real desktop pages: `/demo.html?view=kernels`,
`/demo.html?view=agents`, and `/demo.html?view=teams`. Their tabs reuse
`KernelUpdatePanel`, `ModelPickerMenu`, `AgentLibrary`, and `TeamLibrary` from
the desktop renderer. Agent/team edits and reset operate in a separate memory-only
session. Starting a conversation carries the selected identity, model and roster
into ChatApp, with a return action. Kernel versions are explicitly demo fixtures;
no detection, update downloads, or runtime execution reaches the host machine.

## HTTP Contract

| Route                                    | Behavior                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /api/health`                        | Process liveness, `{ "status": "ok" }`                                                     |
| `GET /api/config`                        | `{ registrationEnabled, emailEnabled }`; configuration state, not SMTP delivery validation |
| `POST /api/auth/sign-up/email`           | `name`, `email`, `password`, optional `callbackURL`; requires registration flag and SMTP   |
| `GET /api/auth/verify-email`             | Better Auth verification link; verifies email and redirects to trusted callback            |
| `POST /api/auth/sign-in/email`           | `email`, `password`, optional `rememberMe`; requires verified email                        |
| `GET /api/auth/get-session`              | User/session metadata or `null`                                                            |
| `POST /api/auth/sign-out`                | Invalidates the current session                                                            |
| `POST /api/auth/send-verification-email` | `email`, optional `callbackURL`                                                            |
| `POST /api/auth/request-password-reset`  | `email`, `redirectTo` set to `/reset-password`                                             |
| `GET /api/auth/reset-password/:token`    | Email link redirect to the password reset form                                             |
| `POST /api/auth/reset-password`          | `token`, `newPassword`; consumes the link and revokes all sessions                         |
| `POST /api/auth/change-password`         | `currentPassword`, `newPassword`, optional `revokeOtherSessions`                           |
| `GET /account`                           | Server validates the cookie; visitors redirect to `/login?next=%2Faccount`                 |

POST requests require `Content-Type: application/json` and the exact configured
`Origin`. Bodies are limited to 16 KiB. Errors use `{ code, message }`.
Configuration gates return `AUTH_NOT_CONFIGURED` (503), `EMAIL_NOT_CONFIGURED`
(503), or `REGISTRATION_DISABLED` (403). Authentication uses HttpOnly SameSite=Lax
cookies, with Secure on HTTPS. Session tokens are removed from JSON responses.
Passwords require 12 to 128 characters. Reset links expire after 30 minutes;
verification links expire after one hour. Sessions expire after seven days.

Only declared HTML routes, declared JS/CSS files, and supported assets below
`/assets/` are served from `apps/website/dist`. Realpath checks reject symlinks or
junctions that leave that directory. Databases, `.env`, source files, and directory
listings are not static resources. `/account` is guarded on the server.

## Embedding the Demo

`GET /demo` serves the independent interactive product demo. Its projects,
messages, model choices, and task outcomes are synthetic samples; interactions
stay inside the demo and do not invoke models, real tools, account APIs, or the
local Runtime. `/demo.js`, `/demo.css`, and local image/icon assets support it.

Only `/demo` is frameable. By default it sends `X-Frame-Options: SAMEORIGIN` and
`Content-Security-Policy: frame-ancestors 'self'`, so the homepage can embed it.
To allow specific other parent sites, set:

```dotenv
CLOUD_EMBED_ORIGINS=https://portal.example.com,https://docs.example.com
```

Each value must be an exact HTTPS origin, with no credentials, path, query,
fragment, or wildcard. Development additionally permits loopback HTTP origins
such as `http://localhost:3000`. Restart the cloud service after changing the list.
With a nonempty list, `/demo` omits X-Frame-Options and uses CSP `frame-ancestors`
with `'self'` plus the explicit origins. Every ancestor in a nested embedding
chain must be permitted. This uses modern browser CSP enforcement.

```html
<iframe
  src="https://HOST/demo"
  title="SYNC-THINK 交互演示"
  loading="lazy"
  sandbox="allow-scripts allow-same-origin"
  width="100%"
  height="720"
  referrerpolicy="no-referrer"
></iframe>
```

The demo's CSP permits its local scripts, styles, and images and sets
`connect-src 'none'` and `form-action 'none'`. `HEAD /demo` and `HEAD /demo.html`
use the same headers; `/demo/` and encoded route aliases return 404. Login, account,
authentication API, and all other routes retain frame denial even when an embed
allowlist is configured. The embedding site may also need `frame-src` permission
for this service's origin in its own CSP.

## Linux Deployment

Use a dedicated service account and one Node process for the cloud service.
This service is independent of the Windows-only production credential backend in
the local Agent Runtime. Keep the account database outside website directories.

```sh
pnpm install --frozen-lockfile
pnpm build:cloud
NODE_ENV=production pnpm --filter @sync-think/cloud start
```

Set these in the service's environment or protected `apps/cloud/.env`:

```dotenv
NODE_ENV=production
CLOUD_ORIGIN=https://your-domain.example
CLOUD_HOST=127.0.0.1
CLOUD_PORT=4175
CLOUD_AUTH_SECRET=<generated-persistent-secret>
CLOUD_DB_PATH=/var/lib/sync-think-cloud/auth.sqlite
CLOUD_ALLOW_SIGNUP=true
CLOUD_TRUST_PROXY=true
CLOUD_SMTP_HOST=smtp.your-provider.example
CLOUD_SMTP_PORT=587
CLOUD_SMTP_SECURE=false
CLOUD_SMTP_USER=<smtp-user>
CLOUD_SMTP_PASSWORD=<smtp-password>
CLOUD_SMTP_FROM=SYNC-THINK <accounts@your-domain.example>
```

The service account needs read access to the deployment and write access only to
its data directory. Protect the environment file with mode 600. The service creates
the database parent with mode 700 and database with mode 600. TLS SMTP is required;
configure your provider's verified sender domain and SPF/DKIM records. Mail work is
tracked asynchronously to avoid account enumeration through delivery timing. A
`cloud.email.delivery_failed` log means a delivery attempt failed; logs omit
recipient addresses, passwords, links, and tokens. Validate delivery with a test
mailbox before opening registration. The resend flow handles verification mail
retries; submitted reset requests always preserve account enumeration protection.

Terminate public HTTPS at a reverse proxy and bind Node to loopback. Example Nginx
location inside an existing HTTPS server block:

```nginx
location / {
    proxy_pass http://127.0.0.1:4175;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    client_max_body_size 16k;
    proxy_read_timeout 30s;
}
```

With `CLOUD_TRUST_PROXY=true`, the service accepts `X-Real-IP` only from a loopback
TCP peer and overwrites the internal client-IP header. Keep the origin port private
and have the proxy overwrite that header. Better Auth's rate limits use SQLite:
five sign-in attempts, three registration/reset-mail/verification-mail requests,
and five password-reset submissions per IP per minute. Other auth requests have
a 60-per-minute limit. An additional capped in-memory budget limits all auth paths
together to 120 requests per IP per minute, including varying reset-link paths.
Both layers normalize IPv6 addresses to a /64 subnet. Retain the database and persistent auth secret across
restarts; deleting or rotating them changes account/session availability.

The proxy's access logs must omit query strings on auth and password-reset routes
because email links carry short-lived tokens. For Nginx use a log format based on
`$request_method $uri $server_protocol`, not `$request` or `$request_uri`.

For a consistent backup, stop the service and back up the entire data directory,
or use SQLite's online backup facility while it runs. Do not copy only the database
file from an active WAL database. Back up the auth secret separately. Before a
dependency upgrade, take a consistent backup and validate migrations against a
copy: the pinned Better Auth migration API creates its required tables at startup.
Rollback restores the matching code, database backup, and secret together.

`SIGTERM`/`SIGINT` stop new traffic, drain active requests and pending mail, then
close the database. Set a service stop timeout of at least 45 seconds. Monitor
`/api/health`, process restarts, generic error events, disk space, and SMTP delivery.
Billing, team membership, cloud task execution, sync conflict handling, desktop
device login, and an administration console are separate subsequent features.

## Validation

HTTP integration tests use temporary real SQLite databases and an injected email
delivery boundary. They exercise actual Better Auth handlers, hashing, email links,
cookies, registration gates, protected pages, password reset, and HTTP security.
They do not send real mail or assert deployment TLS, DNS, deliverability, backup
restoration on the target server, or desktop account binding.

Primary references: [Better Auth email/password](https://better-auth.com/docs/authentication/email-password),
[SQLite adapter](https://better-auth.com/docs/adapters/sqlite),
[migrations](https://better-auth.com/docs/concepts/database),
[rate limits](https://better-auth.com/docs/concepts/rate-limit).
