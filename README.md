# Codebase Explainer

A local web app that analyzes GitHub repositories and generates architecture summaries, entry points, reading orders, and diagrams.

## What we're building
User pastes a public GitHub repo URL, hits "Analyze," and gets back:
1. A plain-English architecture summary
2. Key entry points (where execution starts, main config files)
3. A suggested reading order for a new contributor
4. An auto-generated architecture diagram (Mermaid.js)

## Tech Stack
- **Backend**: Node.js + TypeScript, Express
- **Frontend**: React app (Vite)
- **Repo ingestion**: GitHub REST API via Octokit
- **Static analysis**: `madge` (JS/TS import graph)
- **LLM calls**: NVIDIA NIM API with `z-ai/glm-5.2` model
- **Diagram rendering**: Mermaid.js

## Pipeline
1. Input: user pastes GitHub repo URL
2. Fetch: pull file tree via GitHub API
3. Static pass: run madge to build import/dependency graph
4. Per-file summarization: LLM calls for each source file
5. Synthesis pass: LLM generates comprehensive analysis
6. Render: frontend displays results with Mermaid diagram

## Success Criteria
- Analyze a public JS/TS repo → get overview + entry points + reading order + diagram in ~60 seconds
- Diagram is readable (≤12 nodes) and reflects real import relationships
- Works end-to-end on at least 3 different repos

## Current Status
MVP in progress - project skeleton setup complete