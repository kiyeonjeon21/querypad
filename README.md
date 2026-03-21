# QueryPad

> **Drop a file. Query with SQL. Visualize and share. All in your browser.**

A browser-native SQL playground powered by DuckDB-Wasm. Drag & drop CSV, Parquet, JSON, or Excel files — write SQL, visualize results, and share with a link. No server, no account, no install.

<p align="center">
  <a href="https://querypad.io"><strong>Try it now</strong></a>
</p>

<p align="center">
  <video src="https://github.com/user-attachments/assets/5fa069e0-aaa2-4cc1-9735-df93b840f44d" width="100%" />
</p>

## Why QueryPad?

You have a CSV. You want to run a quick SQL query. You don't want to spin up a database, open a notebook, or install anything.

QueryPad lets you drop files and start querying in seconds. Everything runs in your browser — your data never leaves your machine.

## Features

- **Drag & drop anything** — CSV, Parquet, JSON, Excel — drop multiple formats at once and JOIN them
- **DuckDB-Wasm SQL** — Full analytical SQL in the browser (JOIN, GROUP BY, window functions, etc.)
- **Inline charts** — One-click Bar, Line, Scatter, Pie charts from query results
- **URL sharing** — Compress data + query into a single shareable link
- **AI SQL assistant** — Cmd+K for natural language to SQL (BYOK: bring your own Anthropic API key, runs entirely in browser)
- **Sample data on first visit** — Start exploring immediately, drop your own files when ready

### Advanced Features

- **Monaco Editor** — Table/column autocomplete, syntax highlighting, Cmd+Enter to run
- **Virtualized table** — Smooth rendering up to 10,000 rows
- **IndexedDB persistence** — Data and queries survive page refresh
- **Multi-tab editor** — IDE-style tabs with independent queries and results
- **Export anywhere** — CSV, JSON, Markdown, HTML, Excel, Parquet, clipboard
- **S3/HTTP loading** — Load remote Parquet/CSV/JSON files by URL
- **Transform pipelines** — Chain queries with DAG visualization
- **Plugin system** — Extend with visualizations, exporters, file loaders, SQL macros
- **Real-time collaboration** — PartyKit + Y.js CRDT with remote cursors
- **File size guardrails** — 100 MB per file limit with clear warnings

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Sample data is automatically loaded on first visit.

## Tech Stack

| Area | Technology |
|------|-----------|
| SQL Engine | DuckDB-Wasm |
| Framework | Next.js + TypeScript + Tailwind CSS v4 |
| AI | Anthropic Claude API (BYOK, browser-direct) |
| Editor | Monaco Editor |
| State | Zustand |
| Charts | Recharts |
| Persistence | IndexedDB (idb-keyval) |
| Collaboration | PartyKit + Y.js (optional) |

## Changelog

### v0.6 — Open-Source Release

- Vercel Analytics integration
- OG image and Twitter card metadata for social sharing
- Playwright e2e test suite
- CONTRIBUTING.md and project metadata

### v0.5 — Query Engine Fixes

- DATE and TIMESTAMP columns now display as human-readable ISO strings instead of raw epoch milliseconds
- DECIMAL values now display correctly with proper scale (e.g. `0.3` instead of `3`)
- Multi-statement SQL support — semicolon-separated queries execute sequentially, last result displayed
- Share URL v2 binary format — eliminates double base64 encoding, supports larger datasets reliably
- Backward-compatible decoding for existing v1 share links
- Clean floating-point display — removes IEEE 754 noise (e.g. `869.8600000000001` → `869.86`)

### v0.4 — Onboarding & File Management

- Sample data pre-loaded on first visit with welcome banner
- Global drag-and-drop — drop files anywhere on the workspace
- Add file modal with drag area, browse, and URL input
- Per-table delete (hover X button in sidebar)
- Auto-cleanup of sample data when user adds own files
- File size validation (100 MB hard limit, 50 MB soft warning)

### v0.3 — Collaboration & Extensibility

- Transform pipelines with DAG visualization
- Plugin system (4 extension types via ES module URL)
- Real-time collaboration (PartyKit + Y.js CRDT)

### v0.2 — Power Features

- Multi-format export (CSV, JSON, Markdown, HTML, Excel, Parquet)
- Multi-tab editor with IndexedDB persistence
- S3/HTTP remote file loading
- AI SQL assistant (BYOK streaming)

### v0.1 — Core

- IndexedDB persistence
- Excel (.xlsx) support
- HTML export
- Inline charts with auto-detection

## Contributing

Contributions are welcome! Feel free to open issues and pull requests.

## License

MIT

---

Built by [@vericontext](https://x.com/vericontext)
