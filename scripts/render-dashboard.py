#!/usr/bin/env python3
"""Render claude-ctl's state JSON into a self-contained status page.

Deliberately a separate file rather than a heredoc inside claude-ctl.sh: this
project has been bitten twice by an unquoted heredoc eating backslashes and
executing backticks (see the maintenance note in memory/issues-fixed.md), and an
HTML template is nothing but backslash- and dollar-shaped characters.

Reads:  STATE_FILE   json written by `claude-ctl json`
Writes: PAGE_TARGET  a single .html with the state inlined - no server, no
                     network, openable straight from file://
"""
import html
import json
import os
import sys

state_file = os.environ.get("STATE_FILE")
target = os.environ.get("PAGE_TARGET")
if not state_file or not target:
    sys.exit("STATE_FILE and PAGE_TARGET must be set")

with open(state_file) as f:
    s = json.load(f)

e = html.escape


def pill(ok, yes="on", no="off", warn=False):
    """A status chip. `warn` colours a TRUE value as a problem rather than a win
    - used for things like "patch is stale", where true is bad."""
    cls = ("warn" if warn else "ok") if ok else ("idle" if not warn else "ok")
    return '<span class="pill ' + cls + '">' + e(yes if ok else no) + "</span>"


rows = []
for b in s["builds"]:
    rows.append(
        "<tr><td>" + e(b["name"]) + "</td>"
        "<td class=mono>" + e(str(b["version"])) + "</td>"
        "<td>" + pill(b["running"], "running", "stopped") + "</td>"
        "<td>" + pill(b["customUI"], "patched", "stock") + "</td></tr>"
    )

inhib = s.get("inhibitors") or []
# The whole point of the inhibitor list is spotting the one you did not expect,
# so an empty list is the good state and says so rather than rendering blank.
if inhib:
    inhib_html = "".join("<li class=mono>" + e(i) + "</li>" for i in inhib)
else:
    inhib_html = '<li class="muted">nothing is blocking sleep or lock</li>'

patches = s.get("patches", {})
patch_html = "".join(
    "<li>" + e(label) + " " + pill(patches.get(key, False), "applied", "not applied") + "</li>"
    for key, label in (
        ("nativeFrame", "native window frame (KWin decorates)"),
        ("workAwareKeepAwake", "keep-awake released when idle"),
    )
)

sess = s.get("sessions", {})
doc = """<title>Claude Desktop control</title>
<style>
  :root {
    color-scheme: light dark;
    --bg:#fbfbfa; --fg:#1a1a18; --dim:#6b6b66; --line:#e3e3df; --card:#fff;
    --ok:#1f7a4d; --okbg:#e6f4ec; --warn:#a33; --warnbg:#fbeaea; --idle:#6b6b66; --idlebg:#eeeeec;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#191917; --fg:#eeeeec; --dim:#9a9a94; --line:#33332f; --card:#212120;
            --ok:#6ee7a8; --okbg:#12301f; --warn:#ff9d9d; --warnbg:#3a1c1c; --idle:#9a9a94; --idlebg:#2a2a28; }
  }
  :root[data-theme=dark] { --bg:#191917; --fg:#eeeeec; --dim:#9a9a94; --line:#33332f; --card:#212120;
            --ok:#6ee7a8; --okbg:#12301f; --warn:#ff9d9d; --warnbg:#3a1c1c; --idle:#9a9a94; --idlebg:#2a2a28; }
  :root[data-theme=light] { --bg:#fbfbfa; --fg:#1a1a18; --dim:#6b6b66; --line:#e3e3df; --card:#fff;
            --ok:#1f7a4d; --okbg:#e6f4ec; --warn:#a33; --warnbg:#fbeaea; --idle:#6b6b66; --idlebg:#eeeeec; }
  body { margin:0; padding:2rem 1.25rem 4rem; background:var(--bg); color:var(--fg);
         font:15px/1.55 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  .wrap { max-width:56rem; margin:0 auto; }
  h1 { font-size:1.4rem; margin:0 0 .15rem; letter-spacing:-.01em; }
  .sub { color:var(--dim); font-size:.85rem; margin-bottom:1.75rem; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px;
          padding:1.1rem 1.25rem; margin-bottom:1rem; }
  h2 { font-size:.72rem; text-transform:uppercase; letter-spacing:.09em;
       color:var(--dim); margin:0 0 .8rem; font-weight:650; }
  .scroll { overflow-x:auto; }
  table { border-collapse:collapse; width:100%; min-width:30rem; }
  th,td { text-align:left; padding:.45rem .6rem .45rem 0; border-bottom:1px solid var(--line); }
  th { font-size:.7rem; text-transform:uppercase; letter-spacing:.07em; color:var(--dim); font-weight:600; }
  tr:last-child td { border-bottom:0; }
  .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.85em; }
  .pill { display:inline-block; padding:.08rem .5rem; border-radius:999px;
          font-size:.72rem; font-weight:650; }
  .pill.ok { background:var(--okbg); color:var(--ok); }
  .pill.warn { background:var(--warnbg); color:var(--warn); }
  .pill.idle { background:var(--idlebg); color:var(--idle); }
  ul { margin:0; padding-left:1.1rem; }
  li { margin:.2rem 0; }
  .muted { color:var(--dim); }
  pre { margin:0; white-space:pre-wrap; font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
        font-size:.82rem; color:var(--dim); }
  code { background:var(--idlebg); padding:.06rem .35rem; border-radius:4px;
         font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.85em; }
</style>
<div class=wrap>
<h1>Claude Desktop control</h1>
<div class=sub>state as of __GEN__ &middot; regenerate with <code>claude-ctl page</code></div>

<div class=card>
  <h2>Builds</h2>
  <div class=scroll><table>
    <tr><th>build</th><th>version</th><th>process</th><th>custom UI</th></tr>
    __ROWS__
  </table></div>
</div>

<div class=card>
  <h2>Deployed patches</h2>
  <ul>__PATCHES__
    <li>deployed asar vs sources __STALE__</li>
  </ul>
</div>

<div class=card>
  <h2>Sessions</h2>
  <ul>
    <li>index shared with the official build __SHARED__</li>
    <li>__COUNT__ session records</li>
    <li>keep-awake: <span class=mono>__KA__</span></li>
  </ul>
</div>

<div class=card>
  <h2>Holding sleep or lock open right now</h2>
  <ul>__INHIB__</ul>
</div>

<div class=card>
  <h2>Update check</h2>
  <pre>__UPDATES__</pre>
</div>
</div>
"""

doc = doc.replace("__GEN__", e(s.get("generated", "")))
doc = doc.replace("__ROWS__", "".join(rows))
doc = doc.replace("__PATCHES__", patch_html)
doc = doc.replace("__STALE__", pill(s.get("patchStale", False), "STALE", "current", warn=True))
doc = doc.replace("__SHARED__", pill(sess.get("shared", False), "linked", "separate"))
doc = doc.replace("__COUNT__", e(str(sess.get("count", 0))))
doc = doc.replace("__KA__", e(str(s.get("keepAwake", ""))))
doc = doc.replace("__INHIB__", inhib_html)
doc = doc.replace("__UPDATES__", e(str(s.get("updates", ""))))

tmp = target + ".tmp"
with open(tmp, "w") as f:
    f.write(doc)
os.replace(tmp, target)
