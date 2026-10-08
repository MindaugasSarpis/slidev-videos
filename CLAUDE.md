# slidev-videos: notes for agents

Tools for keynote-grade Slidev talks. The talks live in `~/outreach_talks`
(GitHub `cern_outreach_talks`); this repo holds what they share.

## What is here

- `src/slidev_videos/`: the `slidev-videos` CLI (Python 3.11+, stdlib only),
  tests in `tests/`. `shared.toml` is the shared clip library; with the root
  `videos.toml` this repo is itself a project whose `videos-shared` release
  hosts the library's encodes.
- Repo root: `slidev-addon-videos` (`components/VideoPlayer.vue`, the dust
  overlay `components/VideoDust.vue` + `components/video-dust/`,
  `global-top.vue`). It stays at the root so `#v0.3.x` installs resolve.
- `packages/stage/`: `slidev-addon-stage`, with its own version in its
  package.json. The 3D world (`stage/`), `components/`, `styles/`,
  `bin/check.mjs` (`slidev-stage-check`), `bin/shots.mjs`
  (`slidev-stage-shots`), `example/`, `test/`.
- `example/`: the player's example deck for the smoke test. `scripts/`:
  `make-example-clip.mjs`, `smoke-example.mjs`, `fetch-shared-raws.sh`,
  `release.py`.

Consumers: each talk pins `github:MindaugasSarpis/slidev-videos#<ref>` and
`...#<ref>&path:/packages/stage` in `talks/<t>/package.json`;
`scripts/new_talk.py` (`ADDONS_REF`) and `env.yaml` carry the pin for new
talks. The CLI on this machine is an editable install of the main checkout
(`/usr/bin/python3`, user site), so every talk session runs whatever
`~/slidev-videos` holds, the moment it changes.

## Worktrees

- Never switch the main checkout `~/slidev-videos` off `main` and never leave
  edits in it: it is the CLI every talk session is running.
- Work in `.claude/worktrees/<slug>` (gitignored):
  `git -C ~/slidev-videos worktree add .claude/worktrees/<slug> -b <type>/<name> <base>`.
- `git add` named paths; no `git stash` (the stash is shared by all worktrees).
- Merging and tagging are the owner's. Merge with a merge commit, never squash
  or rebase: talks pin commits of PR branches by hash, and after a squash
  those commits are on no branch once the PR branch is deleted.

## Dev loop: an engine change in a talk without re-pinning

Re-pinning a hash and reinstalling cost about 7 minutes per tweak. Instead,
link the addons to your checkout in a /tmp copy of outreach_talks. Tested on
2026-10-08 with the workspace layout (root `pnpm-workspace.yaml` over
`talks/*`), pnpm 10.33 and 9.15.9, on the OpenData talk:

    export PATH=~/micromamba/envs/outreach_talks/bin:$PATH
    W=/tmp/build/<label>; SV=~/slidev-videos/.claude/worktrees/<slug>
    git clone -q ~/outreach_talks $W/ot
    # a talk's uncommitted work, if wanted:
    rsync -a --exclude node_modules --exclude dist --exclude shots \
      ~/outreach_talks/talks/<t>/ $W/ot/talks/<t>/

1. `pnpm install` in `$SV` first: the linked engine resolves its own
   imports (`@fontsource/space-grotesk`) from `$SV/node_modules`, and the
   build fails without it. Then in `$W/ot/package.json` add (absolute paths,
   `$SV` written out):

       "pnpm": { "overrides": {
         "slidev-addon-videos": "link:<SV>",
         "slidev-addon-stage": "link:<SV>/packages/stage" } }

   then `cd $W/ot && pnpm install`. In every talk of the copy,
   `node_modules/slidev-addon-*` are now symlinks into `$SV`.
2. If the talk imports three itself (builders in `setup/`), add
   `resolve: { dedupe: ['three'] }` to its `vite.config.ts` (create it if
   missing), e.g.
   `export default { optimizeDeps: { exclude: ['slidev-addon-stage', 'three'] }, resolve: { dedupe: ['three'] } }`.
   The linked engine imports three from `$SV/node_modules`, the talk from its
   own: OpenData's build carried two copies without the line and one with it,
   and in `slidev dev` both then import the same file. Innoday, with no three
   of its own, had one copy either way.
3. Edit in `$SV`, then `pnpm exec slidev build deck.md --out $W/site --base /`
   (about 6 s, no install) or keep `pnpm exec slidev deck.md` running; Slidev
   serves files from addon roots, linked ones included.

`pnpm link <dir>` works too but writes a root dependency, an `overrides:`
entry in `pnpm-workspace.yaml` and the lockfile; the explicit override is
easier to see and undo. Never do any of this in `~/outreach_talks` or a talk's
worktree: it rewrites `pnpm-lock.yaml` under a live session.

For the CLI: `python3 -m venv $W/venv && $W/venv/bin/pip install -e $SV`,
then `PATH=$W/venv/bin:$PATH` in the copy, and `pnpm videos:*` runs your
checkout. Never pip install into the shared `/usr/bin/python3` user site.

Pin a tag only at release.

## Tests

    export PATH=~/micromamba/envs/outreach_talks/bin:$PATH
    PYTHONPATH=src /usr/bin/python3 -m pytest tests -q
    pnpm install && pnpm test:all      # clip, example build + smoke, stage tests, stage build + smoke
    pnpm stage:test                    # stage unit tests alone
    node packages/stage/bin/check.mjs packages/stage/example

`PYTHONPATH=src` matters: without it `slidev_videos` imports from the main
checkout's editable install, not your worktree. Wrap headless browser runs
(smoke, shots) in `flock /tmp/slidev-stage-shots.lock <cmd>` and keep them to
a few slides: other sessions run headless WebGL on the same CPU. Commit bins
executable (`git update-index --chmod=+x`); pnpm install sets the bit, and
git would show a change that release.py refuses.

## Machine gotchas

- `~/.local/bin/ffmpeg` and `ffprobe` (static 7.0.2) come first on the bare
  PATH and exit 139 (segfault) on any `https://` input, silently under
  `-v error`. Use the micromamba env's build (it also has NVENC). `frames`
  downloads and cuts locally to get round it; `preflight` of release-only
  clips needs the env's ffmpeg.
- The bare PATH starts with a Windows pnpm shim under `/mnt/c`; use the env's.
- With the env first, `python3` is the env's Python, which has no pytest; run
  pytest and `release.py` with `/usr/bin/python3`.
- The editable install's metadata keeps the version it was installed at
  (0.1.0) until `pip install -e` is re-run; `slidev_videos.__version__` is
  current.
- The shell is zsh: quote globs.

## Releasing

1. The owner merges what goes in (merge commits) and pulls main.
2. Make CHANGELOG.md's `## Unreleased` match what landed.
3. In an installed checkout on main:
   `PATH=~/micromamba/envs/outreach_talks/bin:$PATH /usr/bin/python3 scripts/release.py X.Y.Z [--stage A.B.C] --dry-run`,
   read the plan and the diff, then run it without `--dry-run`. Give
   `--stage` when `packages/stage` changed (the plan says so). It checks the
   tree, runs both test suites, commits `chore: vX.Y.Z` and tags locally.
4. Run the two commands it prints (`git push --atomic origin main
   refs/tags/vX.Y.Z`, `gh release create ...`), or pass `--push`.
5. In outreach_talks: `pnpm talk bump-toolkit vX.Y.Z` (the talks' two addon
   pins, `new_talk.py`'s `ADDONS_REF`, `env.yaml`). Talks being filmed or
   presented keep their pin until delivered.

## Durable rules

- The repo grows into a toolkit for keynote talks: one package per capability
  under `packages/`, configured from deck headmatter, extended by registration
  (builders, palettes), with no talk's content in it.
- Tools meet through window events, not imports, so a deck can take one
  without the other.
- In the stage, build scenes of grains of light, of a piece with the dust. No
  solid meshes, floating labels or scale bars for keynote visuals: the owner
  rejected a Solar System of lit spheres as cheap. The solid builders (`orbs`,
  `ring`, `bar`, `tracks`, `page`) remain for diagrams.
- Headless checks render in software (llvmpipe or SwiftShader). Visual
  reworks wait until the owner has seen them on a real GPU: show screenshots,
  keep the PR a draft until then.
- The repo is public: no personal data in any file or commit. Refer to the
  owner as "the owner".
- Commits: `type(scope): what changes, in plain words` (scopes such as
  player, stage, cli, check, shared); the body says why.
