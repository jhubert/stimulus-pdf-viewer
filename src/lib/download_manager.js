import { PDFDocument, rgb, degrees, StandardFonts, PDFName, PDFArray, PDFString } from "pdf-lib"
import { FetchRequest } from "@rails/request.js"

export class DownloadManager {
  constructor(options = {}) {
    this.documentUrl = options.documentUrl
    this.documentName = options.documentName
    this.organizationName = options.organizationName
    this.userName = options.userName
    this.annotationManager = options.annotationManager
    this.producer = options.producer || "stimulus-pdf-viewer"
    this._extGStateCache = new Map()
  }

  async downloadWithAnnotations() {
    // Clear cache for fresh download
    this._extGStateCache.clear()

    // Fetch original PDF using Rails request.js for consistent CSRF handling
    const request = new FetchRequest("get", this.documentUrl, { responseKind: "blob" })
    const response = await request.perform()
    const existingPdfBytes = await response.response.arrayBuffer()
    const pdfDoc = await PDFDocument.load(existingPdfBytes)

    // Set document metadata
    this._setDocumentMetadata(pdfDoc)

    // Get all annotations
    const annotations = this.annotationManager.getAllAnnotations()

    // Embed font for watermark
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)

    // Process each page
    const pages = pdfDoc.getPages()
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]
      const pageNumber = i + 1
      const { width, height } = page.getSize()

      // Apply watermark
      this._applyWatermarkToPage(page, font, width, height)

      // Apply annotations for this page
      const pageAnnotations = annotations.filter(a => a.page === pageNumber)
      this._applyAnnotationsToPage(pdfDoc, page, pageAnnotations, height)
    }

    // Save and download
    const pdfBytes = await pdfDoc.save()
    const filename = this._sanitizeFilename(this.documentName || "document")
    this._triggerDownload(pdfBytes, filename)
  }

  _applyWatermarkToPage(page, font, width, height) {
    if (!this.userName) return

    // Diagonal watermark
    page.drawText(this.userName, {
      x: width / 2 - 50,
      y: height / 2,
      size: 25,
      font: font,
      color: rgb(0, 0, 0),
      opacity: 0.07,
      rotate: degrees(-45)
    })

    // Header watermark
    const textWidth = font.widthOfTextAtSize(this.userName, 6)
    page.drawText(this.userName, {
      x: (width - textWidth) / 2,
      y: height - 10,
      size: 6,
      font: font,
      color: rgb(0, 0, 0),
      opacity: 0.10
    })
  }

  _applyAnnotationsToPage(pdfDoc, page, annotations, pageHeight) {
    for (const annotation of annotations) {
      switch (annotation.annotation_type) {
        case "highlight":
          this._applyHighlight(pdfDoc, page, annotation, pageHeight)
          break
        case "underline":
          this._applyUnderline(pdfDoc, page, annotation, pageHeight)
          break
        case "ink":
          this._applyInk(pdfDoc, page, annotation, pageHeight)
          break
        case "note":
          this._applyNote(pdfDoc, page, annotation, pageHeight)
          break
      }
    }
  }

  _applyHighlight(pdfDoc, page, annotation, pageHeight) {
    const { quads, color } = annotation
    if (!quads || quads.length === 0) return

    const rgba = this._parseColor(color)

    // Build QuadPoints array - PDF format is [x1,y1,x2,y2,x3,y3,x4,y4] for each quad
    // Order: bottom-left, bottom-right, top-right, top-left (counter-clockwise from bottom-left)
    const quadPoints = []
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

    for (const quad of quads) {
      // Convert from top-left origin to bottom-left
      const points = [
        quad.p3.x, pageHeight - quad.p3.y, // bottom-left
        quad.p4.x, pageHeight - quad.p4.y, // bottom-right
        quad.p2.x, pageHeight - quad.p2.y, // top-right
        quad.p1.x, pageHeight - quad.p1.y, // top-left
      ]
      quadPoints.push(...points)

      // Track bounding box for Rect
      for (let i = 0; i < points.length; i += 2) {
        minX = Math.min(minX, points[i])
        maxX = Math.max(maxX, points[i])
        minY = Math.min(minY, points[i + 1])
        maxY = Math.max(maxY, points[i + 1])
      }
    }

    const annotationDict = pdfDoc.context.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Highlight"),
      Rect: [minX, minY, maxX, maxY],
      QuadPoints: quadPoints,
      C: [rgba.r, rgba.g, rgba.b],
      CA: 0.4,
      F: 4,
      ...this._getAnnotationMetadata(annotation),
    })

    this._addAnnotationToPage(pdfDoc, page, annotationDict)
  }

  _applyUnderline(pdfDoc, page, annotation, pageHeight) {
    const { quads, color } = annotation
    if (!quads || quads.length === 0) return

    const rgba = this._parseColor(color)

    // Build QuadPoints array - same format as highlight
    const quadPoints = []
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

    for (const quad of quads) {
      const points = [
        quad.p3.x, pageHeight - quad.p3.y,
        quad.p4.x, pageHeight - quad.p4.y,
        quad.p2.x, pageHeight - quad.p2.y,
        quad.p1.x, pageHeight - quad.p1.y,
      ]
      quadPoints.push(...points)

      for (let i = 0; i < points.length; i += 2) {
        minX = Math.min(minX, points[i])
        maxX = Math.max(maxX, points[i])
        minY = Math.min(minY, points[i + 1])
        maxY = Math.max(maxY, points[i + 1])
      }
    }

    const annotationDict = pdfDoc.context.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Underline"),
      Rect: [minX, minY, maxX, maxY],
      QuadPoints: quadPoints,
      C: [rgba.r, rgba.g, rgba.b],
      F: 4,
      ...this._getAnnotationMetadata(annotation),
    })

    this._addAnnotationToPage(pdfDoc, page, annotationDict)
  }

  _applyInk(pdfDoc, page, annotation, pageHeight) {
    // Freehand highlights need different rendering (thick, semi-transparent strokes)
    if (annotation.subject === "Free Highlight") {
      this._applyFreehandHighlight(pdfDoc, page, annotation, pageHeight)
      return
    }

    const { ink_strokes, color } = annotation
    if (!ink_strokes || ink_strokes.length === 0) return

    const rgba = this._parseColor(color)
    const strokeWidth = 2

    // Build InkList and track bounding box
    const inkList = []
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

    for (const stroke of ink_strokes) {
      const points = stroke.points || []
      if (points.length < 2) continue

      const pathPoints = []
      for (const point of points) {
        const pdfX = point.x
        const pdfY = pageHeight - point.y
        pathPoints.push(pdfX, pdfY)

        minX = Math.min(minX, pdfX)
        maxX = Math.max(maxX, pdfX)
        minY = Math.min(minY, pdfY)
        maxY = Math.max(maxY, pdfY)
      }
      inkList.push(pathPoints)
    }

    if (inkList.length === 0) return

    // Add padding to bounding box for stroke width
    const padding = strokeWidth + 2
    minX -= padding
    minY -= padding
    maxX += padding
    maxY += padding

    // Build appearance stream content (PDF drawing commands)
    // Coordinates in appearance stream are relative to the BBox origin
    let streamContent = `${strokeWidth} w 1 J 1 j ` // width, round line cap, round line join
    streamContent += `${rgba.r} ${rgba.g} ${rgba.b} RG ` // stroke color

    for (const pathPoints of inkList) {
      for (let i = 0; i < pathPoints.length; i += 2) {
        // Translate to appearance stream coordinates (relative to minX, minY)
        const x = pathPoints[i] - minX
        const y = pathPoints[i + 1] - minY
        if (i === 0) {
          streamContent += `${x.toFixed(2)} ${y.toFixed(2)} m ` // moveto
        } else {
          streamContent += `${x.toFixed(2)} ${y.toFixed(2)} l ` // lineto
        }
      }
      streamContent += "S " // stroke
    }

    // Create the appearance stream (Form XObject)
    const appearanceStream = pdfDoc.context.stream(streamContent, {
      Type: PDFName.of("XObject"),
      Subtype: PDFName.of("Form"),
      FormType: 1,
      BBox: [0, 0, maxX - minX, maxY - minY],
    })
    const appearanceRef = pdfDoc.context.register(appearanceStream)

    const annotationDict = pdfDoc.context.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Ink"),
      Rect: [minX, minY, maxX, maxY],
      InkList: inkList,
      C: [rgba.r, rgba.g, rgba.b],
      BS: { W: strokeWidth, LC: 1 },
      F: 4,
      AP: { N: appearanceRef },
      ...this._getAnnotationMetadata(annotation),
    })

    this._addAnnotationToPage(pdfDoc, page, annotationDict)
  }

  _applyFreehandHighlight(pdfDoc, page, annotation, pageHeight) {
    const { ink_strokes, color } = annotation
    if (!ink_strokes || ink_strokes.length === 0) return

    const rgba = this._parseColor(color)
    const strokeWidth = annotation.thickness || 24
    const opacity = annotation.opacity || 0.2

    // Build path and track bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    const paths = []

    for (const stroke of ink_strokes) {
      const points = stroke.points || []
      if (points.length < 2) continue

      const pathPoints = []
      for (const point of points) {
        const pdfX = point.x
        const pdfY = pageHeight - point.y
        pathPoints.push({ x: pdfX, y: pdfY })

        minX = Math.min(minX, pdfX)
        maxX = Math.max(maxX, pdfX)
        minY = Math.min(minY, pdfY)
        maxY = Math.max(maxY, pdfY)
      }
      paths.push(pathPoints)
    }

    if (paths.length === 0) return

    // Add padding for stroke width
    const padding = strokeWidth / 2 + 2
    minX -= padding
    minY -= padding
    maxX += padding
    maxY += padding

    // Build appearance stream with transparency
    // Use graphics state for opacity
    let streamContent = `/GS1 gs ` // Use graphics state with opacity
    streamContent += `${strokeWidth} w 1 J 1 j ` // width, round line cap, round line join
    streamContent += `${rgba.r} ${rgba.g} ${rgba.b} RG ` // stroke color

    for (const pathPoints of paths) {
      for (let i = 0; i < pathPoints.length; i++) {
        const x = (pathPoints[i].x - minX).toFixed(2)
        const y = (pathPoints[i].y - minY).toFixed(2)
        if (i === 0) {
          streamContent += `${x} ${y} m ` // moveto
        } else {
          streamContent += `${x} ${y} l ` // lineto
        }
      }
      streamContent += "S " // stroke
    }

    // Get cached graphics state for transparency and blend mode
    const gsRef = this._getExtGState(pdfDoc, { opacity })

    // Create resources dictionary with the graphics state
    const resourcesDict = pdfDoc.context.obj({
      ExtGState: { GS1: gsRef },
    })

    // Create the appearance stream
    const appearanceStream = pdfDoc.context.stream(streamContent, {
      Type: PDFName.of("XObject"),
      Subtype: PDFName.of("Form"),
      FormType: 1,
      BBox: [0, 0, maxX - minX, maxY - minY],
      Resources: resourcesDict,
    })
    const appearanceRef = pdfDoc.context.register(appearanceStream)

    // Build InkList for the annotation structure
    const inkList = paths.map(pathPoints =>
      pathPoints.flatMap(p => [p.x, p.y])
    )

    const annotationDict = pdfDoc.context.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Ink"),
      Rect: [minX, minY, maxX, maxY],
      InkList: inkList,
      C: [rgba.r, rgba.g, rgba.b],
      CA: opacity,
      BS: { W: strokeWidth, LC: 1 },
      F: 4,
      AP: { N: appearanceRef },
      ...this._getAnnotationMetadata(annotation),
    })

    this._addAnnotationToPage(pdfDoc, page, annotationDict)
  }

  _applyNote(pdfDoc, page, annotation, pageHeight) {
    const { rect, contents, color } = annotation
    if (!rect || !contents) return

    const rgba = this._parseColor(color)
    const [x, y] = rect
    // Convert from top-left origin to bottom-left (PDF uses bottom-left)
    const pdfY = pageHeight - y
    const iconSize = 24

    const annotationDict = pdfDoc.context.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Text"),
      Rect: [x, pdfY - iconSize, x + iconSize, pdfY],
      Contents: PDFString.of(contents),
      C: [rgba.r, rgba.g, rgba.b],
      Name: PDFName.of("Comment"),
      Open: false,
      F: 4,
      ...this._getAnnotationMetadata(annotation),
    })

    this._addAnnotationToPage(pdfDoc, page, annotationDict)
  }

  _getExtGState(pdfDoc, { opacity, blendMode = "Multiply" }) {
    const key = `${opacity}:${blendMode}`
    if (this._extGStateCache.has(key)) {
      return this._extGStateCache.get(key)
    }

    const gsDict = pdfDoc.context.obj({
      Type: PDFName.of("ExtGState"),
      CA: opacity,
      ca: opacity,
      BM: PDFName.of(blendMode),
    })

    const gsRef = pdfDoc.context.register(gsDict)
    this._extGStateCache.set(key, gsRef)
    return gsRef
  }

  _addAnnotationToPage(pdfDoc, page, annotationDict) {
    const annotationRef = pdfDoc.context.register(annotationDict)
    const pageDict = page.node
    let annotsArray = pageDict.lookup(PDFName.of("Annots"))

    if (annotsArray instanceof PDFArray) {
      annotsArray.push(annotationRef)
    } else {
      const newAnnotsArray = pdfDoc.context.obj([annotationRef])
      pageDict.set(PDFName.of("Annots"), newAnnotsArray)
    }
  }

  _setDocumentMetadata(pdfDoc) {
    if (this.documentName) {
      pdfDoc.setTitle(this.documentName)
    }
    if (this.userName) {
      pdfDoc.setAuthor(this.userName)
    }
    if (this.organizationName) {
      pdfDoc.setCreator(this.organizationName)
    }
    pdfDoc.setProducer(this.producer)
    pdfDoc.setModificationDate(new Date())
  }

  _getAnnotationMetadata(annotation) {
    const metadata = {}

    // Author (T = title/author in PDF spec)
    if (this.userName) {
      metadata.T = PDFString.of(this.userName)
    }

    // Modification date (M) - use annotation's updated_at or created_at
    const dateStr = annotation.updated_at || annotation.created_at
    if (dateStr) {
      metadata.M = PDFString.of(this._formatPdfDate(new Date(dateStr)))
    }

    // Creation date
    if (annotation.created_at) {
      metadata.CreationDate = PDFString.of(this._formatPdfDate(new Date(annotation.created_at)))
    }

    return metadata
  }

  _formatPdfDate(date) {
    // PDF date format: D:YYYYMMDDHHmmssOHH'mm'
    const pad = (n) => n.toString().padStart(2, "0")

    const year = date.getFullYear()
    const month = pad(date.getMonth() + 1)
    const day = pad(date.getDate())
    const hours = pad(date.getHours())
    const minutes = pad(date.getMinutes())
    const seconds = pad(date.getSeconds())

    // Timezone offset
    const tzOffset = date.getTimezoneOffset()
    const tzSign = tzOffset <= 0 ? "+" : "-"
    const tzHours = pad(Math.floor(Math.abs(tzOffset) / 60))
    const tzMinutes = pad(Math.abs(tzOffset) % 60)

    return `D:${year}${month}${day}${hours}${minutes}${seconds}${tzSign}${tzHours}'${tzMinutes}'`
  }

  _parseColor(colorStr) {
    if (!colorStr) {
      return { r: 1, g: 1, b: 0, a: 1 } // Default yellow
    }

    // Handle #RRGGBB or #RRGGBBAA format
    const hex = colorStr.replace("#", "")
    const r = parseInt(hex.slice(0, 2), 16) / 255
    const g = parseInt(hex.slice(2, 4), 16) / 255
    const b = parseInt(hex.slice(4, 6), 16) / 255
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1

    return { r, g, b, a }
  }

  setDownloadBridge(bridge) {
    this._downloadBridge = bridge
  }

  _sanitizeFilename(name) {
    // Remove or replace characters that are problematic in filenames
    let sanitized = name
      .replace(/[<>:"/\\|?*]/g, "") // Remove illegal characters
      .replace(/\s+/g, " ")          // Normalize whitespace
      .trim()

    // Ensure it ends with .pdf
    if (!sanitized.toLowerCase().endsWith(".pdf")) {
      sanitized += ".pdf"
    }

    return sanitized || "document.pdf"
  }

  _triggerDownload(bytes, filename) {
    const blob = new Blob([bytes], { type: "application/pdf" })

    if (this._downloadBridge?.enabled) {
      this._downloadBridge.downloadBlob(blob, filename)
    } else {
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }
  }
}
