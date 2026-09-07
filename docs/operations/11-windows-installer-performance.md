# Windows installer performance

## Measured result — September 7, 2026

Same machine, same 10,883-file / 777,440,493-byte application payload, independent test application identity:

| Operation            | Previous extraction | Direct extraction | Time reduction |
| -------------------- | ------------------: | ----------------: | -------------: |
| Clean installation   |           302.175 s |         103.007 s |          65.9% |
| Overlay installation |           401.523 s |         181.399 s |          54.8% |

All four installs exited zero. Every installed payload file matched its source SHA-256 after each install, and both versions' recovery archives matched their respective installer. The optimized installation loaded SQLite and Koffi successfully using its bundled Node runtime. Its in-place uninstaller exited zero in 32.927 seconds. These are local single-run measurements, not a guarantee for every user's machine. Source evidence is `.data/installer-performance/results.json`; temporary staging, fixture installers and their cache are cleaned after verification to reclaim space.

The focused test suite passes 42 tests (41 Node tests and one desktop installer contract test), including generated-include compilation, corrupt archives, blocked destinations, locked files and rollback publication failures. Workspace typechecking passes. The normal-identity candidate and its blockmap/manifest also pass release verification; that candidate was not installed over the user's running application. Full GUI/model journeys and interruption/real-full-disk scenarios were not exercised by this performance benchmark.

Local unsigned candidate: `apps/desktop/release/installer-rc4/SYNC-THINK-Setup-0.1.0-rc.4-x64.exe` (204,511,759 bytes).

SHA-256: `8957508d48ec0442fef4e9a6daf2a2244137777b28e3a8c65b6aa4c973c63440`.

The verified candidate was initially staged with an explicit `0.1.0-rc.4` override; the repository and desktop package versions now match it for the rc.4 prerelease. Release assets reuse this verified binary rather than an untested rebuild. The unsigned candidate is for manual installation, not a signed automatic-update rollout. Use the repository's installer release script to enable this extraction path; a bare electron-builder invocation using the base JSON configuration retains the upstream extraction macro.

## Scope and implementation

This change targets installation I/O, not download transport or application feature removal. The offline 7z payload, differential package/blockmap, updater baseline cache, rollback archive and normal electron-builder uninstaller/signing flow remain enabled. No work is deferred to the first application launch.

The previous electron-builder 26.15.3 extraction macro expands the entire payload under `$PLUGINSDIR/7z-out` on the temporary drive, then copies it into the installation directory. The replacement runs the builder's checksum-resolved 7za executable directly against the installation directory and requires exit code zero before registration and rollback publication continue. Corrupt archives, inaccessible destinations and locked files abort instead of reporting success. A failed extraction can leave partial application files; close the application, resolve the reported cause and rerun the installer. This is not a transactional install or automatic rollback of failed extraction.

`scripts/windows-installer-extraction.mjs` copies the pinned NSIS headers into a generated build-only directory and replaces only `extractUsing7za`. It uses an NSIS include, not a custom top-level installer script: the latter bypasses electron-builder's standard uninstaller generation/signing and is deliberately avoided. Template version and seam checks fail closed on an unreviewed builder upgrade. Native regression tests compile through this generated include, exercising its file resolution as well as the extraction macro. No dependency-cache templates are modified.

The extra extractor is embedded inside the installer with the toolset's `LICENSE.txt` and `COPYING`; it runs from the private NSIS temporary directory and is not an application runtime dependency. Tool resolution honors electron-builder's toolset override, but requires the accompanying license files. Installer execution performs no tool download.

For the measured payload, this removes one 777,440,493-byte expanded temporary tree and its subsequent copy. It does not remove the compressed payload's temporary file, the updater cache, the rollback archive or work done by the old-version uninstaller. Peak disk usage still depends on destination and upgrade state. The EXE is slightly larger because it embeds the checked extractor; it is not a package-size optimization.

## Reproducible verification

```powershell
pnpm test:installer:hooks:win
node --test scripts/windows-portable-release.test.mjs scripts/windows-installer-release.test.mjs
node scripts/windows-portable-release.mjs stage --out apps/desktop/release/win-unpacked-perf --version 0.1.0-rc.4 --signing-mode unsigned-fixture
node scripts/windows-installer-release.mjs build --prepackaged apps/desktop/release/win-unpacked-perf --out apps/desktop/release/installer-rc4 --version 0.1.0-rc.4 --signing-mode unsigned-fixture
node scripts/windows-installer-performance.mjs --prepackaged apps/desktop/release/win-unpacked-perf
```

The benchmark is Windows-only and builds two independently identified `com.syncthink.installperf` installers from the same staged payload. It runs baseline and optimized clean/overlay installs serially, hashes every installed payload file against the source, verifies the recovery archive, exercises SQLite/Koffi with the installed Node runtime, and uninstalls the fixture. It suppresses shortcuts and automatic launch; the user's normal SYNC-THINK installation is not targeted. It temporarily renames only the staged executable for the fixture identity and restores it in `finally`. Do not concurrently package or launch that staging directory. Preserve prior `.data/installer-performance/results.json` elsewhere before another run; the harness refuses to overwrite it or an existing fixture application directory.

Uninstall runs with NSIS `_?=` so the measured process performs the uninstall rather than returning before a temporary child completes. The first baseline run exposed this harness issue after its clean/overlay checks had passed; its application directory was subsequently confirmed removed, but no baseline uninstall duration is claimed. `--resume-direct` reuses that completed baseline only after checking its verification record, payload dimensions/version, and the optimized artifact hash, with no existing fixture installation. It does not rebuild or silently overwrite baseline measurements.

Measurements include NSIS process completion, not just extraction. Full-tree hash verification happens outside the timed interval. Runs are serial on one live machine, not a statistically controlled clean-VM study; OS cache and background security software can influence results. No security software is disabled. Signing reputation, low-disk behavior on a real full volume, system interruption and clean-machine end-to-end user journeys remain release checks.
