# Contributing

Contributions are welcome. The project is a TypeScript stack - an Express
backend and a React (Vite) frontend - with ESLint, TypeScript type-checking and
production builds wired together by [`./precommit.sh`](https://github.com/Locko2901/vane/blob/main/precommit.sh),
so you can run every check with one command.

## Reporting issues

- Use the [issue tracker](https://github.com/Locko2901/vane/issues).
- Include: what you tried, what happened, what you expected. Manager logs
  (`./run-docker.sh --logs`) and relevant environment variables (with API
  tokens redacted) help a lot.

## Development setup

See the **Development** section of the
[README](https://github.com/Locko2901/vane/blob/main/README.md#development)
for the full setup. Short version:

```bash
# Backend
cd vane/backend
npm install
npx prisma generate --schema ../prisma/schema.prisma
npm run dev

# Frontend (in a second shell; proxies /api to :3000)
cd vane/frontend
npm install
npm run dev
```

## Pull requests

- Fork, branch off `main`, open a PR against `main`.
- Keep PRs focused - one logical change per PR.
- Run [`./precommit.sh`](https://github.com/Locko2901/vane/blob/main/precommit.sh)
  before pushing. It generates the Prisma client, runs ESLint (backend +
  frontend), TypeScript type-checking, and the backend + frontend production
  builds.

## Commit messages - required format

This repo uses **[Conventional Commits](https://www.conventionalcommits.org/)**.
The release version, git tag, GitHub Release, and changelog are all generated
from commit messages by
[release-please](https://github.com/googleapis/release-please). Non-conforming
commits won't break anything but will be excluded from the changelog.

| Prefix | Use for | Bump (when highest in the batch) |
|---|---|---|
| `feat!:` / `fix!:` | breaking change (or add `BREAKING CHANGE:` footer) | **major** |
| `feat:` | new user-facing feature | minor |
| `fix:` | bug fix | patch |
| `perf:` | performance improvement | patch |
| `docs:` | documentation only | patch |
| `refactor:` | code change with no behavior change | patch |
| `style:` | formatting, no logic | patch |
| `test:` | tests | patch |
| `ci:` / `build:` | CI or build tooling | patch |
| `chore:` | misc maintenance | patch |

Any conventional commit ends up in a Release PR. If a batch contains a `feat:`,
the bump is minor; if anything is breaking, major; otherwise patch. If you don't
want a release yet, just don't merge the open Release PR - it keeps accumulating
until you do.

Optional scope in parentheses, e.g. `feat(backend): add token test endpoint` or
`feat(frontend): add backup preview`.

## Code style

- **TypeScript (backend & frontend)**: ESLint (configs in
  `vane/backend/eslint.config.mjs` and
  `vane/frontend/eslint.config.js`). Run `npm run lint:fix` in either
  package to auto-fix.
- **Database**: Prisma schema in `vane/prisma/schema.prisma`. Run
  `npx prisma generate` after changing it.

## License

By contributing, you agree your contributions are licensed under the [MIT License](https://github.com/Locko2901/vane/blob/main/LICENSE).
