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

/** Build a fully self-contained HTML document for an SOP, screenshots inlined. */
export function buildSopHtml(sop: BackendSOP, imageUrls: Record<string, string> = {}): string {
  const stepsHtml = sop.steps
    .map((step) => {
      const branchesHtml = step.decision_branches.length
        ? step.decision_branches
            .map(
              (branch) =>
                `<li class="branch"><strong>If:</strong> ${escapeHtml(branch.condition)} <strong>then:</strong> ${escapeHtml(branch.action)}</li>`
            )
            .join('')
        : ''
      const imageTag =
        step.screenshot_reference && imageUrls[step.screenshot_reference]
          ? `<img src="${imageUrls[step.screenshot_reference]}" class="step-image" />`
          : ''
      return `
    <div class="step">
      <div class="step-header">
        <span class="step-number">${step.position}</span>
        <div>
          <div class="step-title">${escapeHtml(step.title)}</div>
          <div class="step-instruction">${escapeHtml(step.instruction)}</div>
          ${step.warning ? `<div class="step-warning">⚠️ ${escapeHtml(step.warning)}</div>` : ''}
          ${step.estimated_time_ms ? `<div class="step-time">~ ${Math.round(step.estimated_time_ms / 1000)}s</div>` : ''}
        </div>
      </div>
      ${imageTag}
      ${branchesHtml ? `<ul class="branches">${branchesHtml}</ul>` : ''}
    </div>
  `
    })
    .join('')

  const documentSection = sop.document
    ? `<div class="document"><h2>Overview</h2><p>${escapeHtml(sop.document)}</p></div>`
    : ''

  const meta = [
    `Generated ${new Date(sop.created_at).toLocaleDateString()}`,
    `${sop.steps.length} step${sop.steps.length === 1 ? '' : 's'}`,
    `v${sop.version}`,
    sop.status,
    'WorkTrace AI'
  ].join(' · ')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>SOP - ${escapeHtml(sop.title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111; padding: 32px; max-width: 900px; margin: 0 auto; }
  h1 { font-size: 28px; font-weight: 900; border-bottom: 2px solid #eee; padding-bottom: 12px; margin: 0 0 8px; }
  .meta { color: #666; font-size: 12px; margin-bottom: 32px; }
  .document { margin-bottom: 32px; background: #f9fafb; border-radius: 12px; padding: 20px 24px; }
  .document h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; margin: 0 0 8px; }
  .document p { font-size: 14px; line-height: 1.6; margin: 0; white-space: pre-line; }
  .step { margin-bottom: 32px; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; break-inside: avoid; }
  .step-header { display: flex; gap: 16px; margin-bottom: 12px; }
  .step-number { background: #f3f4f6; border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 14px; flex-shrink: 0; }
  .step-title { font-weight: 700; font-size: 13px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.08em; }
  .step-instruction { font-size: 15px; margin-top: 4px; color: #111; line-height: 1.6; }
  .step-warning { font-size: 12px; color: #d97706; margin-top: 8px; }
  .step-time { font-size: 11px; color: #9ca3af; margin-top: 6px; font-family: ui-monospace, monospace; }
  .step-image { width: 100%; border-radius: 8px; border: 1px solid #e5e7eb; margin: 12px 0; }
  .branches { margin-top: 12px; padding-left: 18px; }
  .branch { font-size: 13px; color: #374151; margin-bottom: 4px; }
  @media print {
    .step { break-inside: avoid; }
    @page { margin: 18mm; }
  }
</style>
</head>
<body>
<h1>${escapeHtml(sop.title)}</h1>
<div class="meta">${escapeHtml(meta)}</div>
${documentSection}
${stepsHtml}
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
