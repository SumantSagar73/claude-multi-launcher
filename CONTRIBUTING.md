# Contributing

Thanks for helping. This is a small project, so the process is light.

## Set up

Needs Windows 10/11, Node.js 24 or newer, and Claude Desktop from the Microsoft Store (so there is something to
launch).

```powershell
npm install
npm start       # run from source
npm test        # unit tests
```

## Work safely: never test against real accounts

This tool sits next to someone's real Claude data. When you run or test it:

- **Use a scratch data folder.** Set `CML_USER_DATA` to an empty folder so your real accounts are not involved:
  ```powershell
  $env:CML_USER_DATA = "$env:TEMP\cml-dev"
  npm start
  ```
- **Never write to, close or restyle the Default account** (`%APPDATA%\Claude`) in code or in tests. Code that
  quits, trims, styles or tiles must skip Default; keep it that way.
- **Never read or log sign-in tokens, cookies or device identifiers**, and never print a sign-in link's query string
  (it carries a one-time code). `describeUrl` shows the host and path only.
- **Do not take full-desktop screenshots to check UI.** Use `electron . --screenshot=out.png`, which captures only the
  launcher's own window (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for `CML_ZOOM` and `CML_CLICK`). To check
  where a window landed, read its rectangle (`GetWindowRect`) rather than photographing the screen.

## Making a change

- Put decisions in small pure functions (`router.js`, `layout.js`, `profiles.js`) and add a test in `test/`. Anything
  that needs Windows or a real Claude process is checked by hand.
- Run `node --check` on the files you touched and `npm test` before opening a PR.
- If a Claude update breaks something, describe what changed. The health check and *Activity* list are the first
  place to look.
- Write escapes (`\n`, `\\`) into source files with your editor, not through shell heredocs, which mangle them.

## Pull requests

1. Fork, branch from `main`, keep the change focused.
2. Describe what changed and how you tested it. The pull request template has a short checklist.
3. CI runs the tests on Windows and must pass.

## Releasing (maintainers)

1. Update `version` in `package.json` and add an entry to `CHANGELOG.md`.
2. Commit, then tag and push: `git tag v1.2.3` and `git push origin v1.2.3`.
3. The **Release** workflow builds the installer and portable zip, writes `SHA256SUMS.txt`, and publishes a GitHub
   release with generated notes. It refuses to publish if the tag does not match `package.json`.
4. To rehearse without publishing, run the workflow manually from the Actions tab; it uploads the files as a build
   artifact only.

The build is unsigned. If a code-signing certificate becomes available, add signing to `scripts/release.js`.
