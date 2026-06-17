# Contributing to QueryPad

Thanks for your interest in contributing to QueryPad!

## Development Setup

```bash
git clone https://github.com/vericontext/querypad.git
cd querypad
npm install
npm run dev
```

The app will be available at `http://localhost:3000`.

QueryPad has two surfaces sharing one engine-agnostic understanding core: a **web
app** (DuckDB-Wasm in the browser) and a **CLI** (native `@duckdb/node-api` in Node).
The product direction is **Cursor for Data** — understanding datasets (discovering
relationships, building semantic models) before generating SQL. See
[ROADMAP.md](ROADMAP.md).

## Project Structure

```
src/
  app/             # Next.js app router pages
  components/      # React components (web app)
  cli/             # querypad CLI: index.ts (dispatch), inspect.ts, artifacts.ts
  lib/
    discovery/     # engine-agnostic core: signals.ts (pure), relationships.ts
    duckdb/        # browser DuckDB-Wasm: profile.ts, sql-utils.ts (shared)
    duckdb-node/   # Node DuckDB: connection.ts, load.ts, profile.ts
    ai/            # SQL generation, providers, BYOK key storage
  stores/          # Zustand state management
  types/           # TypeScript type definitions (incl. discovery.ts)
test/              # Node test runner specs for discovery/CLI
fixtures/data/     # sample related files for CLI inspection
```

> Node-only code (`src/cli`, `src/lib/duckdb-node`) must not be imported by app code —
> it would pull the native DuckDB addon into the browser bundle.

## Running the CLI

```bash
npm run querypad -- inspect ./fixtures/data
# writes ./fixtures/data/.querypad/ (gitignored)
```

## How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes
4. Run the local checks (`npm run check`)
5. Run the e2e tests (`npm test`) for UI changes, and `npm run test:cli` for discovery/CLI changes
6. Commit your changes
7. Push to your fork and open a Pull Request

## Guidelines

- Keep PRs focused — one feature or fix per PR
- Follow existing code style and conventions
- Test your changes locally before submitting
- Keep `package.json`, `package-lock.json`, and the latest `CHANGELOG.md` release version in sync

## Reporting Issues

- Use [GitHub Issues](https://github.com/vericontext/querypad/issues)
- Include steps to reproduce, expected behavior, and actual behavior
- Screenshots are helpful for UI-related issues

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
