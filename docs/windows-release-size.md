# Windows release footprint

## Packaging rules

- The desktop renderer and preload are bundled before production deployment. Renderer-only libraries belong in `devDependencies`; main-process dependencies remain in `dependencies`.
- The desktop package exports only `dist` and `build` through its `files` allowlist. Without this allowlist, `pnpm deploy` can copy old releases and even its own staging directory before pruning runs.
- The workers package exports only `dist`, excluding local QA screenshots and data.
- Release staging removes owned-package source trees, local `.data`, emitted tests, type declarations and source maps. Workspace source and development outputs are not deleted. Third-party runtime files are preserved.
- The Claude SDK's bundled Windows executable remains included because the adapter supports it as a fallback when no private kernel is active. Removing it requires a separate kernel-distribution change.

## Measured local candidate (2026-09-07)

| Metric              | Previous beta.1 | Optimized beta.1 |
| ------------------- | --------------: | ---------------: |
| Installer EXE bytes |     313,785,564 |      224,551,773 |
| Unpacked bytes      |   1,178,542,398 |      899,762,600 |
| Unpacked file count |          43,009 |           17,359 |

The EXE is 28.4% smaller and the unpacked file count is 59.6% lower. These are artifact measurements, not an installation-time benchmark. The candidate is unsigned and retains the existing beta version; public sharing artifacts were not replaced.

## Rebuild and validate

```powershell
pnpm --filter @sync-think/desktop build
node --test scripts/windows-portable-release.test.mjs scripts/windows-installer-release.test.mjs
node scripts/windows-portable-release.mjs stage --out apps/desktop/release/win-unpacked-build --signing-mode unsigned-fixture
node scripts/windows-installer-release.mjs build --prepackaged apps/desktop/release/win-unpacked-build --signing-mode unsigned-fixture
node scripts/windows-installer-release.mjs verify --allow-unsigned-fixture
```

Use the signed release configuration for public signed releases. Before replacing an installer, keep the previous known-good installer and verify its hash. Generated unpacked and staging directories can be removed after validation, provided no running process uses them. Do not delete installed user data, kernel installations, rollback archives or user backups as part of build cleanup.

## Test temporary files

The image-preview tests create an oversized image fixture of roughly 25 MiB. Every fixture directory is now removed in `afterEach`, including failed tests, so repeated runs do not accumulate these images in the Windows temp directory. Cleanup of historical fixtures must exclude recent/in-use directories and reparse points.
