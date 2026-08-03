# Workflow Analytics Discussion

## Context

Multiple employees can record different executions of the same workflow. WorkTrace should compare those recordings to show how execution paths differ, where time is lost, and how the fastest successful execution differs from the average.

This discussion separates two related features:

1. **Recording comparison** — a user manually selects a small number of recordings for a focused comparison.
2. **Workflow analytics** — the system analyzes all eligible recordings in a workflow to identify broader patterns and execution-path clusters.

These should not be presented as the same type of analysis. A manually selected group of five recordings is useful for comparison, but it is too small and potentially too biased for reliable workforce-level conclusions.

## Product terminology

- **Workflow**: the shared procedure, such as "Expense Reimbursement".
- **Recording/session**: one employee's execution of that workflow.
- **SOP**: generated documentation based on a recording or consolidated workflow evidence.
- **Recording comparison**: a user-selected comparison of 2–5 recordings.
- **Workflow analytics**: analysis of all eligible recordings associated with a workflow.

## Recording comparison

### Selection behaviour

Each workflow should have an **Analytics** or **Compare recordings** action. The user can select between two and five completed recordings belonging to that workflow.

Each selectable recording should show enough context to make the choice meaningful:

- Employee or recorded-by user
- Optional recording reference
- Recording date
- Total duration
- Processing status
- SOP/evidence readiness

Only recordings with an approved SOP are selectable. The latest approved SOP
for that recording is used; a newer draft does not replace it until the draft
is explicitly approved.

Useful selection controls include:

- Search by employee or reference
- Sort by fastest, slowest, newest, or oldest
- A suggested selection containing representative recordings
- A visible 2–5 selection limit

A suggested set could include the fastest, median, and slowest recordings, followed by recordings with meaningfully different execution paths. This is more representative than selecting only the most recent recordings.

### Comparison output

The first version should contain four main sections:

1. Comparison overview
2. Path comparison timeline
3. Fastest successful path versus average
4. Plain-English executive summary

## Comparison overview

The overview should communicate the main result without requiring the user to interpret a complex chart.

Recommended metrics:

- Number of recordings compared
- Number of employees represented
- Average completion time
- Median completion time
- Fastest completion time
- Slowest completion time
- Average number of steps
- Difference between the fastest recording and the selected-recording average

Example:

```text
5 recordings compared
Average completion: 5m 42s
Fastest completion: 4m 08s
Potential time saving: 1m 34s per execution
```

### Completion-time ranking chart

Use a sorted horizontal bar chart:

```text
Alex       ███████████████             4m 08s
Maya       █████████████████           4m 39s
Average    ┆                            5m 42s
Sarah      █████████████████████       5m 51s
John       █████████████████████████   7m 41s
```

Recommended presentation:

- Fastest successful recording in green
- Other recordings in neutral grey
- Average represented by a dashed vertical reference line
- Employee and reference displayed as row labels
- Tooltip containing duration, date, reference, and step count

## Path comparison timeline

The path comparison timeline should be the primary visualization. Each recording is displayed as a horizontal row, with one segment per aligned workflow step.

```text
          0m        1m        2m        3m        4m
Alex      [Login][Create][Details────][Upload][Submit]
Sarah     [Login][Create][Details────────][Upload──][Submit]
John      [Login][Help][Create][Details────][Upload][Upload][Submit]
```

The chart should reveal:

- Common steps
- Additional or unmatched steps
- Skipped steps
- Repeated steps
- Different ordering
- Detours
- Long or idle periods
- Where one path takes longer than another

Recommended visual behaviour:

- The horizontal axis represents elapsed time.
- The same logical step uses a consistent colour across recordings.
- Repeated steps use the same colour with a repeated/striped treatment.
- Detours or unmatched steps use amber.
- Idle periods use a faint striped segment.
- Hovering a segment shows its instruction, duration, event count, and repeat state.
- Clicking a recording row opens its existing session details.

The chart may provide two display modes:

- **Time**: segment width represents actual duration.
- **Steps**: each step has equal width, making sequence differences easier to inspect.

Step embeddings can help align differently worded steps, but alignment should also account for sequence and surrounding context. An embedding average alone should not represent an entire execution path because averaging loses step order.

## Fastest successful path versus average

The fastest path should be compared with the selected-recording average at the aligned-step level.

Until WorkTrace has a reliable outcome-quality signal, this should be labelled **Fastest observed path** or **Fastest completed path**, not "top performer." Speed alone does not prove that the workflow was completed correctly.

### Dumbbell chart

A dumbbell chart provides a compact step-by-step comparison:

```text
Enter details      ●────────────○      21s faster
Upload receipt     ●────────────────○  34s faster
Review claim           ●──────○        9s faster
Submit                 ●─○             2s faster

                    ● Fastest    ○ Average
```

Recommended behaviour:

- Green point represents the fastest completed path.
- Grey point represents the selected-recording average.
- The connecting line represents the timing difference.
- Steps remain in workflow order.
- A delta label displays time saved or lost.
- Selecting a step highlights it in the path comparison timeline.

## Executive summary

The backend should calculate all metrics before asking an LLM to create the summary. The model should receive structured aggregate evidence rather than raw recordings and should not be expected to calculate durations itself.

Example input:

```json
{
  "recording_count": 5,
  "average_duration_seconds": 342,
  "fastest_duration_seconds": 248,
  "fastest_improvement_percent": 27,
  "largest_step_difference": {
    "step": "Upload receipt",
    "average_seconds": 44,
    "fastest_seconds": 18
  },
  "main_path_difference": {
    "step": "Upload receipt",
    "repeated_by_recordings": 2
  }
}
```

The generated output should contain exactly three short, plain-English sentences:

1. The most important comparison result
2. The clearest execution-path or timing difference
3. A grounded improvement opportunity

Every numerical statement should be supported by the supplied analytics. Recommendations inferred from the metrics should be worded as recommendations, not established facts.

Example:

> Receipt upload showed the largest timing difference, averaging 44 seconds compared with 18 seconds in the fastest completed recording. Two of the five recordings repeated the upload step, while the fastest path completed it once. Standardising receipt preparation before upload may reduce completion time and path variation.

## Recommended page layout

```text
┌──────────────────────────────────────────────────┐
│ 5 recordings · Avg 5m 42s · Fastest 4m 08s      │
│ 27% potential time saving                        │
└──────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────┐
│ Completion-time ranking                          │
│ Horizontal bar chart                             │
└──────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────┐
│ Path comparison timeline              Time/Steps │
│ Selected recording rows                          │
└──────────────────────────────────────────────────┘

┌──────────────────────────┬───────────────────────┐
│ Fastest vs average       │ Executive summary     │
│ Dumbbell chart           │ Three sentences       │
└──────────────────────────┴───────────────────────┘
```

Recommended colour usage:

- Green for the fastest path or measured improvement
- Neutral grey/white for normal data
- Amber for detours, repeated steps, or slower execution
- Red only for confirmed errors or failed steps
- Stable muted colours for aligned canonical steps

Avoid pie charts, donut charts, radar charts, employee leaderboards, and smooth line charts. They do not communicate path or timing differences clearly for a sample of two to five recordings.

## Processing modes

The product now keeps two analytics questions separate:

- **Selected comparison** compares 2–5 explicitly selected, approved recordings.
- **Workforce analytics** resolves every eligible approved recording for the workflow, from 6 up to a bounded maximum of 50.

Both modes create immutable, versioned run snapshots. Regenerating analytics creates a new version rather than mutating a historical report.

### Selected comparison flow

```text
Select 2–5 recordings
        ↓
Create comparison analytics run
        ↓
Retrieve processed SOP steps, timings, and events
        ↓
Generate or reuse step embeddings
        ↓
Align equivalent steps
        ↓
Calculate overview and timing metrics
        ↓
Build path and fastest-versus-average data
        ↓
Generate the three-sentence summary
        ↓
Persist and display the comparison
```

The request is asynchronous. The implemented API is:

```http
POST /workflows/{workflow_id}/analytics-runs
```

```json
{
  "mode": "selected_comparison",
  "recording_ids": ["id-1", "id-2", "id-3"]
}
```

### Workforce flow

```text
Resolve 6–50 eligible approved recordings
        ↓
Reuse or generate 1536-dimensional step embeddings
        ↓
Align semantically equivalent SOP steps
        ↓
Build fixed-length path and timing features
        ↓
Evaluate deterministic K-means candidates for k=2..4
        ↓
Reject singleton or weakly separated clusters
        ↓
Calculate population and per-cluster friction
        ↓
Persist clusters, heatmap, timelines and summary
```

```json
{
  "mode": "workforce",
  "recording_ids": []
}
```

The endpoint returns a persisted, versioned analytics run with immutable input
snapshots. The UI polls only while its status is `queued`, `embedding`,
`aligning`, `clustering`, `scoring_friction`, `calculating`, or `summarizing`.
Terminal runs stop polling.

Supporting routes:

```http
GET  /workflows/{workflow_id}/analytics/eligible-recordings
GET  /workflows/{workflow_id}/analytics-runs
GET  /analytics-runs/{run_id}
POST /analytics-runs/{run_id}/retry
```

`summary_failed` preserves the deterministic charts and allows a summary-only
retry. A full retry reuses the same locked SOP snapshots. Generating analytics
again creates a new workflow-scoped version and leaves prior versions intact.

Step embeddings use `text-embedding-3-small` at 1536 dimensions and are cached
per SOP step/content hash in pgvector. Alignment groups are local to one run;
there is no canonical sequence and unmatched steps remain optional or
path-specific rather than being labelled incorrect.

## Workforce clustering and sample size

Full workflow analytics should analyze all eligible approved recordings in the
workflow. It should not be limited to five manually selected recordings. The
first product version does not include date-range filtering.

Recommended interpretation by sample size:

| Recording count | Appropriate analysis |
| ---: | --- |
| 1 | Individual recording metrics only |
| 2–5 | Side-by-side recording comparison |
| 6–14 | Preliminary clustering and friction, clearly labelled by quality/confidence |
| 15–29 | Basic clustering, clearly marked as low confidence |
| 30+ | More reliable 2–4 path clusters and executive analytics |
| 50+ | Stronger workflow-variance and cohort conclusions |

Implemented behaviour:

- Keep **Compare recordings** limited to 2–5 recordings.
- Make **Generate workflow analytics** analyze all eligible recordings.
- Require at least 6 recordings before attempting workforce analytics.
- Bound one immutable run to the latest 50 eligible approved recordings.
- Prefer 30 or more recordings before presenting clusters confidently to executives.
- Evaluate `k=2..4`, but fall back to one population when the paths do not separate reliably.
- Never publish singleton clusters; every reported cluster has at least two members.

K-means should not be run on a manually selected set of only five recordings. Manual selection can introduce cherry-picking, and two to four clusters derived from five sessions would not be meaningful.

## Friction model

Friction is calculated for each aligned step and, where clusters exist, for each
step/cluster cell. Missing timings remain missing rather than being treated as
zero. A metric needs at least three timing samples before it receives a score.

The transparent 0–100 score combines:

- 65% relative mean-duration percentile; and
- 35% coefficient-of-variation percentile.

The API also returns sample count, population count, mean, median, population
standard deviation, coefficient of variation, presence/optional frequency, and
a confidence label. The UI exposes these numbers in a friction chart and
cluster-by-step heatmap instead of presenting the score as unexplained AI output.

## Current decisions

- Compare between two and five recordings at a time.
- Use completion overview, path timeline, fastest-versus-average comparison, and a three-sentence executive summary.
- Use a horizontal completion-time chart, an elapsed-time path timeline, and a dumbbell chart.
- Analyze 6–50 eligible recordings in the workforce mode.
- Treat clustering as exploratory at low sample counts and show the measured quality.
- Do not label the fastest recording as a top performer without a success or quality signal.
- Keep employee identity out of the workforce-summary LLM payload; it receives aggregate cluster and friction data only.

## Remaining extensions

- Add dated trend analysis once the product needs it; current runs intentionally have no date-range filter.
- Add department/role cohorts only after role permissions and privacy thresholds exist.
- Add a committed 50-recording benchmark for the client performance acceptance gate.
- Keep unmatched steps as optional/path-specific evidence; there is intentionally no canonical path.
