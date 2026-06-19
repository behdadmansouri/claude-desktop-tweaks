# ─────────────────────────────────────────────────────────────────────────────
# Claude Desktop UI Patcher  —  Windows
#
# Usage (PowerShell, run as your normal user):
#   .\install.ps1                         # auto-detect
#   .\install.ps1 -AsarPath "C:\...\app.asar"  # explicit path
#
# Requires: Node.js (https://nodejs.org/) and Python 3 (https://python.org/)
# ─────────────────────────────────────────────────────────────────────────────
param(
    [string]$AsarPath = ""
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$CustomUiPath = Join-Path $ScriptDir "custom-ui.js"

# ── Locate app.asar ──────────────────────────────────────────────────────────
function Find-Asar {
    $candidates = @(
        "$env:LocalAppData\Programs\claude\resources\app.asar",
        "$env:LocalAppData\Programs\Claude\resources\app.asar",
        "$env:LocalAppData\AnthropicClaude\app.asar",
        "$env:LocalAppData\Programs\claude-desktop\resources\app.asar",
        "C:\Program Files\Claude\resources\app.asar",
        "C:\Program Files (x86)\Claude\resources\app.asar"
    )
    foreach ($p in $candidates) {
        if (Test-Path $p) { return $p }
    }
    # Broader search
    $found = Get-ChildItem "$env:LocalAppData" -Recurse -Filter "app.asar" -ErrorAction SilentlyContinue |
             Where-Object { $_.FullName -match "claude" } |
             Select-Object -First 1
    if ($found) { return $found.FullName }
    return $null
}

if ($AsarPath -eq "") {
    $AsarPath = Find-Asar
}

if (-not $AsarPath -or -not (Test-Path $AsarPath)) {
    Write-Error "Could not find Claude Desktop's app.asar.`nPass it explicitly: .\install.ps1 -AsarPath 'C:\...\app.asar'"
    exit 1
}

Write-Host "✓ Found asar: $AsarPath" -ForegroundColor Green

# ── Dependency check ─────────────────────────────────────────────────────────
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js not found. Install from https://nodejs.org/ and retry."
    exit 1
}
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Error "Python not found. Install from https://python.org/ and retry."
    exit 1
}

# ── Backup ───────────────────────────────────────────────────────────────────
$BakPath = $AsarPath + ".bak"
if (-not (Test-Path $BakPath)) {
    Copy-Item $AsarPath $BakPath
    Write-Host "✓ Backup created: $BakPath" -ForegroundColor Green
} else {
    Write-Host "✓ Backup already exists: $BakPath" -ForegroundColor Green
}

# ── Extract ──────────────────────────────────────────────────────────────────
$WorkDir = Join-Path $env:TEMP "claude-ui-patch-$PID"
Write-Host "→ Extracting asar..."
& npx --yes @electron/asar extract $AsarPath $WorkDir
if ($LASTEXITCODE -ne 0) { Write-Error "asar extract failed"; exit 1 }

# ── Patch mainView.js ────────────────────────────────────────────────────────
Write-Host "→ Patching mainView.js..."

$patchScript = @"
import sys, json, re

work_dir = sys.argv[1]
custom_ui_path = sys.argv[2]
mv_path = work_dir + r"\.vite\build\mainView.js"

with open(custom_ui_path, encoding='utf-8') as f:
    code = f.read()
encoded = json.dumps(code)

with open(mv_path, encoding='utf-8') as f:
    mv = f.read()

LOADER_SENTINEL = "// -- custom-ui loader"
CTRLQ_SENTINEL  = "// -- Ctrl+Q to quit"
SOURCEMAP_RE    = r"\n//# sourceMappingURL="

new_loader = (
    "// -- custom-ui loader ----------------------------------------------------------\n"
    "(function(){try{var _c=" + encoded + ";"
    'require(\"electron\").webFrame.executeJavaScript(_c)'
    '.then(function(){console.log(\"[custom-ui] ok\");})'
    '.catch(function(e){console.error(\"[custom-ui]\",e);}); }'
    'catch(e){console.error(\"[custom-ui fatal]\",e);}})();\n'
)

ctrlq_block = (
    "\n// -- Ctrl+Q to quit ------------------------------------------------------------\n"
    "document.addEventListener('keydown', function(e){\n"
    "  if(e.ctrlKey && !e.shiftKey && !e.altKey && (e.key==='q'||e.key==='Q')){\n"
    "    try{require('electron').ipcRenderer.send('WindowControl_close');}catch(err){}\n"
    "  }\n"
    "}, true);\n"
)

loader_idx = mv.find(LOADER_SENTINEL)
ctrlq_idx  = mv.find(CTRLQ_SENTINEL)

if loader_idx != -1 and ctrlq_idx != -1:
    mv = mv[:loader_idx] + new_loader + mv[ctrlq_idx:]
    print("  Updated existing loader block.")
elif loader_idx == -1:
    m = re.search(SOURCEMAP_RE, mv)
    insert_at = m.start() if m else len(mv)
    mv = mv[:insert_at] + "\n" + new_loader + ctrlq_block + mv[insert_at:]
    print("  First-time install: added loader + Ctrl+Q blocks.")
else:
    m = re.search(SOURCEMAP_RE, mv[loader_idx:])
    end = (loader_idx + m.start()) if m else len(mv)
    mv = mv[:loader_idx] + new_loader + mv[end:]
    print("  Updated loader block.")

with open(mv_path, "w", encoding='utf-8') as f:
    f.write(mv)

print(f"  Embedded {len(code)} bytes of custom-ui.js")
"@

$patchFile = Join-Path $env:TEMP "claude_patch_$PID.py"
$patchScript | Set-Content $patchFile -Encoding UTF8
& python $patchFile $WorkDir $CustomUiPath
if ($LASTEXITCODE -ne 0) {
    Remove-Item $patchFile -ErrorAction SilentlyContinue
    Write-Error "Patching failed"
    exit 1
}
Remove-Item $patchFile -ErrorAction SilentlyContinue

# ── Repack ───────────────────────────────────────────────────────────────────
Write-Host "→ Repacking asar..."
$PatchedAsar = Join-Path $env:TEMP "claude-ui-patched-$PID.asar"
& npx @electron/asar pack $WorkDir $PatchedAsar
if ($LASTEXITCODE -ne 0) { Write-Error "asar pack failed"; exit 1 }

Copy-Item $PatchedAsar $AsarPath -Force

# Cleanup
Remove-Item $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $PatchedAsar -Force -ErrorAction SilentlyContinue

Write-Host "✓ Done. Restart Claude Desktop to apply changes." -ForegroundColor Green
