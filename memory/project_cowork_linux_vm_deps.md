---
name: project-cowork-linux-vm-deps
description: "Cowork on Linux needs QEMU+OVMF+virtiofsd at Debian paths; fix via symlinks, no asar patch"
metadata: 
  node_type: memory
  type: project
  originSessionId: e06f6de1-4bd1-4194-852d-4358ae339fd8
---

The aaddrick `claude-desktop-appimage` (Linux build) ALREADY supports Cowork on Linux -
it is NOT platform-gated off. Cowork's local agent runs a QEMU microVM via the bundled
`resources/cowork-linux-helper` (Go binary: buildQEMUArgs, startVirtiofsd, OVMF firmware,
virtiofsd, vsock, KVM).

The renderer's support check (main chunk `index.chunk-*.js`) requires all three, probed at
HARDCODED DEBIAN/UBUNTU PATHS:
- qemu: `qemu-system-x86_64` via PATH
- firmware: `/usr/share/OVMF/OVMF_CODE_4M.fd` or `/usr/share/OVMF/OVMF_CODE.fd`
- virtiofsd: `/usr/libexec/virtiofsd` or `/usr/bin/virtiofsd`
If any missing → UI shows "Cowork requires QEMU. Install it with 'sudo apt install
qemu-system-x86 ovmf virtiofsd'". Also checks `/dev/kvm` access (kvm==="missing").

On Manjaro the pkgs install to Arch paths, so detection fails even though all present:
edk2-ovmf → `/usr/share/edk2-ovmf/x64/OVMF_{CODE,VARS}.4m.fd`; virtiofsd → `/usr/lib/virtiofsd`.

**Fix (clean, durable, no asar patch):** symlink Debian paths to Arch files:
```
sudo mkdir -p /usr/share/OVMF /usr/libexec
sudo ln -sf /usr/share/edk2-ovmf/x64/OVMF_CODE.4m.fd /usr/share/OVMF/OVMF_CODE_4M.fd
sudo ln -sf /usr/share/edk2-ovmf/x64/OVMF_VARS.4m.fd /usr/share/OVMF/OVMF_VARS_4M.fd
sudo ln -sf /usr/lib/virtiofsd /usr/libexec/virtiofsd
```
(app derives VARS path via `.replace("OVMF_CODE","OVMF_VARS")`, hence both fd symlinks.)
`/dev/kvm` was already 0666 so KVM access is fine without joining the kvm group.

Implication: the standalone `claude-cowork-linux` package was UNNECESSARY for getting Cowork
in Desktop - plain aaddrick desktop + these symlinks is enough. See [[project-claude-cowork-vs-desktop]].
Deps required: `edk2-ovmf virtiofsd qemu-system-x86` (all were already installed here).
