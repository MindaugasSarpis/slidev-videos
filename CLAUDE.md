# slidev-videos: notes for agents

Tools for keynote-grade Slidev talks. The talks live in the sibling checkout
`../outreach_talks`; this repo holds what they share. Both sit in
`$OUTREACH_ROOT`. outreach_talks' `scripts/bootstrap.sh` writes the
machine's settings (`OUTREACH_ROOT`, `SLIDEV_VIDEOS_DIR`, `OUTREACH_ENV_BIN`,
the render backend) to `~/.config/outreach_talks/env`; a shell loads them
with `set -a; . ~/.config/outreach_talks/env; set +a`.

## Sessions

The Tools session starts from outreach_talks: `pnpm talk session tools`
opens the window `tools` in the tmux session `talks`, in this repo's main
checkout (`$SLIDEV_VIDEOS_DIR`, default `$OUTREACH_ROOT/slidev-videos`),
running `claude --name Tools --remote-control Tools`.

## What is here

- `src/slidev_videos/`: the `slidev-videos` CLI (Python 3.11+, stdlib),
  tests in `tests/`; `shared.toml`, the shared clip library (encodes on the
  `videos-shared` release, root `videos.toml`).
- Root: `slidev-addon-videos` (`components/VideoPlayer.vue`, the dust
  overlay), at the root for `#v0.3.x` installs.
- `packages/stage/`: `slidev-addon-stage`, own version in its package.json:
  the 3D world (`stage/`), `components/`, `styles/`, the bins
  (`slidev-stage-check`, `-shots`, `-record`, `-safe`), `example/`, `test/`.

Each talk pins `github:MindaugasSarpis/slidev-videos#<ref>` and
`...#<ref>&path:/packages/stage`; outreach_talks' `new_talk.py`
(`ADDONS_REF`) and `env.yaml` carry the pin for new talks. The CLI is an
editable install of the main checkout (bootstrap's `pip install -e`): every
talk session runs the main checkout as it stands.

## Worktrees

- Never switch the main checkout off `main` or leave edits in it.
- Work in `.claude/worktrees/<slug>` (gitignored):
  `git worktree add .claude/worktrees/<slug> -b <type>/<name> <base>`.
- `git add` named paths; no `git stash` (shared by all worktrees).
- Merging and tagging are the owner's, with merge commits, never squash or
  rebase: talks pin PR-branch commits by hash.

## Dev loop: an engine change in a talk without re-pinning

Re-pinning costs about 7 minutes a tweak. Instead link the addons to your
checkout in a /tmp copy of outreach_talks (tested 2026-10-08):

    export PATH=$OUTREACH_ENV_BIN:$PATH
    W=/tmp/<label>; SV=$SLIDEV_VIDEOS_DIR/.claude/worktrees/<slug>
    git clone -q --shared $OUTREACH_ROOT/outreach_talks $W/ot

1. `pnpm install` in `$SV` (the engine resolves its imports there). In
   `$W/ot/package.json` add, `$SV` written out:
   `"pnpm": { "overrides": { "slidev-addon-videos": "link:<SV>",
   "slidev-addon-stage": "link:<SV>/packages/stage" } }`, then
   `cd $W/ot && pnpm install`.
2. A checkout without fix/stage-addon's `vite.config.js`: a talk that
   imports three itself needs `resolve: { dedupe: ['three'] }` in its
   `vite.config.ts`, or `slidev dev` loads two copies.
3. Edit in `$SV`; `pnpm exec slidev build deck.md --out $W/site --base /`
   (about 6 s) or keep `pnpm exec slidev deck.md` running.

Never do this in the real outreach_talks or a talk's worktree: it rewrites
`pnpm-lock.yaml` under a live session. CLI: `python3 -m venv $W/venv &&
$W/venv/bin/pip install -e $SV`, `$W/venv/bin` first on PATH.

## Tests

`$PY` is a Python 3.11+ with pytest (the env's has none):

    PYTHONPATH=src $PY -m pytest tests -q
    pnpm install && pnpm test:all     # every build, smoke and stage test
    pnpm stage:test

Without `PYTHONPATH=src`, `slidev_videos` imports from the main checkout.
Run browsers inside `flock /tmp/slidev-stage-shots.lock <cmd>`, a few
slides at a time: other sessions render here too. Commit bins
executable (`git update-index --chmod=+x`): a `link:` install sets the bit.

## Headless Chromium

shots, record, safe and the smoke start the browser through
`packages/stage/bin/lib/chromium.mjs` (byte-identical on feat/shots-v2 and
feat/broadcast). Backends, best first, each kept only when the
page's renderer string confirms it:

- `gpu-nvidia`: native NVIDIA driver over EGL (nvidia-smi, not WSL)
- `d3d12`: WSL's GPU (`/dev/dxg`) through Mesa's d3d12 driver in a private
  prefix, `$SLIDEV_STAGE_MESA_D3D12` (default `~/.local/share/mesa-d3d12`;
  outreach_talks' `scripts/mesa-d3d12.sh` fetches it)
- `llvmpipe`: Mesa on an X display (`DISPLAY=:0` when unset and
  `/tmp/.X11-unix/X0` exists), `LP_NUM_THREADS=8`
- `swiftshader`: last, about 3x slower, with a warning

`SLIDEV_STAGE_GL` (`auto`, a backend, `gl`, `none`; a forced backend not
reached fails), `SLIDEV_STAGE_CHROMIUM` (a browser to try first),
`SLIDEV_STAGE_CHROMIUM_ARGS` (shell words, last), `SLIDEV_STAGE_CHROMIUM_ENV`
(`K=V;K=V`), `SLIDEV_STAGE_PLAYWRIGHT`. Bootstrap writes the GL settings to
the env file; `pnpm talk` passes them on. playwright-chromium is pinned
`~1.59.1`: in WSL, Chromium 151 and 153 headless shells fell back to
SwiftShader.

## ffmpeg

Static Linux ffmpeg builds crash (exit 139) on `https://` input, silently
under `-v error`. Use the env's ffmpeg (`$OUTREACH_ENV_BIN`, with NVENC);
`slidev-videos doctor` names the pair the CLI picked.

## Merge order (open branches, 2026-10)

All five fork from PR #2's head (758c0e7). Tried in a /tmp clone, where
`pnpm test:all` then passed:

1. PR #2 (feat/effects-v2) alone; tag v0.5.0 (below).
2. chore/release-tooling, fix/cli-hardening: they conflict with nothing.
3. feat/shots-v2.
4. feat/broadcast: launcher, pins and lockfile equal shots-v2's; only
   `packages/stage/README.md` conflicts (one hunk): keep both sides.
5. fix/stage-addon conflicts in `packages/stage/`: `README.md`,
   `components/Stage.vue`, `scripts/smoke.mjs` (keep both sides),
   `test/stage.test.mjs` (union the imports), `stage/space.js` (its
   `forms` line, broadcast's `twinkle`). Then fix what merges clean but
   breaks: `stage/types.js` needs `look` in STAGE_KEYS and `twinkle`,
   `guard`, `lift` in OPTION_KEYS (else check warns of `look` and fails
   those options; the key-list test then expects `lift` and skips the
   look's `halo` and `max`); `scripts/smoke-dev.mjs` launches through
   `bin/lib/chromium.mjs` (`GL_ARGS` is gone); the example has 7 slides
   (smoke's `probe.total`).

After each, `pnpm install --frozen-lockfile` and the unit tests; at the
end, `pnpm test:all` under the lock.

## Releasing

v0.5.0 is tagged by hand: merge PR #2 alone,
`git tag -a v0.5.0 -m 'slidev-videos v0.5.0' <merge>`, push the tag; notes
from CHANGELOG.md's v0.5.0 section. `git diff 640eaa5 v0.5.0 -- packages/`
is then empty, as the talks' pin bump needs. release.py starts at v0.6.0
(it refuses while a CHANGELOG version is untagged):

1. The owner merges the branches (above) and pulls main.
2. Make `## Unreleased` match what landed (a comment above each entry
   names its branch; the release drops comments). Branches add entries
   there and leave version strings to release.py.
3. With `$OUTREACH_ENV_BIN` first on PATH:
   `$PY scripts/release.py 0.6.0 --stage 0.3.0 --dry-run`; read the plan and
   diff, then run it without `--dry-run` (checks, both suites, commit
   `chore: v0.6.0`, local tag).
4. Run the two printed commands (`git push --atomic ...`,
   `gh release create ...`), or pass `--push`.
5. In outreach_talks, `pnpm talk bump-toolkit v0.6.0` moves the pins; talks
   being filmed or presented keep theirs until delivered. A talk then moves
   `<Count>` to `<StageCount>` and drops `setup/Count.vue` and
   `vite.config.ts` (`packages/stage/README.md`).

## Durable rules

- One package per capability under `packages/`, configured from deck
  headmatter, extended by registration, with no talk's content.
- Tools meet through window events, not imports.
- Stage scenes are grains of light, of a piece with the dust: no solid
  meshes, floating labels or scale bars in keynote visuals.
- Visual reworks wait until the owner has seen them on a real GPU: show
  screenshots, keep the PR a draft.
- Public repo: no personal data. Refer to the owner as "the owner".
- Commits: `type(scope): what changes, in plain words`; the body says why.
