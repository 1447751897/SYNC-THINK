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
`/account`, and `/demo`. The homepage embeds `/demo` with an iframe sandbox;
the demo also works in its own window. Cross-site embedding requires the cloud
service's `CLOUD_EMBED_ORIGINS` setting. Demo interactions use synthetic state
and never call models, tools, or authentication services.

To exercise the actual sandboxed iframe regression, start the server and set
`SYNC_THINK_DEMO_TEST_URL=http://127.0.0.1:4175/` before the website tests.
That optional browser test uses the workspace's Playwright and Edge on Windows.

Production assets are explicitly selected in `build.mjs`. The painted background
is an original generated image; its WebP is used for delivery. Instrument Serif
comes from Google Fonts and its OFL license is included in `assets/`.

Visual references and prompts live under
`docs/design-explorations/cloud-website-2026-09-07/`. The active hero reference is
`05-hero-painted-concept.png`, with `07-faq-footer-painted-concept.png` for the
lower page and `03-login-concept.png` for account forms. Earlier photographic
concepts were rejected and are historical explorations only.
