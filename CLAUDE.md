@AGENTS.md

## Shell commands

This project runs with `permissions.blockReadsOutsideWorkingDirectories`. Any shell command the permission parser can't fully analyse stops with an approval prompt, even when it stays inside the repo. So:

- Read files with the Read tool and search with Grep/Glob, not `cat`, `grep -r` or `find` in Bash.
- Write and change files with the Write and Edit tools, never with heredocs, `echo >`, `tee` or `sed -i`.
- No shell variables, `for` loops, command substitution (`$(...)` or backticks) or `xargs`. Write each path out in full, or run a listing command first and pass the paths explicitly in a second command.
- Keep each command simple: one tool per call where you can, `&&` chains of plain commands at most.
- Never put a path containing `[`, `]`, `(` or `)` (such as `[locale]`) in a Bash command, even quoted. The check treats it as a glob and asks. Use Glob, Grep and Read for those paths. For checks, run `pnpm typecheck`, `pnpm lint:es`, or `pnpm test <name>` (Vitest filters by substring, so a file or folder name is enough).
- Never use `npx`, `pnpx` or `pnpm exec`. They look up the program only when the command runs, so the check always asks. Run tools through the package scripts below.

The pipeline subagents in `.claude/agents/` carry the same rules.

## Checks

- Tests: `pnpm test` (Vitest), or `pnpm test <name>` for a subset
- Types: `pnpm typecheck`
- ESLint on the source folders: `pnpm lint:es` (`eslint lib components app tests`)
- Full lint: `pnpm lint` (`eslint .`; it also picks up the git-ignored `.vercel/output`, so prefer `pnpm lint:es`)
