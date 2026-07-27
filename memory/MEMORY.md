# Memory Index — Claude Desktop Project

## Wiki
- [architecture.md](architecture.md) — patching stack, preload sandbox, dframe redesign, titlebar modes, workspace click
- [features.md](features.md) — feature status (implemented / partial / not yet)
- [debugging.md](debugging.md) — console markers, log files, localStorage state, constraints
- [design-decisions.md](design-decisions.md) — whitelist guards, absolute timestamps, DOM scanner patterns
- [maintenance.md](maintenance.md) — deploy workflow, folder renames, AppImage upgrades
- [issues-fixed.md](issues-fixed.md) — bug history with root causes (#1-18)
- [perf-security.md](perf-security.md) — security and performance review

## Notes
- [Claude Desktop Patching State](project_claude_desktop_state.md) — current app version, what works, key gotchas, how to continue
- [Config symlink gotcha](project_claude_desktop_symlink_gotcha.md) — ~/.config/Claude/custom-ui.js symlink dies silently on folder rename, deploying stale code
- [GPU crash / blank page](project_claude_desktop_gpu_crash.md) — empty page = Chromium GPU FATAL (#583), fix CLAUDE_DISABLE_GPU=1 in .desktop Exec lines
- [Cowork vs Desktop](project_claude_cowork_vs_desktop.md) — Cowork is a SEPARATE AUR package (claude-cowork-linux) that conflicts with claude-desktop-appimage; not a desktop feature/version
- [Cowork Linux VM deps](project_cowork_linux_vm_deps.md) — aaddrick desktop ALREADY runs Cowork on Linux; needs QEMU+OVMF+virtiofsd at Debian paths, fix via symlinks (no asar patch, standalone pkg unnecessary)
