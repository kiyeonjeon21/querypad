# QueryPad

> **Drop a file. Query with SQL. Share with a link.**

**[Try it now](https://querypad-delta.vercel.app/)** — no install required.

A browser-native SQL playground powered by DuckDB-Wasm. Drag & drop Parquet, CSV, JSON, or Excel files, write SQL queries, visualize results — all in your browser. No server, no account, no install.

## Features

- **File drag & drop** — Parquet, CSV, TSV, JSON, JSONL, NDJSON, Excel (.xlsx)
- **DuckDB-Wasm SQL** — Full analytical SQL in the browser (JOIN, GROUP BY, window functions, etc.)
- **Monaco Editor** — Table/column autocomplete, syntax highlighting, Cmd+Enter to run
- **Virtualized table** — Smooth rendering up to 10,000 rows (@tanstack/react-virtual)
- **URL sharing** — Compress data + query with gzip + base64url into a single shareable link
- **IndexedDB persistence** — Data and queries survive page refresh and tab close
- **Inline charts** — One-click Bar, Line, Scatter, Pie charts from query results (Recharts)
- **Multi-tab editor** — IDE-style tabs with independent queries and results per tab
- **Export anywhere** — CSV, JSON, Markdown, HTML, Excel, Parquet, clipboard
- **S3/HTTP loading** — Load remote Parquet/CSV/JSON files by URL
- **AI SQL assistant** — Cmd+K for natural language to SQL streaming (BYOK: bring your own Anthropic API key, runs entirely in browser)
- **Transform pipelines** — Chain queries with DAG visualization. Per-step results, referenceable as temp tables
- **Plugin system** — Extend with visualizations, exporters, file loaders, SQL macros via ES module URLs
- **Real-time collaboration** — PartyKit + Y.js CRDT. Remote cursors, tab/query/file sync. Works perfectly without collaboration

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

### Real-time Collaboration (Optional)

To use collaboration features, run the PartyKit server separately:

```bash
npm run partykit:dev
```

WebSocket server starts at `localhost:1999`. Use the "Collaborate" button in the app to create or join rooms.
Everything works without PartyKit — collaboration is fully optional.

### Sample Data

Test files are available in the `sample/` folder:

- **departments.csv** — 4 departments (dept_id, dept_name, budget, manager_id)
- **employees.csv** — 12 employees (emp_id, name, dept_id, salary, hire_date)
- **projects.json** — 6 projects (project_id, project_name, dept_id, lead_emp_id, status)

```
departments (dept_id) ←── employees (dept_id)
                              ↑
projects (lead_emp_id) ───────┘
projects (dept_id) ──────→ departments (dept_id)
```

### Example Queries

```sql
-- Headcount and avg salary vs budget by department
SELECT d.dept_name, d.budget,
       COUNT(e.emp_id) as headcount,
       ROUND(AVG(e.salary)) as avg_salary
FROM departments d
JOIN employees e ON d.dept_id = e.dept_id
GROUP BY d.dept_name, d.budget;

-- 3-table join: project + lead name + department
SELECT p.project_name, p.status,
       e.name as lead_name, d.dept_name
FROM projects p
JOIN employees e ON p.lead_emp_id = e.emp_id
JOIN departments d ON p.dept_id = d.dept_id
ORDER BY p.start_date;
```

## Tech Stack

| Area | Technology |
|------|-----------|
| AI | Anthropic Claude API (BYOK, direct browser calls) |
| Framework | Next.js + TypeScript + Tailwind CSS v4 |
| SQL Engine | DuckDB-Wasm (eh bundle, single-threaded) |
| Editor | Monaco Editor (@monaco-editor/react) |
| State | Zustand |
| Sharing | pako (gzip) + base64url encoding |
| Table rendering | @tanstack/react-virtual |
| Persistence | idb-keyval (IndexedDB) |
| Charts | Recharts |
| Excel parsing | SheetJS (xlsx) |
| DAG visualization | @xyflow/react + @dagrejs/dagre |
| Collaboration | PartyKit + Y.js + y-monaco |

## Project Structure

```
src/
├── app/
│   ├── layout.tsx              # Root layout
│   ├── page.tsx                # Main workspace
│   ├── globals.css
│   └── shared/page.tsx         # /shared?s=... (shared URL loader)
├── components/
│   ├── workspace/Workspace.tsx # Layout orchestration
│   ├── dropzone/
│   │   ├── DropZone.tsx        # File drag & drop
│   │   └── UrlInput.tsx        # Remote file loading via URL
│   ├── sidebar/
│   │   ├── Sidebar.tsx         # Table list
│   │   └── TableSchema.tsx     # Column info display
│   ├── editor/
│   │   ├── SqlEditor.tsx       # Monaco editor wrapper
│   │   ├── TabBar.tsx          # Multi-tab strip
│   │   └── AiAssistant.tsx     # AI SQL assistant UI
│   ├── results/
│   │   ├── ResultsPanel.tsx    # Results panel (Table/Chart/Plugin tabs)
│   │   ├── DataTable.tsx       # Virtualized table
│   │   ├── ChartPanel.tsx      # Recharts chart rendering
│   │   ├── ChartConfig.tsx     # Chart type/axis selection UI
│   │   └── ExportButton.tsx    # Multi-format export (incl. plugin exporters)
│   ├── pipeline/
│   │   ├── PipelineEditor.tsx  # Pipeline main view (steps + DAG + results)
│   │   ├── PipelineStepCard.tsx # Step card (name + mini Monaco)
│   │   ├── PipelineDag.tsx     # @xyflow/react DAG canvas
│   │   └── PipelineResults.tsx # Selected step results
│   ├── plugins/
│   │   ├── PluginManager.tsx   # Plugin URL add/remove modal
│   │   └── PluginVisualization.tsx # Plugin viz wrapper (ErrorBoundary)
│   ├── collaboration/
│   │   ├── JoinDialog.tsx      # Room create/join modal
│   │   ├── RoomBar.tsx         # Connection status + peer avatars + Leave
│   │   └── PeerCursors.tsx     # Remote cursor display
│   └── share/ShareButton.tsx   # Share URL generation
├── lib/
│   ├── ai/
│   │   ├── api-key.ts          # localStorage API key get/set/clear (BYOK)
│   │   ├── generate-sql.ts     # Direct Anthropic API call from browser (SSE streaming)
│   │   └── schema-context.ts   # Table schema → text conversion
│   ├── duckdb/
│   │   ├── instance.ts         # DuckDB singleton initialization
│   │   ├── files.ts            # File → DuckDB table loading (incl. xlsx)
│   │   ├── queries.ts          # SQL execution + result transformation
│   │   └── remote.ts           # URL → fetch → DuckDB table loading
│   ├── charts/
│   │   └── detect.ts           # Auto chart type detection
│   ├── export/
│   │   ├── html.ts             # Self-contained HTML generation
│   │   ├── csv.ts              # RFC 4180 CSV
│   │   ├── json.ts             # Pretty-print JSON
│   │   ├── markdown.ts         # Pipe table
│   │   ├── excel.ts            # xlsx library based
│   │   ├── parquet.ts          # DuckDB COPY TO
│   │   └── clipboard.ts        # TSV → clipboard
│   ├── pipeline/
│   │   ├── execute.ts          # Topological sort → CREATE TEMP TABLE sequential execution
│   │   └── graph.ts            # Adjacency list, cycle detection, edge extraction
│   ├── plugins/
│   │   ├── registry.ts         # URL → dynamic import → manifest validation
│   │   └── builtin.tsx         # Built-in heatmap visualization example
│   ├── collaboration/
│   │   ├── sync.ts             # Y.js ↔ workspace-store bidirectional binding
│   │   └── file-sync.ts        # File peer broadcast (≤5MB)
│   ├── persistence/
│   │   └── indexeddb.ts        # IndexedDB save/load/clear (tabs + pipelines + plugins)
│   ├── sharing/
│   │   ├── encode.ts           # gzip + base64url encoding
│   │   └── decode.ts           # URL → data + query decoding
│   ├── xlsx/
│   │   └── parse.ts            # xlsx → CSV conversion
│   └── utils.ts
├── stores/
│   ├── workspace-store.ts      # Zustand central state (SQL + pipeline + plugins)
│   └── collaboration-store.ts  # Collaboration state (separate store, optional)
├── types/
│   ├── index.ts                # Common types + re-export
│   ├── pipeline.ts             # Pipeline, PipelineStep types
│   ├── plugin.ts               # PluginManifest, PluginExtension types
│   └── collaboration.ts        # PeerInfo, RoomState types
party/
└── index.ts                    # PartyKit server (Y.js relay, ~5 lines)
```

## URL Sharing

### How It Works

```
Source file → pako.deflate (gzip) → base64url encoding → URL query parameter
```

Clicking "Share" generates a URL like `https://querypad.app/shared?s=<encoded>`.
Recipients open the URL and the browser automatically decodes → restores DuckDB tables → prefills queries.

### Practical Size Limits

Based on a safe URL limit of ~8KB:

| Data type | Compression ratio | Original size that fits in URL |
|---|---|---|
| CSV (repetitive) | 10:1 | ~60 KB |
| CSV (typical) | 7:1 | ~42 KB |
| JSON (typical) | 5:1 | ~30 KB |
| JSON (diverse values) | 3:1 | ~18 KB |

**Small CSVs of 500–2,000 rows can be shared via a single URL.**

Chrome supports URLs up to 2MB, but considering proxy/CDN/web server defaults (8KB), 8KB is the safe limit. Excalidraw, Mermaid Live Editor, and TypeScript Playground use the same approach.

### Limitations

- UI warning when combined source files exceed 100KB
- Additional warning when URL exceeds 8,000 characters
- Large file sharing will be addressed with R2/KV backend or HTML export

## Changelog

### v0.3 — Collaboration & Extensibility

- **Transform pipelines** — Query chaining + DAG visualization (@xyflow/react + dagre). Topological sort, cycle detection, referenceable as temp tables in SQL tab
- **Plugin system** — 4 extension types via ES module URL (visualization, exporter, file loader, SQL macro). IndexedDB persistence, ErrorBoundary isolation
- **Real-time collaboration** — PartyKit + Y.js CRDT. Query text (y-monaco), tabs, files (≤5MB) real-time sync. Remote cursors, graceful degradation

### v0.2 — Power Features

- **Multi-format export** — CSV, JSON, Markdown, HTML, Excel, Parquet, clipboard. Dropdown menu
- **Multi-tab editor** — IDE-style tab add/delete/switch/rename, independent query + results per tab, IndexedDB persistence
- **S3/HTTP loading** — Load remote files via URL → DuckDB. CORS error guidance
- **AI SQL assistant** — Cmd+K → natural language → SQL streaming (BYOK: your own Anthropic API key, direct browser call). Only schema sent, never your data

### v0.1 — Core

- **IndexedDB persistence** — idb-keyval based. 500ms debounced auto-save, restore on refresh, Clear button
- **Excel (.xlsx) support** — SheetJS xlsx → CSV conversion then DuckDB load. First sheet, dynamic import
- **HTML export** — Self-contained HTML download. Inline CSS, XSS prevention, `__QUERYPAD_DATA__` embed
- **Inline charts** — Recharts Bar/Line/Scatter/Pie. Auto chart type detection, axis selection UI

## Deployment

### Vercel (Recommended)

**Step 1: Connect Vercel project**

Select the GitHub repository at [vercel.com/new](https://vercel.com/new).

**Step 2: Build settings (auto-detected)**

> No server environment variables required. The AI SQL assistant uses BYOK (Bring Your Own Key) — users enter their own Anthropic API key and the browser calls the Anthropic API directly. DuckDB-Wasm, file loading, SQL execution, charts, export, pipelines, and plugins all run in the browser.

| Setting | Value |
|---------|-------|
| Framework Preset | Next.js |
| Build Command | `npm run build` |
| Output Directory | `.next` |
| Install Command | `npm install` |
| Node.js Version | 20.x |

**Step 3: Click Deploy**

Your app will be available at `https://your-project.vercel.app`.

### WASM File Serving

The `postinstall` script automatically copies DuckDB-Wasm files to `public/duckdb/`.
`next.config.ts` sets appropriate Content-Type and cache headers for `/duckdb/*`:

```
Content-Type: application/wasm
Cache-Control: public, max-age=31536000, immutable
```

### Custom Domain

Add a custom domain in Vercel Dashboard → Settings → Domains.
Add a CNAME record (`cname.vercel-dns.com`) to your DNS and HTTPS is configured automatically.

### Real-time Collaboration Deployment (Optional)

To use collaboration in production, deploy PartyKit separately:

```bash
npx partykit deploy
```

Enter the host address (e.g., `querypad-collab.username.partykit.dev`) in the "Collaborate" dialog's PartyKit Host field.

> PartyKit free tier: 20 concurrent connections per room, Cloudflare Workers edge deployment.
> Everything works without PartyKit — collaboration is fully optional.

### Architecture

```
Vercel (static serving)               User's Browser (all computation)
┌─────────────────────┐              ┌──────────────────────────┐
│ HTML/JS/CSS/WASM    │── download ─→│ DuckDB-Wasm (SQL engine) │
│ static files only   │              │ IndexedDB (data storage)  │
│                     │              │ Monaco Editor             │
│                     │              │ Zustand (state mgmt)      │
│                     │              │ @xyflow/react (DAG)       │
│                     │              │ AI: BYOK Anthropic API    │
│                     │              │  (browser → API direct)   │
└─────────────────────┘              └──────────────────────────┘

PartyKit (optional)
┌─────────────────────┐
│ WebSocket relay     │←─ optional ─→ Y.js CRDT sync
│ (Y.js msg forwarding)│
└─────────────────────┘
```

The server only serves static files. All computation and data — including AI — stays in the user's browser and never touches the server.

### Design Decisions

- **eh bundle**: Works without COI (Cross-Origin-Isolation) headers. Simplifies Vercel deployment (single-threaded but sufficient for the use case)
- **Zustand**: No Provider needed, compatible with Next.js App Router, selectors prevent unnecessary re-renders
- **dynamic import (ssr: false)**: Monaco Editor and DuckDB-Wasm are browser-only, so SSR is disabled
- **Pipeline dependency detection**: Word boundary regex instead of SQL parser to detect step name references. Simple and sufficient
- **No plugin sandboxing**: Direct `import()` loading in MVP. Trusted sources only recommended
- **Collaboration code fully dynamic**: yjs/y-partykit/y-monaco loaded only on "Collaborate" click. Zero bundle size impact
- **Separate collaboration store**: Optional feature gets its own Zustand store, separate from workspace-store
- **AI BYOK (Bring Your Own Key)**: Browser calls Anthropic API directly (`anthropic-dangerous-direct-browser-access` header) instead of server proxy. No server API key needed, zero deployment cost for AI, consistent with the "no server" philosophy. API key stored only in localStorage

## Contributing

Contributions are welcome! Feel free to open issues and pull requests.

## License

MIT
