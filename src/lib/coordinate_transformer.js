export class CoordinateTransformer {
  constructor(viewer) {
    this.viewer = viewer
  }

  // Screen event -> PDF page coordinates (top-left origin)
  screenToPdf(event, pageNumber) {
    const pageContainer = this.viewer.getPageContainer(pageNumber)
    if (!pageContainer) return null

    const rect = pageContainer.getBoundingClientRect()
    const scale = this.viewer.getScale()

    // Get position relative to page element
    const screenX = event.clientX - rect.left
    const screenY = event.clientY - rect.top

    // Scale to PDF coordinates
    const pdfX = screenX / scale
    const pdfY = screenY / scale

    return { x: pdfX, y: pdfY, pageNumber }
  }

  // Convert selection rectangles to quads format
  selectionRectsToQuads(rects, pageNumber) {
    const pageContainer = this.viewer.getPageContainer(pageNumber)
    if (!pageContainer) return []

    const pageRect = pageContainer.getBoundingClientRect()
    const scale = this.viewer.getScale()

    // Minimum size threshold to filter out phantom rects (in PDF coordinates)
    const minSize = 1

    // Convert to simple rect objects, filtering out invalid/phantom rects
    // Chrome's getClientRects() can return zero-size rects for line breaks,
    // or rects outside the selection area
    const rectArray = Array.from(rects)
      .filter(rect => {
        // Filter out zero-size or tiny rects
        const width = rect.right - rect.left
        const height = rect.bottom - rect.top
        if (width < 1 || height < 1) return false

        // Filter out rects that are entirely outside the page
        if (rect.right < pageRect.left || rect.left > pageRect.right) return false
        if (rect.bottom < pageRect.top || rect.top > pageRect.bottom) return false

        return true
      })
      .map(rect => ({
        left: (rect.left - pageRect.left) / scale,
        right: (rect.right - pageRect.left) / scale,
        top: (rect.top - pageRect.top) / scale,
        bottom: (rect.bottom - pageRect.top) / scale
      }))
      .filter(rect => {
        // After conversion to PDF coords, also filter out degenerate rects
        const width = rect.right - rect.left
        const height = rect.bottom - rect.top
        if (width < minSize || height < minSize) return false

        // Filter out rects at the very top-left corner (likely phantom rects)
        // Real text selections rarely start at exactly (0,0)
        if (rect.left < minSize && rect.top < minSize) return false

        return true
      })

    const mergedRects = this._mergeOverlappingRects(rectArray)

    return mergedRects.map(rect => ({
      p1: { x: rect.left, y: rect.top },     // top-left
      p2: { x: rect.right, y: rect.top },    // top-right
      p3: { x: rect.left, y: rect.bottom },  // bottom-left
      p4: { x: rect.right, y: rect.bottom }  // bottom-right
    }))
  }

  // Merge overlapping or adjacent rectangles to prevent double-rendering
  _mergeOverlappingRects(rects) {
    if (rects.length === 0) return []

    // First pass: merge rects that overlap vertically AND horizontally
    let working = [...rects]
    let merged = true

    while (merged) {
      merged = false
      const result = []

      for (const rect of working) {
        let didMerge = false

        for (let i = 0; i < result.length; i++) {
          const existing = result[i]

          // Calculate vertical overlap amount
          const overlapTop = Math.max(rect.top, existing.top)
          const overlapBottom = Math.min(rect.bottom, existing.bottom)
          const overlapHeight = Math.max(0, overlapBottom - overlapTop)

          // Require significant vertical overlap (at least 50% of smaller rect's height)
          // This prevents merging rects from different lines that only slightly overlap
          const rectHeight = rect.bottom - rect.top
          const existingHeight = existing.bottom - existing.top
          const minHeight = Math.min(rectHeight, existingHeight)
          const significantVerticalOverlap = overlapHeight > minHeight * 0.5

          const horizontalOverlap = rect.left < existing.right && rect.right > existing.left

          // Also merge if they're adjacent horizontally on same line
          const sameLine = Math.abs(rect.top - existing.top) < 3 && Math.abs(rect.bottom - existing.bottom) < 3
          const horizontallyAdjacent = Math.abs(rect.left - existing.right) < 2 || Math.abs(existing.left - rect.right) < 2

          if ((significantVerticalOverlap && horizontalOverlap) || (sameLine && horizontallyAdjacent)) {
            // Merge: extend existing rect to encompass both
            result[i] = {
              left: Math.min(existing.left, rect.left),
              right: Math.max(existing.right, rect.right),
              top: Math.min(existing.top, rect.top),
              bottom: Math.max(existing.bottom, rect.bottom)
            }
            didMerge = true
            merged = true
            break
          }
        }

        if (!didMerge) {
          result.push({ ...rect })
        }
      }

      working = result
    }

    return working
  }

  // Calculate bounding rect from quads
  quadsToBoundingRect(quads) {
    if (quads.length === 0) return null

    let minX = Infinity, minY = Infinity
    let maxX = -Infinity, maxY = -Infinity

    for (const quad of quads) {
      for (const key of ["p1", "p2", "p3", "p4"]) {
        minX = Math.min(minX, quad[key].x)
        minY = Math.min(minY, quad[key].y)
        maxX = Math.max(maxX, quad[key].x)
        maxY = Math.max(maxY, quad[key].y)
      }
    }

    return [minX, minY, maxX - minX, maxY - minY]
  }
}
