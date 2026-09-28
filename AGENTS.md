# dsh-context

A DeepSeek Harness plugin for context insight, actions, and management.

## Background

- DeepSeek Harness (dsh):
  - an open-source agent harness developed by DeepSeek AI.
  - Github: https://github.com/deepseek-ai/deepseek-harness
  - NPM: @deepseek-ai/dsh
  - MUST ensure the full clone of the DeepSeek Harness repository is available locally, before any work.
  - MUST always dive deep into the details of dsh source code and dependencies, for its mechanisms, lifecycles, and modules. Ensure every decision is based on the full and actual truth of the dsh source code.
  - Local git clone of [dsh](https://github.com/deepseek-ai/deepseek-harness):
    - may be found in the `~/dev/deepseek-harness` directory
    - `git pull` on the `main` branch to update
    - commits and version tags are available for reference and diff
    - run `pnpm install` to update dependencies after a `git pull` or switching commit/tag

- DeepSeek Harness Plugin:
  - docs:
    - Reference: https://deepseek-harness.github.io/deepseek-harness/en/reference/
  - Example plugins:
    - Available on GitHub topic `dsh-plugin`: https://github.com/topics/dsh-plugin

## Coding
- Always consider the minimal change and the most performance efficient implementation.
- Try best to use the existing classes, utilities, styles, style tokens, events, presets and lifecycles provided by DeepSeek Harness.ess.
- Use English in code comments, documentation, Pull Request description, and commit messages.
- Smaller, less-coupling and modulized code and tests are preferred for better maintainability and testability.
- Avoid adding unnecessary code comments (unless for the pinned major decision or for those provide significant value) and code duplication.
- Update or remove the outdated or unhelpful code comments when modifying the code.
- Before any commit, MUST ALWAYS do ALL the following checks:
  - Check the to-do list, and ensure all the items are properly completed or closed.
  - Carefully independently review and simplify all the diffs and all code changes, to ensure they are necessary, correct and not over-engineered. 
  - Cleanup the generated temporary files. Cleanup temporary or unhelpful comments.
  - MUST Run `pnpm run lint:fix && pnpm run test && pnpm run build` in single command and capture FULL output, to ensure:
    - passing all the linting and test
    - the per-file code coverage MUST BE literally 100%.
      - The coverage table lists ONLY the files below 100% (`coverage.skipFull` in `vitest.config.ts`): a passing run prints an empty table (headers only, no `All files` row), and the run also fails the `coverage.thresholds` gate when any file drops below 100 — the offending files then appear in the table.
      - Example passing output (nothing below 100%):
        - % Coverage report from v8
          -------------------|---------|----------|---------|---------|-------------------
          File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s 
          -------------------|---------|----------|---------|---------|-------------------
          -------------------|---------|----------|---------|---------|-------------------

## Layout & responsive

- The plugin pane is the shell's center column, not the viewport — its width follows the sidebar's collapse and drags. Drive responsive layout with container queries (the harness's own idiom), not viewport media queries.
- Fold, never crush: under width pressure, wrap rows or fold grid columns instead of truncating into unreadability. No horizontal scrollbars, no overlapping content, and every field stays reachable on the narrowest pane.
- Mind container-query side effects: size containment changes containing-block behavior, so fullscreen overlays portal to `document.body`. Point-of-use specifics live in the CSS comments next to the rules they guard.
- Verify layout changes visually before shipping: a spread of widths from desktop down to phone (~390px), in both locales (English labels are the truncation stress case), on a long session, including the `/context` modal.

## Building
- Run `pnpm run build` after code changes applied.
- Run `pnpm run watch` to keep hot-reloaded on dsh with local plugin installed. It also helps developer to see the code changes in the browser.

## DSH web server
- The dsh web server may be already running, and accessible at `http://127.0.0.1:3080/` by browser.
- Run `pnpm run web` to restart the dsh web server (kills the running `dsh web` first, then starts `dsh web --no-open`).
- If the auth token issue encounters with browser, kill the dsh process and restart it by running `dsh web --no-open`.
  - Example output: 
    - $ dsh web --no-open
      > dsh web: http://127.0.0.1:3080/?token=XXXXXXXXX

## Dependency
- Consider updating the dependencies to the latest version if possible, as the deepseek-harness is evolving rapidly.

## Compatibility - Important!
- MUST install and work correctly on every supported `@deepseek-ai/dsh` release, with no regressions in runtime dependencies, message parsing, or any user-visible behavior.
- **`docs/compatibility.md` is the single source of truth** — supported releases, durable-log generations, fold-by-shape and optional-seam rules, parsing resilience for untrusted log/projection data, low-level parity with the harness's own metering, and the baseline gates. Read it BEFORE any compatibility-relevant change, and keep it current whenever the code or the supported set changes.

## I18n
- Chinese (Simplified) and English are supported for UI elements.
- Update all the supported languages translations when adding or modifying the UI elements.
- Do not keep the deprecated or unused language keys.

## Docs
- `docs` directory contains only end-user faced documents.
- `docs/social-preview.png` (GitHub social preview) must be exactly **1280 × 640 pixels**.
- `README.md`
  - Images:
    - Only embed external links in the `README.md`, in order to help the readers on both GitHub and NPM to access the images
      - For example, putting the image in the `docs` directory and embedding it in the `README.md` with links:
        - ![some image](https://raw.githubusercontent.com/bowenliang123/dsh-context/main/docs/some-image.png)

## Temp files
- Generate one-time temp files in the `.tmp` directory, and properly clean them up right after use.

## Git
- When asked to commit, please commit the possibly mixed changes separately for each task or purpose.
- `gh` cli is installed and logged in.
- Run `git push` after create commits.

## Workflow

- To-do list
  - ALWAYS keep the coding agent's to-do list up to date throughout starting or finishing every step/task of planning, investigation and implementation.
  - Before closing any task, review all pending to-do items and ensure each is completed, cleaned up or explicitly closed.

## Tool Usage
- Always read the file first using the `read` tool before using the `edit` tool, which prevents errors like "Error: edit requires reading '/path/file' first — read the file, then retry."

## Releasing
- Version X.Y.Z, 大版本.次版本.小版本。
- Releases are cut by tagging: `git tag vX.Y.Z && gh release create vX.Y.Z`.
- A [GitHub Actions workflow](.github/workflows/release.yml) then builds, tests, and publishes the package to npm automatically by github workflow. Agent don't have to do or check it manually.
- Write the release notes from the [release template](.github/release_template.md)

<!-- CODEGRAPH_START -->
## CodeGraph
This repo is indexed by CodeGraph (a `.codegraph/` directory exists at the repo root, if not run `codegraph init` to initialize it).
- MUST reach for it BEFORE any grep/find or reading files when you need to understand or locate code:
- **Shell** (always works): ALWAYS run and collect ALL output of `codegraph sync -q && codegraph explore --path /some-path "<symbol names or question>"` without truncating text
<!-- CODEGRAPH_END -->