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

## Releases

QueryPad is a web app, not an npm package. Version numbers mark GitHub
release milestones and public product updates. See [CHANGELOG.md](CHANGELOG.md)
for release notes.

## Contributing

Contributions are welcome! Feel free to open issues and pull requests.

## License

MIT

---

Built by [@vericontext](https://x.com/vericontext)
