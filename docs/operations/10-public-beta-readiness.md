# Public beta readiness — 2026-09-07

## Decision

The initial rc.3 investigation below records the installation-abort fix. The subsequent rc.4 prerelease includes the measured installation-speed improvement described in `11-windows-installer-performance.md`. Repository visibility was rechecked as PUBLIC during rc.4 release preparation on September 7, 2026; the earlier PRIVATE/404 observations below are historical, not the current access state. Anonymous download of the new artifact must still be verified after upload. This remains an unsigned alpha prerelease, not approval for an unrestricted public rollout.

## Confirmed installation defect

- rc.2 downloaded from the browser is byte-identical to the release artifact (SHA-256 `027446ec1a38660a85d5bfb85952863c43f765d1ba74f59b4ffd3684deafce50`).
- NSIS `System::Call` wrote the successful `MoveFileExW` return value to `$4` using `.r4`, but the branch checked `$R4`. Installation could abort after the archive and application had already been written.
- The executable regression harness reproduced exit code 2 despite a byte-identical archive. Changing the return register to `.R4` produces exit code 0. Initial publication, repeated publication, copy failure and atomic-publication failure are covered.
- Installation details and recovery-archive phase messages are now visible. Genuine archive failures still abort; they are not silently treated as success.

## Download access versus installation speed

- At the original investigation, authenticated GitHub inspection reported `PRIVATE` for `1447751897/SYNC-THINK`. The rc.2 release itself was not a draft. At rc.4 release preparation the repository is PUBLIC.
- Anonymous byte-range requests to the rc.2 EXE returned HTTP 404 both directly and through the local proxy. These requests do not measure authenticated download bandwidth. Changing proxy settings does not grant access to a private release.
- The candidate EXE is 204,262,826 bytes; its unpacked payload is 777,439,659 bytes across 10,882 files.
- The pinned NSIS 7z template extracts into the Windows temporary directory, copies the expanded files to the installation directory, and then deletes the temporary files. It also saves the installer cache; the custom hook saves another versioned rollback copy. This creates substantially more file I/O than the EXE size suggests.
- The isolated installer wrote more than 2 GB according to its process I/O counters. A repeated installation measured 399.94 seconds on this machine. The abort fix is not a demonstrated installation-speed improvement.
- Windows reports a healthy SSD. Loaded filesystem filters include 360 and Feilian components. They may amplify per-file overhead, but no disable/enable comparison was performed; their causal contribution is not established.

## Verification evidence

| Check                                             | Result                                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Production build                                  | All 11 packages succeeded                                                                                                      |
| Workspace typecheck                               | Passed                                                                                                                         |
| Portable / installer / compiled NSIS tests        | 35 passed, no skips on this Windows host                                                                                       |
| Desktop installer contract                        | 1 passed                                                                                                                       |
| Artifact manifest, hash and blockmap verification | Passed                                                                                                                         |
| First isolated installation                       | Initial 240-second wait timed out; files and registry subsequently existed, so no successful exit code is claimed for that run |
| Repeated isolated installation                    | Exit 0; 399.94 seconds; archive hash matches                                                                                   |
| Isolated startup                                  | Identity, database, runtime pipe and handshake confirmed across desktop and daemon-managed runtime logs                        |
| Isolated uninstall                                | Exit 0; 31.08 seconds; executable removed and fixture user data/database preserved                                             |

The full installation used an independently identified `com.syncthink.installtest` build, a separate executable/cache/installation directory and disabled shortcuts. The normal SYNC-THINK instance was left running. The distributable rc.3 EXE was separately built with the normal application identity and verified, but was not installed over the user application.

The initial startup probe watched only desktop stdout and falsely timed out. The daemon redirects runtime readiness to `runtime-data/runtime-<installId>.log`; reading that log confirmed readiness. The existing `windows-installer-smoke.ps1` still assumes the old stdout/PID layout and should be updated before it serves as a release gate. The concurrent test instance also logged browser-extension port 17373 already in use; the original instance was intentionally not stopped.

## Remaining public-beta gates

| Priority | Gate                          | Next action                                                                                                                                                                                                                       |
| -------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Anonymous distribution        | Confirm whether to expose source or only binaries; use an intentionally public download location and verify downloads without login. Do not change repository visibility implicitly.                                              |
| P0       | Fixed release rollout         | Validate rc.3 on a clean Windows 11 x64 machine, then publish new checksums/instructions and stop directing testers to the defective rc.2 build.                                                                                  |
| P0       | Installation latency          | Local direct-extraction optimization measured clean 302→103 s and overlay 402→181 s with full payload hashes and native checks. See `11-windows-installer-performance.md`; clean-machine and interruption/low-disk checks remain. |
| P0       | Lifecycle verification        | Update the smoke harness for daemon logs/PIDs and prove clean install, overlay, upgrade, launch, uninstall/reinstall and identity/database continuity on a disposable machine. Include low-disk and locked-file failures.         |
| P1       | Publisher trust               | Define a code-signing plan. Unsigned invited testing needs explicit warnings; do not ask public testers to trust a private root certificate. Signing is not a substitute for installer tests.                                     |
| P1       | Core user journeys            | Record real model request, streaming, cancellation, approvals, workspace writes, reconnect, failure recovery and private-kernel installation tests on a clean profile.                                                            |
| P1       | Diagnostics and data handling | Provide actionable installer errors, redacted diagnostic exports, feedback routing, known limitations and recovery instructions. Review multi-instance extension-port behavior.                                                   |

Limit the initial beta scope to the Windows 11 x64 local workspace/agent flows. Account, wallet and cloud features need not be added merely to label that scope a beta.

## Local candidate and reproducible checks

- EXE: `apps/desktop/release/installer-rc3/SYNC-THINK-Setup-0.1.0-rc.3-x64.exe`
- SHA-256: `8c99dda1cdac6739eb0cf43a17304436d5b1bed77defe68189a79ff88995edfb`
- Signing: unsigned fixture, not a signed public release.
- Local test summaries: `.data/installer-rc3-verification/*-result.json`.

```powershell
pnpm test:installer:hooks:win
node --test scripts/windows-portable-release.test.mjs scripts/windows-installer-release.test.mjs
pnpm --filter @sync-think/desktop exec vitest run tests/installer-rollback-config.test.ts
node scripts/windows-installer-release.mjs verify --out apps/desktop/release/installer-rc3 --allow-unsigned-fixture
```

The executable NSIS tests require Windows and the cached NSIS compiler from an installer build, or `SYNC_THINK_TEST_MAKENSIS` pointing to a compiler. The normal `pnpm release:installer:win` command runs this regression gate after building. Direct invocations of the build script should explicitly run the same test before distribution.
