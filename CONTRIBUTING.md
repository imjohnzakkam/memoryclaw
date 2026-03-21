# Contributing to MemoryClaw

Thanks for your interest in contributing! Here's how to get started.

## Setup

```bash
git clone https://github.com/imjohnzakkam/memoryclaw.git
cd memoryclaw
bun install
bun test
```

## Development

- **Runtime:** [Bun](https://bun.sh)
- **Language:** TypeScript (strict mode, ES modules only)
- **Tests:** [Vitest](https://vitest.dev) — run with `bun test`

## Guidelines

1. **Run tests before submitting.** All 102 tests must pass.
2. **ES modules only.** No `require()` or CommonJS.
3. **Keep it simple.** MemoryClaw values transparency — code should be readable and debuggable.
4. **Test what you add.** New features need test coverage.
5. **Follow existing patterns.** Look at similar modules for style guidance.

## File Conventions

- Episode filenames: `YYYY-MM-DD_HH-MM-SS_summary.md`
- Log filenames: `YYYY-MM-DD_HH-MM-SS_channel_raw.md`
- YAML frontmatter must include: `timestamp`, `tags`, `summary`, `participants`, `confidence`

## Pull Requests

1. Fork the repo and create your branch from `main`
2. Make your changes
3. Run `bun test` and ensure all tests pass
4. Submit a pull request with a clear description of the change

## Reporting Issues

Open an issue at [github.com/imjohnzakkam/memoryclaw/issues](https://github.com/imjohnzakkam/memoryclaw/issues) with:
- What you expected to happen
- What actually happened
- Steps to reproduce
