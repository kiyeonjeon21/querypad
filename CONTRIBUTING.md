# Contributing to QueryPad

Thanks for your interest in contributing to QueryPad!

## Development Setup

```bash
git clone https://github.com/kiyeonjeon21/querypad.git
cd querypad
npm install
npm run querypad -- inspect ./fixtures/data
```

QueryPad is a terminal-first, local-first CLI.
The product direction is **Cursor for Data** - understanding datasets (discovering relationships, building semantic models) before generating SQL.
See [ROADMAP.md](ROADMAP.md).

## Project Structure

```
src/
  core/            # pure logic, zero npm deps
    discovery/     # signals, relationships, semantic-model, verdicts, explain, ...
    agent/         # agentic ask loop + context builders
    sql/ format/   # shared sql utils, result formatters
    types/         # TypeScript type definitions (incl. discovery.ts)
  engine/
    duckdb/        # native @duckdb/node-api binding: connection, load, profile
  ai/              # LLM completion, SQL generation, providers (BYOK via env)
  embed/           # embedding interface + optional Transformers.js backend
  adapters/
    cli/           # querypad CLI: index.ts (dispatch), inspect, ask, explain, ...
test/              # Node test runner specs (unit + spawn-based CLI e2e)
fixtures/data/     # sample related files for CLI inspection
```

> `src/core` must stay free of npm dependencies and browser/Node APIs; surfaces
> (`src/adapters`) depend on core/engine, never the reverse.

## Running the CLI

```bash
npm run querypad -- inspect ./fixtures/data
# writes ./fixtures/data/.datactx/ (gitignored)

npm run build && npm link   # install a real `querypad` binary from dist/
```

## How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes
4. Run the local checks (`npm run check`)
5. Run `npm run test:cli` (unit + CLI e2e)
6. Commit your changes
7. Push to your fork and open a Pull Request

## Guidelines

- Keep PRs focused - one feature or fix per PR
- Follow existing code style and conventions
- Test your changes locally before submitting
- Keep `package.json`, `package-lock.json`, and the latest `CHANGELOG.md` release version in sync

## Reporting Issues

- Use [GitHub Issues](https://github.com/kiyeonjeon21/querypad/issues)
- Include steps to reproduce, expected behavior, and actual behavior

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
