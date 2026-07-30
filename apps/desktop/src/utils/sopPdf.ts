import type { BackendSOP } from '../../shared/recording'

// ─── SOP PDF export ───────────────────────────────────────────────────────────
//
// Renders an SOP into self-contained HTML and asks Electron's main process to
// save a real PDF via webContents.printToPDF().
//
// `imageUrls` is a map from `screenshot_reference` (UUID string) to a blob: or
// data: URL the caller has already fetched. The caller owns the blob lifecycle
// The helper converts those URLs into data URLs before sending HTML to main,
// because renderer-owned blob URLs are not readable from the hidden PDF window.

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Build a fully self-contained HTML document for an SOP.
 *
 * Design: "Procedural Evidence Log" — forensic-style with cream paper
 * background, square step-number markers on a timeline, exhibit-framed
 * screenshots, amber warning blocks, and a two-column decision matrix.
 * Typography: Inter (headings/body) + JetBrains Mono (metadata/codes).
 */
export function buildSopHtml(sop: BackendSOP, imageUrls: Record<string, string> = {}): string {
  const totalSteps = sop.steps.length
  const pad2 = (n: number) => String(n).padStart(2, '0')

  // ── Date: YYYY-MM-DD HH:MMZ ───────────────────────────────────────────────
  const d = new Date(sop.created_at)
  const dateStr = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}Z`

  // ── Doc reference from first 6 hex chars of UUID + version ───────────────
  const docId = `SOP-${sop.id.replace(/-/g, '').substring(0, 6).toUpperCase()}-V${sop.version}`

  // ── Status clearance badge text ───────────────────────────────────────────
  const statusLabel =
    sop.status === 'approved'
      ? 'APPROVED — OPERATIONAL'
      : sop.status === 'archived'
        ? 'ARCHIVED'
        : 'PENDING REVIEW'

  // ── Overview / document narrative ─────────────────────────────────────────
  const documentSection = sop.document
    ? `<div class="overview">
        <div class="label">Procedure Overview</div>
        <p class="overview-text">${escapeHtml(sop.document)}</p>
      </div>`
    : ''

  // ── Per-step HTML ─────────────────────────────────────────────────────────
  const stepsHtml = sop.steps
    .map((step, idx) => {
      // Alternate marker style: filled for odd positions, outline for even
      const markerClass = idx % 2 === 0 ? 'step-marker filled' : 'step-marker outline'

      // Context strip: step position + optional time estimate + branch count
      const ctxParts: string[] = [`STEP ${pad2(step.position)} OF ${pad2(totalSteps)}`]
      if (step.estimated_time_ms != null) {
        ctxParts.push(`EST: ~${Math.round(step.estimated_time_ms / 1000)}s`)
      }
      if (step.decision_branches.length > 0) {
        ctxParts.push(`BRANCHES: ${step.decision_branches.length}`)
      }
      const contextInner = ctxParts
        .map(p => `<span class="ctx-part">${p}</span>`)
        .join('<span class="ctx-sep">|</span>')

      // Exhibit label: 1, 2, 3...
      const exhibitLabel = String(idx + 1)

      // Screenshot exhibit frame
      const screenshotUrl = step.screenshot_reference
        ? (imageUrls[step.screenshot_reference] ?? null)
        : null
      const imageBlock = screenshotUrl
        ? `<div class="exhibit-frame">
            <div class="exhibit-stamp">Exhibit&nbsp;${exhibitLabel}</div>
            <img src="${screenshotUrl}" class="exhibit-img" alt="Step ${step.position} screenshot"/>
            <div class="exhibit-caption">
              <span>FIG&nbsp;${step.position}.1: STEP ${step.position} EVIDENCE</span>
              <span>REF:&nbsp;${step.screenshot_reference!.substring(0, 8).toUpperCase()}</span>
            </div>
          </div>`
        : ''

      // Warning block with amber diamond marker
      const warningBlock = step.warning
        ? `<div class="warning-block">
            <div class="warning-diamond"></div>
            <span class="warning-icon">&#9888;</span>
            <div class="warning-body">
              <div class="warning-label">Critical Stop</div>
              <div class="warning-text">${escapeHtml(step.warning)}</div>
            </div>
          </div>`
        : ''

      // Decision matrix: two-column condition → action grid
      const branchesBlock =
        step.decision_branches.length > 0
          ? `<div class="decision-matrix">
              <div class="label">Decision Matrix</div>
              ${step.decision_branches
                .map(
                  branch =>
                    `<div class="decision-row">
                      <div class="decision-cell condition">
                        <div class="cell-label">Condition</div>
                        <div class="cell-text">${escapeHtml(branch.condition)}</div>
                      </div>
                      <div class="decision-cell action">
                        <div class="cell-label">Action</div>
                        <div class="cell-text">${escapeHtml(branch.action)}</div>
                      </div>
                    </div>`
                )
                .join('')}
            </div>`
          : ''

      return `<div class="step-block">
        <div class="${markerClass}">${pad2(step.position)}</div>
        <div class="context-strip">${contextInner}</div>
        <div class="step-card">
          <h2 class="step-title">${escapeHtml(step.title)}</h2>
          <p class="step-instruction">${escapeHtml(step.instruction)}</p>
          ${imageBlock}
          ${warningBlock}
          ${branchesBlock}
        </div>
      </div>`
    })
    .join('\n')

  // ── Full document ─────────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>SOP \u2014 ${escapeHtml(sop.title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet"/>
<style>
  /* ── Reset ── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  /* ── Page shell ── */
  body {
    background: #e0e0e0;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
    padding: 32px 16px;
    min-height: 100vh;
  }

  /* ── Paper canvas ── */
  .export-paper {
    background-color: #fcfcfc;
    /* Subtle noise texture via inline SVG data URI */
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
    color: #1a1a1c;
    max-width: 900px;
    margin: 0 auto;
    box-shadow: 0 24px 64px rgba(0,0,0,0.18), 0 4px 16px rgba(0,0,0,0.1);
  }

  /* ── Document header ── */
  .doc-header {
    border-bottom: 4px solid #1a1a1c;
    padding: 40px;
    position: relative;
  }
  .doc-header-meta {
    position: absolute;
    top: 40px;
    right: 40px;
    text-align: right;
  }
  .doc-header-meta div {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.08em;
    font-weight: 500;
    color: #4a4a4d;
    margin-bottom: 4px;
  }
  .doc-eyebrow {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.14em;
    font-weight: 700;
    color: #4a4a4d;
    text-transform: uppercase;
    margin-bottom: 16px;
  }
  .doc-title {
    font-family: 'Inter', sans-serif;
    font-size: 36px;
    line-height: 1.2;
    letter-spacing: -0.02em;
    font-weight: 700;
    color: #1a1a1c;
    margin-bottom: 24px;
    max-width: 520px;
  }
  .doc-fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 32px;
    padding-top: 24px;
    border-top: 1px solid #e5e5e5;
    max-width: 520px;
  }
  .doc-field-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.1em;
    font-weight: 500;
    color: #4a4a4d;
    text-transform: uppercase;
    margin-bottom: 6px;
  }
  .doc-field-value {
    font-family: 'Inter', sans-serif;
    font-size: 16px;
    font-weight: 600;
    color: #1a1a1c;
  }
  .status-badge {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    font-weight: 700;
    background: #1a1a1c;
    color: #ffffff;
    padding: 4px 10px;
    display: inline-block;
    letter-spacing: 0.06em;
  }

  /* ── Steps container ── */
  .steps-container {
    padding: 48px 40px;
  }
  .steps-list {
    border-left: 2px solid rgba(26,26,28,0.15);
    margin-left: 15px;
    padding-left: 39px;
  }

  /* ── Overview block ── */
  .overview {
    margin-bottom: 40px;
    padding: 20px 24px;
    border-left: 4px solid #1a1a1c;
    background: #f4f4f4;
  }
  .label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.12em;
    font-weight: 700;
    color: #4a4a4d;
    text-transform: uppercase;
    margin-bottom: 10px;
  }
  .overview-text {
    font-family: 'Inter', sans-serif;
    font-size: 16px;
    line-height: 1.7;
    color: #1a1a1c;
    white-space: pre-line;
  }

  /* ── Individual step ── */
  .step-block {
    position: relative;
    margin-bottom: 44px;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .step-block:first-child {
    page-break-inside: auto;
    break-inside: auto;
  }

  /* Square step-number marker */
  .step-marker {
    position: absolute;
    left: -56px;
    top: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    font-weight: 700;
    z-index: 10;
  }
  .step-marker.filled { background: #1a1a1c; color: #ffffff; }
  .step-marker.outline { background: #ffffff; border: 2px solid #1a1a1c; color: #1a1a1c; }

  /* Context strip with left-border accent */
  .context-strip {
    border-left: 2px solid #1a1a1c;
    padding-left: 12px;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    page-break-after: avoid;
    break-after: avoid;
  }
  .ctx-part {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.06em;
    font-weight: 500;
    color: #4a4a4d;
    text-transform: uppercase;
  }
  .ctx-sep {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: #9ca3af;
    margin: 0 10px;
  }

  /* Step card */
  .step-card {
    background: #ffffff;
    border: 2px solid #e5e5e5;
    padding: 24px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
  }
  .step-title {
    font-family: 'Inter', sans-serif;
    font-size: 24px;
    line-height: 1.3;
    font-weight: 600;
    color: #1a1a1c;
    margin-bottom: 14px;
    page-break-after: avoid;
    break-after: avoid;
  }
  .step-instruction {
    font-family: 'Inter', sans-serif;
    font-size: 16px;
    line-height: 1.65;
    color: #1a1a1c;
    margin: 0;
  }

  /* ── Exhibit frame (screenshot) ── */
  .exhibit-frame {
    border: 2px solid #1a1a1c;
    padding: 4px;
    background: #ffffff;
    position: relative;
    margin-top: 24px;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .exhibit-stamp {
    position: absolute;
    top: -10px;
    left: -10px;
    background: #1a1a1c;
    color: #ffffff;
    padding: 4px 8px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    transform: rotate(-2deg);
    z-index: 10;
  }
  .exhibit-img {
    width: 100%;
    display: block;
    max-height: 340px;
    object-fit: contain;
  }
  .exhibit-caption {
    padding: 10px 14px;
    border-top: 2px solid #1a1a1c;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #f4f4f4;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.08em;
    color: #4a4a4d;
    text-transform: uppercase;
  }

  /* ── Warning block ── */
  .warning-block {
    display: flex;
    align-items: flex-start;
    padding: 16px;
    background: #fffbeb;
    border: 1px solid #fde68a;
    margin-top: 20px;
    position: relative;
  }
  .warning-diamond {
    position: absolute;
    left: -8px;
    top: 16px;
    width: 14px;
    height: 14px;
    background: #f59e0b;
    transform: rotate(45deg);
  }
  .warning-icon {
    font-size: 18px;
    color: #b45309;
    margin-right: 12px;
    line-height: 1.4;
    flex-shrink: 0;
  }
  .warning-body { flex: 1; }
  .warning-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.1em;
    font-weight: 700;
    color: #78350f;
    text-transform: uppercase;
    margin-bottom: 6px;
  }
  .warning-text {
    font-family: 'Inter', sans-serif;
    font-size: 15px;
    line-height: 1.6;
    color: #78350f;
  }

  /* ── Decision matrix ── */
  .decision-matrix {
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid #e5e5e5;
  }
  .decision-matrix .label { margin-bottom: 14px; }
  .decision-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    border: 2px solid #1a1a1c;
    margin-bottom: 8px;
  }
  .decision-cell { padding: 12px 16px; }
  .decision-cell.condition {
    background: #eff6ff;
    border-right: 2px solid #1a1a1c;
  }
  .decision-cell.action { background: #f0fdf4; }
  .cell-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.08em;
    font-weight: 700;
    text-transform: uppercase;
    margin-bottom: 6px;
  }
  .decision-cell.condition .cell-label { color: #1e40af; }
  .decision-cell.action .cell-label { color: #166534; }
  .cell-text {
    font-family: 'Inter', sans-serif;
    font-size: 14px;
    line-height: 1.5;
  }
  .decision-cell.condition .cell-text { color: #1e3a8a; }
  .decision-cell.action .cell-text { color: #14532d; }

  /* ── Footer ── */
  .doc-footer {
    border-top: 2px solid #1a1a1c;
    padding: 20px 40px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #f4f4f4;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.08em;
    color: #4a4a4d;
    text-transform: uppercase;
  }

  /* ── Print rules ── */
  @media print {
    body { background: #fcfcfc; padding: 0; }
    .export-paper { box-shadow: none; max-width: 100%; }
    @page { margin: 18mm; }
  }
</style>
</head>
<body>
<main class="export-paper">

  <!-- Document header -->
  <header class="doc-header">
    <div class="doc-header-meta">
      <div>DOC ID: ${docId}</div>
      <div>REV: v${sop.version}.0</div>
      <div>${dateStr}</div>
    </div>
    <div class="doc-eyebrow">Procedural Evidence Log</div>
    <h1 class="doc-title">${escapeHtml(sop.title)}</h1>
    <div class="doc-fields">
      <div>
        <div class="doc-field-label">Steps</div>
        <div class="doc-field-value">${totalSteps}&nbsp;procedure${totalSteps === 1 ? '' : 's'}</div>
      </div>
      <div>
        <div class="doc-field-label">Status</div>
        <div class="status-badge">${statusLabel}</div>
      </div>
    </div>
  </header>

  <!-- Steps -->
  <div class="steps-container">
    ${documentSection}
    <div class="steps-list">
      ${stepsHtml}
    </div>
  </div>

  <!-- Footer -->
  <footer class="doc-footer">
    <span>WorkTrace &middot; Procedural Integrity</span>
    <span>${escapeHtml(sop.title)} &middot; ${docId}</span>
  </footer>

</main>
</body>
</html>`
}

async function urlToDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not read screenshot for PDF (${response.status}).`)
  const blob = await response.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not prepare screenshot for PDF.'))
    reader.readAsDataURL(blob)
  })
}

async function inlineImageUrls(imageUrls: Record<string, string>): Promise<Record<string, string>> {
  const entries = await Promise.all(
    Object.entries(imageUrls).map(async ([id, url]) => [id, await urlToDataUrl(url)] as const)
  )
  return Object.fromEntries(entries)
}

export async function triggerSopPdfExport(
  sop: BackendSOP,
  imageUrls: Record<string, string> = {}
): Promise<string | null> {
  const html = buildSopHtml(sop, await inlineImageUrls(imageUrls))
  return window.api.recording.exportSopPdf(html, sop.title)
}
