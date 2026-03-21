# QueryPad

> **Query any file. Visualize instantly. Share with a link.**

브라우저에서 Parquet/CSV/JSON 파일을 드래그앤드롭하고, DuckDB-Wasm으로 SQL 쿼리를 실행하는 데이터 플레이그라운드.
서버 없이, 계정 없이, 브라우저만으로 동작합니다. 변환 파이프라인, 플러그인 시스템, 실시간 협업까지 지원합니다.

## 핵심 기능

- **파일 드래그앤드롭** — Parquet, CSV, TSV, JSON, JSONL, NDJSON, Excel(.xlsx) 지원
- **DuckDB-Wasm SQL** — 브라우저에서 네이티브급 SQL 실행 (JOIN, GROUP BY, 윈도우 함수 등)
- **Monaco 에디터** — 테이블/컬럼 자동완성, 구문 하이라이팅, Cmd+Enter 실행
- **가상화 테이블** — @tanstack/react-virtual로 10,000행까지 부드러운 렌더링
- **URL 공유** — 데이터+쿼리+결과를 gzip+base64url로 압축하여 URL 하나로 공유
- **IndexedDB 영속 저장** — 탭을 닫아도 데이터와 쿼리가 유지되며, 새로고침 시 자동 복원
- **인라인 차트** — 쿼리 결과에서 Bar, Line, Scatter, Pie 차트를 원클릭으로 시각화 (Recharts)
- **HTML 내보내기** — 쿼리+결과를 self-contained HTML로 다운로드하여 오프라인 공유
- **멀티 탭 에디터** — IDE 스타일 탭 추가/삭제/전환/이름변경, 탭별 독립 쿼리+결과, IndexedDB 복원
- **다양한 내보내기** — CSV, JSON, Markdown, HTML, Excel, Parquet, 클립보드 복사 (드롭다운 메뉴)
- **S3/HTTP 직접 읽기** — URL 입력으로 원격 Parquet/CSV/JSON 파일 직접 로드
- **AI SQL 어시스턴트** — Cmd+K로 자연어 → SQL 스트리밍 생성 (Anthropic API, 스키마만 전송)
- **변환 파이프라인** — 쿼리 체이닝 + DAG 시각화. "파일용 경량 dbt". 스텝별 결과 확인, SQL 탭에서 temp table 참조 가능
- **플러그인 시스템** — ES 모듈 URL로 시각화, exporter, 파일 로더, SQL 매크로 확장. ErrorBoundary 격리
- **실시간 협업** — PartyKit + Y.js 기반 CRDT. 원격 커서, 탭/쿼리/파일 동기화. 협업 없이도 완벽 동작

## 기술 스택

| 영역 | 기술 |
|------|------|
| AI | Anthropic Claude API (@anthropic-ai/sdk) |
| Framework | Next.js 15 + TypeScript + TailwindCSS v4 |
| SQL Engine | DuckDB-Wasm (eh 번들, 싱글 스레드) |
| Editor | Monaco Editor (@monaco-editor/react) |
| State | Zustand |
| 공유 | pako (gzip) + base64url 인코딩 |
| 테이블 렌더링 | @tanstack/react-virtual |
| 영속 저장 | idb-keyval (IndexedDB) |
| 차트 | Recharts |
| Excel 파싱 | SheetJS (xlsx) |
| DAG 시각화 | @xyflow/react + @dagrejs/dagre |
| 실시간 협업 | PartyKit + Y.js + y-monaco |

## 시작하기

```bash
npm install
npm run dev
```

`http://localhost:3000`에서 실행됩니다.

### 실시간 협업 (선택)

협업 기능을 사용하려면 PartyKit 서버를 별도로 실행합니다:

```bash
npm run partykit:dev
```

`localhost:1999`에서 WebSocket 서버가 시작됩니다. 앱 내 "Collaborate" 버튼으로 룸을 생성/참여할 수 있습니다.
PartyKit 서버 없이도 나머지 기능은 모두 정상 동작합니다.

### 샘플 데이터

`sample/` 폴더에 테스트용 파일이 있습니다:

- **departments.csv** — 부서 4개 (dept_id, dept_name, budget, manager_id)
- **employees.csv** — 직원 12명 (emp_id, name, dept_id, salary, hire_date)
- **projects.json** — 프로젝트 6개 (project_id, project_name, dept_id, lead_emp_id, status)

```
departments (dept_id) ←── employees (dept_id)
                              ↑
projects (lead_emp_id) ───────┘
projects (dept_id) ──────→ departments (dept_id)
```

### 예시 쿼리

```sql
-- 부서별 인원수, 평균연봉 vs 예산
SELECT d.dept_name, d.budget,
       COUNT(e.emp_id) as headcount,
       ROUND(AVG(e.salary)) as avg_salary
FROM departments d
JOIN employees e ON d.dept_id = e.dept_id
GROUP BY d.dept_name, d.budget;

-- 3테이블 조인: 프로젝트 + 리드 이름 + 부서명
SELECT p.project_name, p.status,
       e.name as lead_name, d.dept_name
FROM projects p
JOIN employees e ON p.lead_emp_id = e.emp_id
JOIN departments d ON p.dept_id = d.dept_id
ORDER BY p.start_date;
```

## 프로젝트 구조

```
src/
├── app/
│   ├── layout.tsx              # 루트 레이아웃
│   ├── page.tsx                # 메인 워크스페이스
│   ├── globals.css
│   └── shared/page.tsx         # /shared?s=... (공유 URL 로더)
├── components/
│   ├── workspace/Workspace.tsx # 전체 레이아웃 오케스트레이션
│   ├── dropzone/
│   │   ├── DropZone.tsx        # 파일 드래그앤드롭
│   │   └── UrlInput.tsx        # URL 입력으로 원격 파일 로드
│   ├── sidebar/
│   │   ├── Sidebar.tsx         # 테이블 목록
│   │   └── TableSchema.tsx     # 컬럼 정보 표시
│   ├── editor/
│   │   ├── SqlEditor.tsx       # Monaco 에디터 래퍼
│   │   ├── TabBar.tsx          # 멀티 탭 스트립
│   │   └── AiAssistant.tsx     # AI SQL 어시스턴트 UI
│   ├── results/
│   │   ├── ResultsPanel.tsx    # 결과 패널 (Table/Chart/Plugin 탭)
│   │   ├── DataTable.tsx       # 가상화 테이블
│   │   ├── ChartPanel.tsx      # Recharts 차트 렌더링
│   │   ├── ChartConfig.tsx     # 차트 타입/축 선택 UI
│   │   └── ExportButton.tsx    # 다양한 포맷 내보내기 (플러그인 exporter 포함)
│   ├── pipeline/
│   │   ├── PipelineEditor.tsx  # 파이프라인 메인 뷰 (스텝 목록 + DAG + 결과)
│   │   ├── PipelineStepCard.tsx # 개별 스텝 카드 (이름 + 미니 Monaco)
│   │   ├── PipelineDag.tsx     # @xyflow/react DAG 캔버스
│   │   └── PipelineResults.tsx # 선택 스텝 결과 표시
│   ├── plugins/
│   │   ├── PluginManager.tsx   # 플러그인 URL 추가/삭제 모달
│   │   └── PluginVisualization.tsx # 플러그인 시각화 래퍼 (ErrorBoundary)
│   ├── collaboration/
│   │   ├── JoinDialog.tsx      # 룸 생성/참여 모달
│   │   ├── RoomBar.tsx         # 연결 상태 + 피어 아바타 + Leave
│   │   └── PeerCursors.tsx     # 원격 커서 표시
│   └── share/ShareButton.tsx   # 공유 URL 생성
├── app/
│   └── api/ai/generate-sql/
│       └── route.ts            # AI SQL 생성 API (스트리밍)
├── lib/
│   ├── ai/
│   │   ├── generate-sql.ts     # 클라이언트 스트리밍 AsyncGenerator
│   │   └── schema-context.ts   # 테이블 스키마 → 텍스트 변환
│   ├── duckdb/
│   │   ├── instance.ts         # DuckDB 싱글톤 초기화
│   │   ├── files.ts            # 파일 → DuckDB 테이블 로딩 (xlsx 포함)
│   │   ├── queries.ts          # SQL 실행 + 결과 변환
│   │   └── remote.ts           # URL → fetch → DuckDB 테이블 로딩
│   ├── charts/
│   │   └── detect.ts           # 자동 차트 타입 감지
│   ├── export/
│   │   ├── html.ts             # self-contained HTML 생성
│   │   ├── csv.ts              # RFC 4180 CSV
│   │   ├── json.ts             # pretty-print JSON
│   │   ├── markdown.ts         # pipe 테이블
│   │   ├── excel.ts            # xlsx 라이브러리 기반
│   │   ├── parquet.ts          # DuckDB COPY TO
│   │   └── clipboard.ts        # TSV → 클립보드
│   ├── pipeline/
│   │   ├── execute.ts          # 토폴로지 정렬 → CREATE TEMP TABLE 순차 실행
│   │   └── graph.ts            # 인접 리스트, 순환 감지, 엣지 추출
│   ├── plugins/
│   │   ├── registry.ts         # URL → dynamic import → 매니페스트 검증
│   │   └── builtin.tsx         # 내장 히트맵 시각화 예시
│   ├── collaboration/
│   │   ├── sync.ts             # Y.js ↔ workspace-store 양방향 바인딩
│   │   └── file-sync.ts        # 파일 피어 브로드캐스트 (5MB 이하)
│   ├── persistence/
│   │   └── indexeddb.ts        # IndexedDB save/load/clear (탭+파이프라인+플러그인)
│   ├── sharing/
│   │   ├── encode.ts           # gzip + base64url 인코딩
│   │   └── decode.ts           # URL → 데이터+쿼리 디코딩
│   ├── xlsx/
│   │   └── parse.ts            # xlsx → CSV 변환
│   └── utils.ts
├── stores/
│   ├── workspace-store.ts      # Zustand 중앙 상태 (SQL + 파이프라인 + 플러그인)
│   └── collaboration-store.ts  # 협업 상태 (별도 스토어, 선택적)
├── types/
│   ├── index.ts                # 공통 타입 + re-export
│   ├── pipeline.ts             # Pipeline, PipelineStep 타입
│   ├── plugin.ts               # PluginManifest, PluginExtension 타입
│   └── collaboration.ts        # PeerInfo, RoomState 타입
party/
└── index.ts                    # PartyKit 서버 (Y.js 릴레이, ~5줄)
```

## URL 공유 — 작동 원리와 한계

### 작동 방식

```
원본 파일 → pako.deflate (gzip 압축) → base64url 인코딩 → URL 쿼리 파라미터
```

Share 버튼 클릭 시 `https://querypad.app/shared?s=<encoded>` 형태의 URL이 생성됩니다.
수신자가 이 URL을 열면 브라우저에서 디코딩 → DuckDB 테이블 복원 → 쿼리 프리필이 자동으로 이루어집니다.

### 실제 감당 가능한 크기

URL 안전 한도 ~8KB 기준:

| 데이터 타입 | 압축률 | URL에 담을 수 있는 원본 크기 |
|---|---|---|
| CSV (반복 많은) | 10:1 | ~60 KB |
| CSV (보통) | 7:1 | ~42 KB |
| JSON (일반) | 5:1 | ~30 KB |
| JSON (다양한 값) | 3:1 | ~18 KB |

**즉 500~2,000행 정도의 작은 CSV는 URL 하나로 공유 가능합니다.**

Chrome은 2MB URL까지 지원하지만, 프록시/CDN/웹서버 기본값(8KB)을 고려하면 8KB가 안전선입니다. Excalidraw, Mermaid Live Editor, TypeScript Playground 등도 같은 방식을 사용합니다.

### 한계

- 원본 파일 합계 100KB 초과 시 UI 경고 표시
- URL 8,000자 초과 시 추가 경고
- 대용량 파일 공유는 향후 R2/KV 백엔드 또는 HTML 내보내기로 해결 예정

## 경쟁 환경

| 도구 | 엔진 | 파일 드롭 | 공유 | 시각화 | 비고 |
|------|------|-----------|------|--------|------|
| **DuckDB Shell** | DuckDB-Wasm | ✗ | ✗ | ✗ | 공식 터미널 UI |
| **SQLime** | SQLite-Wasm | ✗ | Gist | ✗ | Parquet 미지원 |
| **Observable** | DuckDB-Wasm | ○ | ✓ | ✓ | 학습곡선 높음 |
| **Datasette Lite** | SQLite/Pyodide | ✗ | ○ | ✗ | 부팅 느림 |
| **MotherDuck** | DuckDB Cloud | ✗ | ✓ | ○ | 서버 필요, 유료 |
| **Perspective** | Custom Wasm | ○ | ✗ | ✓ | SQL 없음, 위젯 |
| **QueryPad** | DuckDB-Wasm | **✓** | **✓** | **✓** | **파일→SQL→파이프라인→협업→공유 원스톱** |

**QueryPad의 차별점:** 파일 드래그앤드롭 → 즉시 SQL → 파이프라인 DAG → 플러그인 확장 → 실시간 협업 → URL 공유. 이 흐름을 브라우저 하나에서 제공하는 경쟁자가 없습니다.

## 로드맵

### ~~Phase 1 — 즉시 추가 (High Impact)~~ ✅ 완료

| 기능 | 상태 | 설명 |
|------|------|------|
| **IndexedDB 영속 저장** | ✅ | idb-keyval 기반. 500ms 디바운스 자동저장, 새로고침 시 복원, Clear 버튼 |
| **Excel (.xlsx) 지원** | ✅ | SheetJS로 xlsx → CSV 변환 후 DuckDB 로드. 첫 번째 시트, dynamic import |
| **HTML 내보내기** | ✅ | self-contained HTML 다운로드. 인라인 CSS, XSS 방지, `__QUERYPAD_DATA__` 임베드 |
| **인라인 차트** | ✅ | Recharts 기반 Bar/Line/Scatter/Pie. 자동 차트 타입 감지, 축 선택 UI |

### ~~Phase 2 — 중기 (Medium Impact)~~ ✅ 완료

| 기능 | 상태 | 설명 |
|------|------|------|
| **다양한 내보내기** | ✅ | CSV, JSON, Markdown, HTML, Excel, Parquet, 클립보드. 드롭다운 메뉴 |
| **멀티 탭 에디터** | ✅ | IDE 스타일 탭 추가/삭제/전환/이름변경, 탭별 독립 쿼리+결과, IndexedDB 영속 |
| **S3/HTTP 직접 읽기** | ✅ | URL 입력으로 원격 파일 fetch → DuckDB 로드. CORS 에러 안내 |
| **AI SQL 어시스턴트** | ✅ | Cmd+K → 자연어 → SQL 스트리밍 생성 (Anthropic API). 스키마만 전송, 데이터 미전송 |

### ~~Phase 3 — 장기 (Moat)~~ ✅ 완료

| 기능 | 상태 | 설명 |
|------|------|------|
| **변환 파이프라인** | ✅ | 쿼리 체이닝 + DAG 시각화 (@xyflow/react + dagre). 토폴로지 정렬, 순환 감지, temp table로 SQL 탭에서 참조 가능 |
| **플러그인 시스템** | ✅ | ES 모듈 URL로 4가지 확장 (시각화, exporter, 파일 로더, SQL 매크로). IndexedDB 영속, ErrorBoundary 격리 |
| **실시간 협업** | ✅ | PartyKit + Y.js CRDT. 쿼리 텍스트 (y-monaco), 탭, 파일(5MB 이하) 실시간 동기화. 원격 커서, graceful degradation |

### Phase 4 — 배포 & 확장

QueryPad의 핵심 가치는 "10초 만에 파일을 열어서 SQL을 돌리는 것"입니다. Phase 4는 이 가치를 더 많은 사용자와 AI 에이전트에게 전달하는 데 집중합니다.

#### 배포 채널

같은 코드베이스에서 4가지 채널로 배포합니다:

```
querypad (단일 코드베이스)
├── querypad.app          → 웹: 누구나 브라우저에서 즉시 사용
├── npx querypad          → CLI: 로컬 파일을 10초 만에 탐색
├── querypad-mcp          → MCP: AI 에이전트가 데이터 분석 도구로 사용
└── @querypad/core        → npm: 다른 앱에 임베드
```

| 채널 | 대상 | 사용 방법 | 상태 |
|------|------|-----------|------|
| **querypad.app** | 비개발자, 빠른 체험 | URL 접속 → 파일 드롭 → SQL | 계획 |
| **`npx querypad`** | 개발자, 로컬 파일 | `npx querypad sales.csv` → 브라우저 자동 열림 | 계획 |
| **MCP 서버** | AI 에이전트 | Claude Code / Cursor에서 데이터 분석 도구로 호출 | 계획 |
| **npm 패키지** | 임베드 | `@querypad/core`로 다른 앱에 컴포넌트 삽입 | 계획 |

#### `npx querypad` — Datasette 모델

[Datasette](https://datasette.io)처럼 CLI가 로컬 서버를 시작하고 브라우저를 여는 모델입니다. DuckDB CLI와의 차별점은 CLI가 아니라 "파일을 넣으면 열리는 풀 UI"라는 점입니다.

```bash
# 설치 없이 실행
npx querypad sales.csv departments.csv

# → localhost:3847에서 QueryPad 실행
# → 두 파일이 자동 로드된 상태
# → Monaco 에디터, 차트, 내보내기, 파이프라인 모두 사용 가능
```

| 비교 | DuckDB CLI | Datasette | QueryPad CLI |
|------|-----------|-----------|-------------|
| 설치 | `brew install` | `pip install` | `npx` (설치 불필요) |
| UI | 터미널 | 기본 웹 UI | 풀 IDE (Monaco + 차트 + DAG) |
| 엔진 | DuckDB | SQLite | DuckDB-Wasm |
| 파일 지원 | Parquet/CSV/JSON | SQLite DB | Parquet/CSV/JSON/Excel |
| 시각화 | 없음 | 없음 | 차트 + DAG |

```
package.json 구조:
{
  "bin": {
    "querypad": "./bin/querypad.js",
    "querypad-mcp": "./bin/querypad-mcp.js"
  }
}
```

#### MCP 서버 — AI 에이전트를 위한 인터페이스

[MCP (Model Context Protocol)](https://modelcontextprotocol.io)는 Anthropic이 만든 AI 에이전트 ↔ 도구 통신 표준입니다. Claude Code, Cursor 등에서 사용됩니다.

기존 DuckDB MCP 서버(`duckdb-mcp`, `@seed-ship/duckdb-mcp-native`)는 SQL 실행만 제공합니다. QueryPad MCP는 **데이터 분석 워크플로우 전체**를 제공합니다:

```jsonc
// .mcp.json (Claude Code / Cursor에서)
{
  "mcpServers": {
    "querypad": {
      "command": "npx",
      "args": ["querypad-mcp"]
    }
  }
}
```

**MCP 도구 목록:**

| 도구 | 설명 |
|------|------|
| `querypad.load_file` | 로컬 파일을 DuckDB에 로드 |
| `querypad.query` | SQL 실행 → 구조화된 JSON 결과 반환 |
| `querypad.describe` | 테이블 스키마 반환 (컬럼명, 타입, 행 수) |
| `querypad.chart` | 쿼리 결과로 차트 생성 → 이미지/URL 반환 |
| `querypad.export` | 결과를 CSV/JSON/Parquet 등으로 내보내기 |
| `querypad.pipeline` | 파이프라인 실행 (멀티 스텝 SQL) |

**AI 에이전트 사용 시나리오:**
```
사용자: "sales.csv를 분석해서 지역별 매출 추이 차트 만들어줘"

Agent: querypad.load_file("./sales.csv")
     → querypad.describe("sales")
     → querypad.query("SELECT region, date, SUM(sales) ... GROUP BY region, date")
     → querypad.chart({ type: "line", x: "date", y: "total_sales", color: "region" })
     → "차트를 생성했습니다. [이미지]"
```

**에이전트 친화적 설계 원칙** ([참고](https://justin.poehnelt.com/posts/rewrite-your-cli-for-ai-agents/)):

| 원칙 | 적용 |
|------|------|
| 구조화된 JSON 입출력 | 모든 MCP 도구가 typed JSON Schema로 정의 |
| 런타임 스키마 조회 | `querypad.describe`로 테이블 구조를 에이전트 컨텍스트에 제공 |
| 컨텍스트 윈도우 절약 | 결과 행 수 제한 (`--limit`), 컬럼 선택 (`--fields`) |
| 입력 검증 | SQL injection 방지, 경로 검증 |
| 안전 장치 | 읽기 전용 기본값, 파일 시스템 접근 범위 제한 |

#### 경쟁 도구 배포 전략 비교

| 도구 | 형태 | 배포 | CLI | MCP | 수익 모델 |
|------|------|------|-----|-----|-----------|
| **Excalidraw** | 브라우저 도구 | Vercel | ✗ | ✗ | Excalidraw+ (협업 유료) |
| **Photopea** | 브라우저 도구 | 정적 CDN | ✗ | ✗ | 광고 ($1M+/년, 1인 개발) |
| **StackBlitz** | 브라우저 IDE | 자체 인프라 | ✗ | ✗ | 프리미엄 SaaS |
| **Datasette** | CLI → 웹 UI | PyPI + 클라우드 | ✓ | ✗ | 오픈소스 + 컨설팅 |
| **Observable** | SaaS 노트북 | 자체 인프라 | ✓ | ✗ | 프리미엄 SaaS |
| **DuckDB** | 엔진 | Homebrew/pip/npm | ✓ | 커뮤니티 | 오픈소스 + MotherDuck |
| **QueryPad** | 브라우저 도구 + CLI + MCP | Vercel + npm | **계획** | **계획** | 오픈소스 |

> **핵심 인사이트:** 브라우저 네이티브 도구 중 CLI + MCP를 모두 제공하는 사례는 아직 없습니다. QueryPad가 이 조합을 처음 실현하면 "인간을 위한 UI + AI를 위한 API"를 하나의 도구에서 제공하는 최초 사례가 됩니다.

#### QueryPad는 SaaS가 아닙니다

QueryPad는 **브라우저 네이티브 도구**입니다. Vercel에 배포해도 본질은 바뀌지 않습니다.

```
SaaS (서버 의존)                     브라우저 네이티브 도구 (QueryPad)
─────────────────                    ───────────────────────────────
데이터가 서버에 저장                    데이터가 브라우저에만 존재
서버 죽으면 서비스 불가                  서버는 HTML/JS 내려주기만
계정 필요, 로그인 필요                  계정 없음, 열면 바로 사용
서버 비용이 사용자 수에 비례              사용자 늘어도 비용 거의 동일
```

Excalidraw, Photopea, TypeScript Playground와 같은 모델입니다. 서버는 정적 파일을 내려줄 뿐, 모든 연산과 저장은 사용자 브라우저에서 이루어집니다.

## 배포

### Vercel 배포 (권장)

**1단계: Vercel 프로젝트 연결**

[vercel.com/new](https://vercel.com/new)에서 GitHub 리포지토리 `vericontext/querypad`를 선택합니다.

**2단계: 환경 변수 설정**

Vercel 대시보드 → Settings → Environment Variables에서 추가:

| 변수 | 필수 | 설명 |
|------|------|------|
| `ANTHROPIC_API_KEY` | 선택 | AI SQL 어시스턴트용. 없으면 AI 기능만 비활성화 |

> DuckDB-Wasm, 파일 로드, SQL 실행, 차트, 내보내기, 파이프라인, 플러그인은 모두 브라우저에서 실행되므로 서버 환경 변수가 필요 없습니다.

**3단계: 빌드 설정 (자동 감지됨)**

| 항목 | 값 |
|------|------|
| Framework Preset | Next.js |
| Build Command | `npm run build` |
| Output Directory | `.next` |
| Install Command | `npm install` |
| Node.js Version | 20.x |

**4단계: Deploy 클릭**

배포 완료 후 `https://your-project.vercel.app`에서 바로 사용 가능합니다.

### WASM 파일 서빙

`postinstall` 스크립트가 DuckDB-Wasm 파일을 `public/duckdb/`에 자동 복사합니다.
`next.config.ts`에서 `/duckdb/*` 경로에 적절한 Content-Type과 캐시 헤더가 설정되어 있습니다:

```
Content-Type: application/wasm
Cache-Control: public, max-age=31536000, immutable
```

### 커스텀 도메인

Vercel 대시보드 → Settings → Domains에서 커스텀 도메인을 추가할 수 있습니다.
DNS에 CNAME 레코드(`cname.vercel-dns.com`)를 추가하면 HTTPS가 자동 설정됩니다.

### 실시간 협업 배포 (선택)

협업 기능을 프로덕션에서 사용하려면 PartyKit를 별도로 배포합니다:

```bash
npx partykit deploy
```

배포 후 받은 호스트 주소(예: `querypad-collab.username.partykit.dev`)를 앱 내 "Collaborate" 다이얼로그의 PartyKit Host 필드에 입력합니다.

> PartyKit 무료 티어: 룸당 20 동시 접속, Cloudflare Workers 엣지 배포.
> PartyKit을 배포하지 않아도 나머지 기능은 모두 정상 동작합니다.

### 아키텍처: 서버 vs 클라이언트

```
Vercel (정적 서빙)                    사용자 브라우저 (모든 연산)
┌─────────────────────┐              ┌──────────────────────────┐
│ HTML/JS/CSS/WASM    │───다운로드──→│ DuckDB-Wasm (SQL 엔진)   │
│ 서빙만 함            │              │ IndexedDB (데이터 저장)   │
│                     │              │ Monaco Editor            │
│ /api/ai/generate-sql│←─선택적───→ │ Zustand (상태 관리)       │
│ (Anthropic 프록시)   │              │ @xyflow/react (DAG)      │
└─────────────────────┘              └──────────────────────────┘

PartyKit (선택)
┌─────────────────────┐
│ WebSocket 릴레이     │←─선택적───→ Y.js CRDT 동기화
│ (Y.js 메시지 전달만)  │
└─────────────────────┘
```

서버는 파일 서빙과 AI 프록시만 담당합니다. 사용자 데이터는 서버를 경유하지 않습니다.

### 기술 결정

- **eh 번들 사용**: COI(Cross-Origin-Isolation) 헤더 없이 동작. Vercel 배포 간소화 (싱글 스레드이지만 MVP에 충분)
- **Zustand**: Provider 불필요, Next.js App Router와 호환, selector로 불필요한 리렌더 방지
- **dynamic import (ssr: false)**: Monaco Editor와 DuckDB-Wasm 모두 브라우저 전용이므로 SSR 비활성화
- **파이프라인 의존성 감지**: SQL 파서 없이 word boundary regex로 다른 스텝 이름 참조 감지. 단순하고 충분함
- **플러그인 샌드박싱 없음**: MVP에서는 `import()` 직접 로드. 신뢰할 수 있는 소스만 권장
- **협업 코드 전량 dynamic import**: "Collaborate" 클릭 시에만 yjs/y-partykit/y-monaco 로드. 번들 크기 영향 없음
- **협업 스토어 분리**: 선택적 기능이므로 workspace-store와 별도 Zustand 스토어로 관리

## 라이선스

MIT
