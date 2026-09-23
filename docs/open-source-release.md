# Open-source release: the project switcher

Goal: ship ONLY the project panel (`custom-ui/workspace.js` and what it needs) as its own clean,
Linux-first, MIT/GPL open-source project. Marketing is a separate session. Decided 2026-09-23.

## Decisions so far
- Ship the project switcher alone; usage chip, sleep patch, frame fix, ActivityWatch title stay private.
- Linux first; macOS/Windows welcome via a one-command `--check` people paste back.
- Rewriting history is fine (few clones). Personal data is scrubbed.
- v1 does NOT poll claude.ai's `/usage` endpoint (scripted access is the ToS-greyest part; see Risks).

## Phases
1. **Audit + cut line.** List exactly what the panel needs: `workspace.js`, `labels.js`, `css.js`,
   `bootstrap.js`, `overview.js`?, plus the main-process handlers in `update-ui.sh` (`cc-folders`,
   TODO read/list, `cc-scan-remote-v1`, `cc-activity-v1`). Everything else is out of the new repo.
2. **Make it generic.** Today it hardcodes `~/Documents/AI Projects` and the emoji-folder convention.
   Needs a configurable project source (see open question) and no personal hosts/names.
3. **Scrub.** Grep for names, email, hosts, IPs, `memory/`, `CLAUDE.md`, `TODO.md`; ship none of them.
   Fresh repo history (one clean initial commit).
4. **Installer + checks.** `install.sh` (backup, refuses while app runs, idempotent), `uninstall.sh`,
   `--check` (would every signature match this installed version? prints a paste-able report), and a
   smoke test that patches a copy and runs `node --check`.
5. **Visuals + README.** Record GIFs (project switch, TODO remaining), study 3 top small-tool READMEs
   for layout. Honest "unofficial, breaks when claude.ai redeploys" section.
6. **License, publish.** Then marketing in its own session (Reddit, HN, #76960 comment, hackathons).

## Risks (verified 2026-09-23)
- Consumer Terms s.3 bar to "decompile, reverse engineer, disassemble" and scripted access to the
  Services except via API key. Patching the local app is arguably neither, but not certain: state it
  as unofficial, no legal advice. Ship patch scripts, never Anthropic's code.
- Anthropic bars subscription OAuth tokens in third-party tools (Feb 2026). The switcher never touches tokens.
- The window UI is served from claude.ai, so it can break on Anthropic's web deploys, not on app updates.
- Prior art: HazenBabcock/claude-desktop-mods (context % badge only, 0 stars, no license).
