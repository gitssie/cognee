# AGENT CONTEXT MEMORY

## [Section A: User-Defined Rules — PERMANENT]
<!-- Max 15 items. User-mandated behavioral constraints ("you must always...", "never...", "remember that...").
     These are COMMANDS, not preferences. NEVER delete unless user explicitly revokes.
     Reflector: only ADD or REPLACE items here, never silently delete. -->

## [Section B: Active Context — CURRENT TASK]
<!-- Max 10 items. The current goal, active files, decisions in progress, open questions.
     Reflector: REPLACE this section entirely based on the latest summary.
     When a task is marked complete, move its conclusion to Section C, then clear it here. -->

- Goal: Exploratory learning about EbeanApi usage patterns, specifically `parsePredicate` and QueryForm predicate value structures
- Status: No active coding task; knowledge retrieval only via cognee_search (GRAPH_COMPLETION)
- Open question: None currently — prior questions about parsePredicate and operator value types have been answered

## [Section C: Experience Snapshots — ROLLING LOG]
<!-- Max 15 items. One-line factual conclusions from past work.
     Reflector: ADD new entries at the top. If count exceeds 15, DELETE the oldest entry. -->

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
- tech_stack: Works with EbeanApi (Java ORM), QueryForm frontend query structures
