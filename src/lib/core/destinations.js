/**
 * PDF destinations: where a link, bookmark or named anchor points.
 *
 * A destination is either a name, looked up in the document's /Dests or
 * /Names tree, or an explicit array `[page, {name: type}, ...args]`, where
 * page is a reference or a 0-based index and the arguments depend on the type
 * (PDF 32000-1 §12.3.2.2).
 */

/**
 * Resolve a destination to a 1-based page number and, where it names one,
 * the point on that page to bring to the top-left of the view.
 *
 * The zoom some destination types carry is not returned: following a
 * destination does not change the reader's zoom (see issue #28).
 *
 * @param {PDFDocumentProxy} pdfDocument
 * @param {string|Array} dest - A destination name or an explicit destination
 * @returns {Promise<{pageNumber: number, point: {x: number|null, y: number|null}|null}|null>}
 *   null when the name is unknown or the destination points nowhere usable
 */
export async function resolveDestination(pdfDocument, dest) {
  if (!pdfDocument) return null

  const explicit = typeof dest === "string" ? await pdfDocument.getDestination(dest) : dest
  if (!Array.isArray(explicit) || explicit.length === 0) return null

  const target = explicit[0]
  let pageIndex = null
  if (Number.isInteger(target)) {
    pageIndex = target
  } else if (target && typeof target === "object") {
    pageIndex = await pdfDocument.getPageIndex(target)
  }

  if (!Number.isInteger(pageIndex)) return null
  const pageNumber = pageIndex + 1
  if (pageNumber < 1 || pageNumber > pdfDocument.numPages) return null

  return { pageNumber, point: destinationPoint(explicit) }
}

const coordinate = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null)

/**
 * The point an explicit destination asks to be shown at the top-left of the
 * view, or null when it only names the page (Fit, FitB) or nothing usable.
 * @param {Array} explicit - `[page, {name}, ...args]`
 * @returns {{x: number|null, y: number|null}|null}
 */
export function destinationPoint(explicit) {
  const type = explicit[1]?.name ?? explicit[1]
  const args = explicit.slice(2)
  let x = null
  let y = null

  switch (type) {
    case "XYZ":
      x = coordinate(args[0])
      y = coordinate(args[1])
      break
    case "FitH":
    case "FitBH":
      y = coordinate(args[0])
      break
    case "FitV":
    case "FitBV":
      x = coordinate(args[0])
      break
    case "FitR":
      // left bottom right top: show the rectangle's top-left
      x = coordinate(args[0])
      y = coordinate(args[3])
      break
    default:
      return null
  }

  return x === null && y === null ? null : { x, y }
}
