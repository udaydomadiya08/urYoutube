# urYouTube v3.3.1 — Release Manifest & Integrity Checksums

- **Release Version**: `3.3.1`
- **License**: `MIT`
- **Automated Verification**: `38 / 38 tests passing` (`0 failures`) on Node.js v22.16.0 (`linux-x64`).
- **Ranking benchmark**: 1,000-video ranking microbenchmark recorded at `26.27 ms` in the clean-extraction test run; environment-dependent, not an end-to-end latency guarantee.
- **Release scope**: local-first, user-controlled ranking policy; no mandatory API keys. Live discovery still depends on reachable external sources or optional credentials.
- **Manifest note**: SHA-256 entries cover every other release file; the manifest is excluded from its own checksum to avoid a circular hash. The generated `tests/last_test_run.json` is a local test artifact and is not part of the release.

## File Inventory & SHA-256 Checksums

| File Path | Size | SHA-256 Checksum |
| :--- | ---: | ---: |
| `.env.example` | `357 B` | `ab1633e2f7aed555c49cad52dd7c8b1b8412c53a53391ab4764d94b471396036` |
| `.github/workflows/deploy.yml` | `652 B` | `89615d6a52d48a7d769d112dd1fe066698132f66f150b0dbf6e4618f226e4563` |
| `.gitignore` | `81 B` | `4537481d53a6d2220d9f9c62b1abea491ae972388dc9781c5983376312c1f77b` |
| `CHANGELOG.md` | `7.2 KiB` | `020aff3b325dabbd81b950078df3a675cb4efa83147c205fb06ecdc5d6642e55` |
| `CONTRIBUTING.md` | `872 B` | `a478b46b11856c60184fef6d4a6adb216e8153da6ea6a5512f6e527ad5c299e0` |
| `Dockerfile` | `80 B` | `6889349ff8101b3a5f2bd4945c00af6e773ea93efd01ad043c38e03313a76ad7` |
| `ENGINEERING_REPORT.md` | `5.2 KiB` | `2add8aa16c6d8cc1e185d10a75f3ee25afe915c21e59c7a58347fe5d524caa22` |
| `LICENSE` | `1.1 KiB` | `38ccff64e415eaf573ae076db66790b6cd1f2732f7692b326744c010481a0814` |
| `README.md` | `7.4 KiB` | `74ed25cf618102689abfe01db0f8a1c72b93bbc779bb5d2bc67daf2795a1b23b` |
| `SECURITY.md` | `5.8 KiB` | `d2fd886c75e1c775cc334d47146d4bd73ef4a9396843318da25b01a66125397d` |
| `TEST_REPORT.md` | `2.6 KiB` | `bbb4da711b6a71823c4fe92161b460d466693f031377e745219609225c49510b` |
| `VERIFICATION_REPORT.md` | `2.2 KiB` | `1123cc3ce0dd0b520783fc202410ac68ffaec4a7e0fa96044db03df488d36b58` |
| `docs/ALGORITHM_SPEC.md` | `7.7 KiB` | `8a3253a3a6022d569b601daace43a85cd319d2ea34b28d720ce100645a6000fa` |
| `index.html` | `208.3 KiB` | `beaf18d0469ca2cb817d13572c7f803ea5de88bdaca7a3dcb42278b3ee46300d` |
| `netlify.toml` | `1.1 KiB` | `e82ee3a6c947bda5aff9648bb04501b0a6ac8ef13eff009bfab7a29889a43daa` |
| `package.json` | `656 B` | `38728caeb2ff74a022b97d532a15974878af41f2934425ad5a8423188b9d9c9a` |
| `presets/deep-cs-monk-mode.json` | `562 B` | `166fa74e99099fb234f53d8bd71a51c069f1df51665d5d7880fe7ba83b6d2b18` |
| `presets/indie-maker-explorer.json` | `541 B` | `456eb7f3a7051a3c3aea276a81392baab8c93cd04e0ec6887f19bcf05bf6a958` |
| `server.js` | `20.0 KiB` | `63bf63290549c8ed6ac499a41b11dcb8f74291611fbb24f42f0d5d5f2b263b31` |
| `src/css/styles.css` | `3.5 KiB` | `b71e947e41b68ce641a4fd4aae513ba6a27bc45f36b92ae00f316a69d0546380` |
| `src/js/app.js` | `149.6 KiB` | `7c48299093d3548c5542585dd5dd61c2fae921b76ffc3f34d8e4260eca0899a4` |
| `src/js/provider-adapters.js` | `14.1 KiB` | `d01fbbb708d1addd0b2725d97b038b79083cc61e22894f6f422a27384ca12188` |
| `src/js/recommendation-engine.js` | `54.2 KiB` | `2cd9c2a22f3ca3521575bf635b410161b176ca8c0414d1149146313f09682f96` |
| `tests/run_tests.js` | `67.1 KiB` | `87cd0fffb4da73d14e8fd097b1ad95d46625ba28b5b07037362c1fce615a135e` |
| `uryoutube.html` | `208.3 KiB` | `beaf18d0469ca2cb817d13572c7f803ea5de88bdaca7a3dcb42278b3ee46300d` |
| `vercel.json` | `1.3 KiB` | `25ef2222f7190fe5ea788828ae852a15ab01962edeca3c506d688f4e96da0d2d` |

## Integrity Notes

- Manifest covers **26 files**.
- Re-run `npm test` to regenerate the local test artifact; that artifact is intentionally excluded from the release ZIP.
- Actual credentials and `.env` files must never be committed. `.env.example` contains placeholders only.
