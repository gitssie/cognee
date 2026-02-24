# AGENT CONTEXT MEMORY

## [Section A: User-Defined Rules — PERMANENT]
<!-- Max 15 items. User-mandated behavioral constraints ("you must always...", "never...", "remember that...").
     These are COMMANDS, not preferences. NEVER delete unless user explicitly revokes.
     Reflector: only ADD or REPLACE items here, never silently delete. -->

## [Section B: Active Context — CURRENT TASK]
<!-- Max 10 items. The current goal, active files, decisions in progress, open questions.
     Reflector: REPLACE this section entirely based on the latest summary.
     When a task is marked complete, move its conclusion to Section C, then clear it here. -->

- Goal: Completed — user asked about EbeanApi core methods and its relationship with DataService in Type-CRM
- Status: Task complete; information retrieved and summarized via knowledge graph search
- Open question: None

## [Section C: Experience Snapshots — ROLLING LOG]
<!-- Max 15 items. One-line factual conclusions from past work.
     Reflector: ADD new entries at the top. If count exceeds 15, DELETE the oldest entry. -->

- DataService is a higher-level wrapper around EbeanApi that adds validation, permissions, and Either error handling; best practice is to prefer DataService over direct EbeanApi usage
- EbeanApi core methods include `desc()`, `find()`, `copyMap()`, `save()`, `expr()`, and `setRollbackOnly()` for low-level data access
- User asked about existence of "question tool" (问题工具) with no additional context provided — intent remains unclear
- The "question" tool does NOT exist in the available toolset; closest alternative for collecting user input is `feedback_interactive_feedback`
- Available tools: read, write, edit, glob, grep, bash, task, todowrite, lsp_diagnostics, lsp_find_symbol, cognee_* series, webfetch, feedback_interactive_feedback
- `parsePredicate` returns `Either<Code, Expression>` for type-safe error handling when converting QueryForm predicates to Ebean Expressions
- Frontend QueryForm predicate structure: array of `{ field, op, value }` objects under `query.predicate`
- Operator value types: comparison (eq/ne/gt/ge/lt/le) → scalar; string ops (contains/startsWith/endsWith) → string; `in` → array; `isNull`/`isNotNull` → null
- EbeanApi is a database abstraction layer covering CRUD, batch processing, and performance optimization
- EbeanApi code does not exist in the cognee working directory; all knowledge comes from the knowledge graph

## [Section D: User Profile — BACKGROUND]
<!-- Max 12 items. Facts about the user: tech stack, preferences, working style.
     Format: <category>: <fact>
     Reflector: UPSERT by category key. If a new fact contradicts an existing one, REPLACE it. -->

- language: Communicates in Chinese with English technical terms
- workflow: Uses cognee knowledge graph (GRAPH_COMPLETION searches) to query knowledge about external projects
- task_style: Exploratory/learning sessions — asks questions rather than assigning coding tasks
- tech_stack: Works with EbeanApi (Java ORM), DataService (higher-level wrapper), QueryForm frontend query structures
