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

  // PDF coordinates (top-left origin) -> screen position
  pdfToScreen(x, y, pageNumber) {
    const pageContainer = this.viewer.getPageContainer(pageNumber)
    if (!pageContainer) return null

    const rect = pageContainer.getBoundingClientRect()
    const scale = this.viewer.getScale()

    const screenX = x * scale + rect.left
    const screenY = y * scale + rect.top

    return { x: screenX, y: screenY }
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

          // Check if rects overlap (share vertical AND horizontal space)
          const verticalOverlap = rect.top < existing.bottom && rect.bottom > existing.top
          const horizontalOverlap = rect.left < existing.right && rect.right > existing.left

          // Also merge if they're adjacent horizontally on same line
          const sameLine = Math.abs(rect.top - existing.top) < 3 && Math.abs(rect.bottom - existing.bottom) < 3
          const horizontallyAdjacent = Math.abs(rect.left - existing.right) < 2 || Math.abs(existing.left - rect.right) < 2

          if ((verticalOverlap && horizontalOverlap) || (sameLine && horizontallyAdjacent)) {
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

  // Convert ink strokes from screen coordinates to PDF coordinates
  strokesToPdfCoords(strokes, pageNumber) {
    const pageContainer = this.viewer.getPageContainer(pageNumber)
    if (!pageContainer) return []

    const pageRect = pageContainer.getBoundingClientRect()
    const scale = this.viewer.getScale()

    return strokes.map(stroke => ({
      points: stroke.points.map(point => ({
        x: (point.x - pageRect.left) / scale,
        y: (point.y - pageRect.top) / scale
      }))
    }))
  }

  // Convert freehand strokes to quads (for freehand highlight)
  strokesPathToQuads(points, thickness, pageNumber) {
    const pageContainer = this.viewer.getPageContainer(pageNumber)
    if (!pageContainer) return []

    const pageRect = pageContainer.getBoundingClientRect()
    const scale = this.viewer.getScale()
    const halfThickness = (thickness / 2) / scale

    const quads = []

    for (let i = 1; i < points.length; i++) {
      const p1 = {
        x: (points[i - 1].x - pageRect.left) / scale,
        y: (points[i - 1].y - pageRect.top) / scale
      }
      const p2 = {
        x: (points[i].x - pageRect.left) / scale,
        y: (points[i].y - pageRect.top) / scale
      }

      // Calculate perpendicular offset for stroke width
      const dx = p2.x - p1.x
      const dy = p2.y - p1.y
      const len = Math.sqrt(dx * dx + dy * dy)

      if (len === 0) continue

      const nx = -dy / len * halfThickness
      const ny = dx / len * halfThickness

      quads.push({
        p1: { x: p1.x - nx, y: p1.y - ny },
        p2: { x: p1.x + nx, y: p1.y + ny },
        p3: { x: p2.x - nx, y: p2.y - ny },
        p4: { x: p2.x + nx, y: p2.y + ny }
      })
    }

    return quads
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
