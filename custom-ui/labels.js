// ─────────────────────────────────────────────────────────────
//  PROJECT LABEL EMOJI
//  Puts the folder's emoji back on the sidebar groups that are named after a
//  git remote instead of after their folder.
// ─────────────────────────────────────────────────────────────
//
// Measured 2026-08-27 ([cc-dump] findLabels), after two wrong guesses about
// which container to look in. The app keys a sidebar project group two ways:
//
//   data-row-key="label:project-/home/z3z0/Documents/AI Projects/AI Projects Manager 🛠️"
//   data-row-key="label:project-behdadmansouri/connoisseurd"
//
// The first is a path and is labelled with the folder's basename, emoji and
// all. The second is `owner/repo` from the folder's git remote, and is labelled
// with the repo name - which no naming convention of ours touches. So the emoji
// was never lost or stripped: those five folders (the ones with a GitHub
// remote) stopped being named after their folder at all. Nothing in the DOM
// connects that row back to a path, which is why this needs a build-time map:
// update-ui.sh reads each folder's .git/config and bakes CC_AI_REPOS as
// {"owner/repo": "Folder Name 🎨"}.
//
// Deliberately additive: the repo name stays and the emoji is appended in a
// span of our own. Rewriting the label text would mean fighting React over a
// node it owns and would also throw away the one piece of information the row
// has that the folder name does not - which repo it actually is.
//
// localStorage['cc-repo-emoji'] = '0' turns it off.

const CC_REPOS = (typeof CC_AI_REPOS !== 'undefined') ? CC_AI_REPOS : {};
const LABEL_PREFIX = 'label:project-';
const REPO_EMOJI_KEY = 'cc-repo-emoji';

function repoEmojiOn() {
  try { return localStorage.getItem(REPO_EMOJI_KEY) !== '0'; } catch (_) { return true; }
}

function applyProjectLabels() {
  if (!repoEmojiOn()) return;
  for (const row of document.querySelectorAll('[data-row-key^="' + LABEL_PREFIX + '"]')) {
    const key = (row.getAttribute('data-row-key') || '').slice(LABEL_PREFIX.length);
    // A path-keyed group already carries the folder's own name. Only the
    // owner/repo form is missing one, and it is the form that never starts
    // with a separator.
    if (!key || key.charAt(0) === '/') continue;
    const folder = CC_REPOS[key];
    if (!folder) continue;
    const {emoji} = splitEmoji(folder);
    if (!emoji) continue;

    const span = row.querySelector('[data-sidebar-group-label] span.truncate') ||
                 row.querySelector('button span.truncate');
    if (!span || !span.parentElement) continue;
    // The label may already end in the emoji if the app ever starts naming
    // these after the folder again - in which case there is nothing to add.
    if ((span.textContent || '').indexOf(emoji) >= 0) continue;

    let tag = span.nextElementSibling;
    if (!tag || !tag.classList || !tag.classList.contains('cc-repo-emoji')) {
      tag = document.createElement('span');
      tag.className = 'cc-repo-emoji';
      // shrink-0 so it survives the truncation the sibling span is set up for:
      // the name is the thing allowed to be clipped, not the glyph.
      tag.style.cssText = 'flex:none;margin-left:4px;line-height:1;';
      span.insertAdjacentElement('afterend', tag);
    }
    // Re-checked rather than written blind on every scan: React re-renders this
    // row often, and an unconditional write would be a mutation that retriggers
    // the observer that called us.
    if (tag.textContent !== emoji) tag.textContent = emoji;
    if (tag.title !== folder) tag.title = folder;
  }
}
