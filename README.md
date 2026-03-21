# QueryPad

> **Drop a file. Query with SQL. Visualize and share. All in your browser.**

**[Try it now](https://querypad.io)** | [Demo Video](https://querypad.io)

<!-- TODO: Add demo GIF or screenshot here -->
<!-- ![QueryPad Demo](demo.gif) -->

A browser-native SQL playground powered by DuckDB-Wasm. Drag & drop CSV, Parquet, JSON, or Excel files — write SQL, visualize results, and share with a link. No server, no account, no install.

## Features

- **File drag & drop** — Parquet, CSV, TSV, JSON, JSONL, NDJSON, Excel (.xlsx)
- **DuckDB-Wasm SQL** — Full analytical SQL in the browser (JOIN, GROUP BY, window functions, etc.)
- **Inline charts** — One-click Bar, Line, Scatter, Pie charts from query results (Recharts)
- **URL sharing** — Compress data + query into a single shareable link
- **AI SQL assistant** — Cmd+K for natural language → SQL (BYOK: bring your own Anthropic API key, runs entirely in browser)

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
