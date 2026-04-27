# AI-Driven Backlog Quality Gate — MCP Demo

> **Chevron Interview Project | Use Case 2**
> A working prototype demonstrating AI-assisted backlog analysis with a mandatory human-in-the-loop MCP approval flow.

---

## What This Does

This tool takes a JSON backlog of user stories, analyzes each one for quality issues using AI (Grok), proposes concrete fixes, and then applies those fixes *only* through a structured **MCP (Model Context Protocol)** layer — and only after explicit human approval.

**No AI agent can directly mutate the backlog.** Every change is a structured, auditable MCP action.

Key capabilities:
- Analyze all backlog stories in parallel via Grok LLM
- Detect 5 issue types with a hybrid LLM + rule-based engine
- Show a side-by-side before/after JSON comparison with full human editing
- Let users type brand-new backlog entries and run them through the same AI pipeline
- Decompose oversized stories into editable child stories before approval
- Quantify backlog health with a custom mathematical **Backlog Health Index (BHI)**
- Download a professional **PDF quality report**
- Every mutation is gated behind a human Approve/Reject step

---

## System Architecture

```
Backlog (JSON)
     │
     ▼
┌─────────────────┐
│  Analyzer Agent  │  ← Grok LLM (detects issues) + rule-based fallback
│  (analyzerAgent) │
└────────┬────────┘
         │  analysis result
         ▼
┌─────────────────┐
│   Fix Agent      │  ← Grok LLM (proposes improvements + decomposition)
│   (fixAgent)     │
└────────┬────────┘
         │  fix result
         ▼
┌─────────────────────────────────┐
│  Human Edit Step (optional)      │  ← User can edit parent JSON and
│  (frontend JSON textareas)       │    child story array before MCP
└────────┬────────────────────────┘
         │  edited or original fix result
         ▼
┌─────────────────┐
│  MCP Action      │  ← Pure logic (NO AI, NO mutation)
│  Generator       │    Converts fix → structured actions
└────────┬────────┘
         │  MCP action payload (preview)
         ▼
┌─────────────────┐
│  Human Approval  │  ← Frontend Approve / Reject
│  (Approve/Reject)│
└────────┬────────┘
         │  approved = true
         ▼
┌─────────────────┐
│  MCP Executor    │  ← ONLY place backlog.json is written
└─────────────────┘
```

### MCP Layer Explained

The **Model Context Protocol (MCP)** layer is the safety boundary between AI and data:

- AI agents **propose** changes as structured JSON action objects
- The MCP `actionGenerator` supports three action types: `update_story`, `create_story`, `create_child_stories`
- These actions are **previewed in the UI** before anything happens
- Users can **edit both the AI-improved story JSON and the decomposition JSON array** before the MCP action is generated — edits are sent to `/mcp/refresh` or `/draft/refresh` which regenerates the payload server-side
- The MCP `executor` only fires after the human clicks **Approve**
- Every execution is logged to an append-only audit trail

---

## Issue Detection

The Analyzer Agent detects the following quality issues using a **hybrid LLM + rule-based engine**:

| Issue | Detection method | Description |
|---|---|---|
| `missing_acceptance_criteria` | LLM + rule | AC array is empty or criteria are untestable |
| `invalid_story_points` | Rule | Points not in Fibonacci sequence (1, 2, 3, 5, 8, 13) |
| `oversized_story` | LLM + rule | Points > 13 or story is semantically too broad |
| `orphan_story` | Rule | No description, no context, no parent epic |
| `weak_title` | LLM | Vague titles like "Fix the bug" or "Do the thing" |

The rule-based results are always computed; LLM results are merged on top. If the API is unavailable, the rule-based fallback ensures the system keeps working.

---

## Backlog Health Index (BHI)

The BHI is a custom mathematical quality model that produces a single 0–100 score with a letter grade (A–F).

### Formula

```
BHI = (0.20·T̄ + 0.10·D̄ + 0.30·Ā + 0.25·S̄ + 0.15·C̄) · (1 − 0.4·ρ)
```

| Symbol | Dimension | Weight |
|---|---|---|
| T̄ | Title Clarity | 0.20 |
| D̄ | Description Quality | 0.10 |
| Ā | Acceptance Criteria | 0.30 (highest) |
| S̄ | Sizing (Fibonacci) | 0.25 |
| C̄ | Context / Structure | 0.15 |
| ρ | Critical-defect ratio | penalty multiplier |

- Each dimension is scored 0–100 per story and averaged across the backlog.
- **ρ** is the fraction of critical stories (severity high). The term `(1 − 0.4·ρ)` penalises a backlog with many critical defects.
- **σ** (standard deviation of per-story quality) measures consistency; a high σ means some stories are excellent while others are broken.
- Grade thresholds: A ≥ 85, B ≥ 70, C ≥ 55, D ≥ 40, F < 40.

The BHI is displayed as a live circular score ring on the dashboard and updates every time **Analyze All Stories** is run.

---

## Manual Story Entry (New Story Flow)

Users can type a brand-new backlog story directly in the UI:

1. Click **"New Story"** → fill in title, description, story points, acceptance criteria, optional parent
2. Click **"Analyze & Suggest Improvements"** — Grok analyzes the draft and generates fixes
3. A side-by-side **Original / AI Improved** JSON comparison appears — **both panes are editable**
4. If the story is oversized, an **editable decomposition JSON array** of child stories also appears
5. Click **"Apply Edits & Refresh MCP"** to sync any manual changes back to the MCP payload
6. Approve → story (and optional child stories) are added to `backlog.json` via the MCP executor

---

## Human Edit → MCP Refresh Flow

Both the existing-story flow and the new-story flow support mid-review edits:

- The **AI Improved** pane and the **Child Stories array** are both editable JSON textareas
- After editing, click **"Apply Edits & Refresh MCP"**
  - Frontend validates JSON structure and required fields
  - Sends `POST /mcp/refresh` (existing) or `POST /draft/refresh` (new) to the backend
  - Backend snaps non-Fibonacci points to the nearest valid value, updates the cached fix, and regenerates the MCP payload
  - The MCP preview updates in place
- If the user clicks **Approve** with unapplied edits, edits are automatically applied first

This means the database always receives exactly what the human reviewed and approved — not a raw AI output.

---

## PDF Quality Report

The **Download PDF Report** button generates a server-side A4 PDF using PDFKit (no headless browser required). The report contains:

- Navy header with grade badge
- 4 KPI cards: BHI score, total stories, stories with issues, critical defect rate
- BHI section with formula, penalty math, and consistency metrics
- Quality Dimensions table with weighted progress bars
- Issue Breakdown bar chart
- Numbered recommendations (story-ID-specific)
- Story-Level Quality table (per-story ID, title, points, quality score, issues)
- MCP Execution Log

---

## Recommendations

After **Analyze All Stories**, the Recommendations panel lists story-ID-specific actions, e.g.:

> Stories **#2, #6, #10** are missing acceptance criteria — add 3-5 testable criteria before sprint planning.

> Story **#4** has a vague title — rewrite in "As a [role], I want [action]" format.

---

## Project Structure

```
project/
├── server.js              ← Express entry point
├── package.json
├── .env.example
│
├── routes/
│   ├── backlog.js         ← GET /backlog
│   ├── analyze.js         ← POST /analyze, POST /analyze/all
│   ├── fix.js             ← POST /fix
│   ├── mcp.js             ← POST /mcp/generate, /mcp/refresh, /mcp/execute, GET /mcp/log
│   ├── draft.js           ← POST /draft/process, /draft/refresh, /draft/execute
│   └── report.js          ← GET /report, /report/pdf, /report/health, /report/export
│
├── agents/
│   ├── analyzerAgent.js   ← Grok LLM + rule-based fallback
│   └── fixAgent.js        ← Grok LLM fix + decomposition generation
│
├── mcp/
│   ├── actionGenerator.js ← AI output → MCP action objects (update/create/decompose)
│   └── executor.js        ← Applies approved actions to backlog.json
│
├── utils/
│   ├── llmClient.js       ← Grok API wrapper (OpenAI-compatible)
│   ├── qualityModel.js    ← Backlog Health Index (BHI) mathematical model
│   ├── pdfReport.js       ← Professional PDF generator (PDFKit)
│   └── state.js           ← Shared in-memory state (caches)
│
├── data/
│   └── backlog.json       ← Source of truth (10 sample stories)
│
└── frontend/
    ├── index.html         ← Single-page app
    ├── styles.css
    └── app.js             ← UI orchestration
```

---

## Setup & Run

### Prerequisites
- Node.js v18+
- A Grok API key from [console.x.ai](https://console.x.ai)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
copy .env.example .env
```

Edit `.env` and set your Grok API key:

```
GROK_API_KEY=xai-xxxxxxxxxxxxxxxxxxxxxxxx
GROK_MODEL=grok-3-mini
PORT=5000
```

### 3. Start the server

```bash
npm start
```

Open [http://localhost:5000](http://localhost:5000) in your browser.

---

## Demo Walkthrough

### Full Demo (~7 minutes)

1. **Open the app** — 10 backlog stories visible in the table, BHI dashboard shows baseline score

2. Click **"Analyze All Stories"**
   - Grok analyzes all 10 stories in parallel
   - BHI dashboard updates: score ring, grade, dimensions, valid/issues/orphan counts
   - Recommendations panel shows story-ID-specific actions (e.g. "Stories #2, #4, #8 are missing acceptance criteria")

3. **Click "Analyze"** on Story #2 (oversized analytics story)
   - Detected: `oversized_story`, `missing_acceptance_criteria`, `invalid_story_points` — Severity HIGH

4. Click **"Get AI Fix"**
   - **Original JSON** (40 pts, 0 AC) and **AI Improved JSON** (5-8 pts, 5 AC) appear side-by-side in editable textareas
   - **Decomposition panel** shows child stories as an editable JSON array
   - Manually edit a child story title or points, then click **"Apply Edits & Refresh MCP"** — the MCP preview updates instantly

5. Click **"Preview MCP Actions"**
   - Simulation panel shows `update_story` + `create_child_stories` actions with full payloads
   - Banner: "Simulation only — no changes applied yet"

6. Click **"Approve Changes"**
   - MCP Executor writes to `backlog.json`
   - Execution log confirms which actions succeeded
   - Table and BHI dashboard refresh

7. Click **"New Story"** — type a raw backlog entry, see AI analysis + editable before/after + decomposition + MCP approval — all without touching the existing backlog until approved

8. Click **"Download PDF Report"** — A4 professional PDF downloads with all sections

9. Click **"Export Backlog"** — downloads the current `backlog.json`

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/backlog` | Fetch all stories |
| `POST` | `/analyze` | Analyze one story `{ story_id }` |
| `POST` | `/analyze/all` | Analyze all stories in parallel |
| `POST` | `/fix` | Generate AI fix `{ story_id }` |
| `POST` | `/mcp/generate` | Generate MCP actions `{ story_id }` |
| `POST` | `/mcp/refresh` | Re-generate MCP with human edits `{ story_id, edited_story?, edited_decomposition? }` |
| `POST` | `/mcp/execute` | Apply or reject `{ story_id, approved }` |
| `GET` | `/mcp/log` | Full execution audit log |
| `POST` | `/draft/process` | Analyze + fix a user-typed story `{ story }` |
| `POST` | `/draft/refresh` | Re-generate create-MCP with edits `{ draft_id, edited_story?, edited_decomposition? }` |
| `POST` | `/draft/execute` | Approve or reject draft `{ draft_id, approved }` |
| `GET` | `/report` | Backlog quality report (JSON) |
| `GET` | `/report/pdf` | Backlog quality report (PDF download) |
| `GET` | `/report/health` | BHI snapshot (used by dashboard) |
| `GET` | `/report/export` | Download current backlog as JSON |

---

## Design Decisions

**Why JSON for storage?**
Keeps the demo simple and portable. In production this would be ADO/Jira via their APIs.

**Why rule-based + LLM for analysis?**
The rule-based fallback (Fibonacci check, empty AC) is fast, free, and always correct. The LLM adds semantic understanding (weak titles, context-poor stories). Combining both gives better recall and resilience if the API is unavailable.

**Why is MCP mocked?**
The use case explicitly allows "real or mocked" MCP. Our mock fully respects the MCP contract: AI proposes → human edits (optional) → MCP validates → human approves → MCP executes. The key invariant (AI never directly mutates data) is strictly enforced.

**Why editable JSON panes?**
AI suggestions are a starting point, not ground truth. Giving the reviewer editable textareas with live MCP-payload regeneration means the database always receives exactly what the human approved — not a blind AI output. This is the difference between a demo and a production-ready flow.

**Why PDFKit for the PDF?**
No Chromium, no headless browser, no native binaries. PDFKit runs pure Node.js, generates clean A4 layouts programmatically, and is ~1 MB of dependencies.

**Why Grok?**
Fast, good at structured JSON output, and the team has API access. The LLM client is OpenAI-SDK-compatible so swapping to GPT-4 is a one-line change in `llmClient.js`.

---

## Evaluation Criteria Mapping

| Criterion | How it's met |
|---|---|
| Quality detection accuracy | LLM + rule-based hybrid; detects 5 issue types with fallback |
| Practical AI fixes | Rewrites titles, adds AC, snaps to Fibonacci points, decomposes large stories |
| Human editing before approval | Both parent story and decomposition are editable JSON; MCP payload regenerates on save |
| Safe human approval flow | MCP preview shown before any mutation; Approve/Reject required |
| Correct MCP usage | MCP layer enforces no-direct-mutation; typed action objects; full execution log |
| Backlog quality quantification | Custom BHI formula (5 weighted dimensions × critical-defect penalty) |
| Reporting | Story-ID-specific recommendations; PDF + JSON report download |
