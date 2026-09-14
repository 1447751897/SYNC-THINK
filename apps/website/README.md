# SYNC-THINK Website

Static public website, cloud account UI, and a standalone interactive demo.
The site uses the shared token JSON and ships no frontend framework runtime.

From the repository root:

```sh
pnpm dev:cloud
pnpm build:cloud
pnpm test:cloud
```

The server serves the generated `dist/` at `http://127.0.0.1:4175/`.
Account setup and deployment are documented in `../cloud/README.md`.
Website source changes require `pnpm --filter @sync-think/website build` before refresh.

Routes: `/`, `/login`, `/register`, `/forgot-password`, `/reset-password`,
`/account`, `/demo`, and `/demo.html`. The homepage embeds `/demo.html` with an
iframe sandbox; the demo also works in its own window. Cloud also serves `/demo`.
the demo also works in its own window. Cross-site embedding requires the cloud
service's `CLOUD_EMBED_ORIGINS` setting. Demo interactions use synthetic state
and never call models, tools, or authentication services.

To exercise the actual sandboxed iframe regression, start the server and set
`SYNC_THINK_DEMO_TEST_URL=http://127.0.0.1:4175/` before the website tests.
That optional browser test uses the workspace's Playwright and Edge on Windows.

Production assets are explicitly selected in `build.mjs`. The painted backgrounds are original generated images. The alpine hero ships as
WebP; chat / kernels / agents / teams demos each have a distinct meadow, cloud,
flower, or grassland JPEG; the closing band and footer use a separate meadow
WebP. PNG sources stay in `assets/` and are not copied to `dist`. Kernel marks
under the Windows download live in `assets/kernels/`. Instrument Serif comes
from Google Fonts and its OFL license is included in `assets/`.

Visual references and prompts live under
`docs/design-explorations/cloud-website-2026-09-07/`. The active hero reference is
`05-hero-painted-concept.png`, with `07-faq-footer-painted-concept.png` for the
lower page and `03-login-concept.png` for account forms. Earlier photographic
concepts were rejected and are historical explorations only.
