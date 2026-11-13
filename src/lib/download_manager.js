import { PDFDocument, rgb, degrees, StandardFonts, PDFName, PDFArray, PDFString, PDFHexString } from "pdf-lib"
import { FetchRequest } from "@rails/request.js"
import { AnnotationType, PDF_SUBTYPES, isFreeHighlight } from "./annotation_types"

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
    const existingPdfBytes = await this._fetchDocument()
    const pdfDoc = await PDFDocument.load(existingPdfBytes)

    // Set document metadata
    this._setDocumentMetadata(pdfDoc)

    // Get all annotations
    const annotations = this.annotationManager.getAllAnnotations()

    // Embed what the watermark is drawn with (a font, or an image of the name)
    const watermark = await this._prepareWatermark(pdfDoc)

    // Process each page
    const pages = pdfDoc.getPages()
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]
      const pageNumber = i + 1
      const geometry = this._pageGeometry(page)

      // Apply watermark
      this._applyWatermarkToPage(page, watermark, geometry)

      // Apply annotations for this page
      const pageAnnotations = annotations.filter(a => a.page === pageNumber)
      this._applyAnnotationsToPage(pdfDoc, page, pageAnnotations, geometry)
    }

    // Save and download
    const pdfBytes = await pdfDoc.save()
    const filename = this._sanitizeFilename(this.documentName || "document")
    this._triggerDownload(pdfBytes, filename)
  }

  // Download the original file untouched. Used for encrypted documents, which
  // pdf-lib can't open to embed annotations or the watermark.
  async downloadOriginal() {
    const pdfBytes = await this._fetchDocument()

    // The bytes are saved as they arrive, so make sure they are a PDF. An
    // expired session typically answers 200 with a login page, which would
    // otherwise be saved under the document's name.
    if (!this._looksLikePdf(pdfBytes)) {
      throw new Error("The server did not return a PDF")
    }

    const filename = this._sanitizeFilename(this.documentName || "document")
    this._triggerDownload(pdfBytes, filename)
  }

  // Fetch the original PDF using Rails request.js for consistent CSRF handling
  async _fetchDocument() {
    const request = new FetchRequest("get", this.documentUrl, { responseKind: "blob" })
    const response = await request.perform()
    if (!response.ok) {
      throw new Error(`Failed to fetch PDF (HTTP ${response.statusCode})`)
    }
    return response.response.arrayBuffer()
  }

  // The spec allows the %PDF- header anywhere in the first 1024 bytes
  _looksLikePdf(bytes) {
    const head = new Uint8Array(bytes).subarray(0, 1024)
    const marker = [0x25, 0x50, 0x44, 0x46, 0x2d] // %PDF-
    for (let i = 0; i <= head.length - marker.length; i++) {
      if (marker.every((byte, j) => head[i + j] === byte)) return true
    }
    return false
  }

  /**
   * How a page is displayed, and how to get from displayed coordinates back
   * to the PDF's own.
   *
   * Annotations are stored as the viewer shows the page: origin at the top
   * left of the visible (crop) box, after the page's /Rotate is applied. PDF
   * user space is unrotated with its origin at the bottom left, wherever the
   * media box puts it. For an upright page whose boxes start at 0,0 the two
   * differ only by a y flip; for a rotated or cropped page they do not, and
   * annotations written with only the flip land off the page.
   *
   * @returns {{width: number, height: number, rotation: number, toPdf: (x: number, y: number) => number[]}}
   *   `width`/`height` are the displayed size; `toPdf` maps a displayed point
   *   to user space.
   */
  _pageGeometry(page) {
    // PDF.js displays the crop box clipped to the media box
    const media = page.getMediaBox()
    const crop = page.getCropBox()
    let x0 = Math.max(crop.x, media.x)
    let y0 = Math.max(crop.y, media.y)
    let x1 = Math.min(crop.x + crop.width, media.x + media.width)
    let y1 = Math.min(crop.y + crop.height, media.y + media.height)
    if (x1 <= x0 || y1 <= y0) {
      x0 = media.x
      y0 = media.y
      x1 = media.x + media.width
      y1 = media.y + media.height
    }

    const rotation = ((page.getRotation().angle % 360) + 360) % 360
    const sideways = rotation === 90 || rotation === 270

    const toPdf = (x, y) => {
      switch (rotation) {
        case 90: return [x0 + y, y0 + x]
        case 180: return [x1 - x, y0 + y]
        case 270: return [x1 - y, y1 - x]
        default: return [x0 + x, y1 - y]
      }
    }

    return {
      width: sideways ? y1 - y0 : x1 - x0,
      height: sideways ? x1 - x0 : y1 - y0,
      rotation,
      toPdf
    }
  }

  /**
   * Decide how the watermark will be drawn, once per download.
   *
   * The standard Helvetica font only covers WinAnsi (roughly Latin-1), and
   * pdf-lib throws on anything else, which used to fail the whole download
   * for a reader named "Łukasz" or "山田". Such names are drawn by the browser
   * onto a canvas and embedded as an image instead. Where no canvas is
   * available the characters Helvetica lacks are dropped, so the download
   * still succeeds.
   *
   * @returns {Promise<{font: Object, text: string}|{image: Object, descent: number}|null>}
   */
  async _prepareWatermark(pdfDoc) {
    if (!this.userName) return null

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    if (this._canEncode(font, this.userName)) {
      return { font, text: this.userName }
    }

    const rendered = this._renderTextPng(this.userName)
    if (rendered) {
      try {
        return { image: await pdfDoc.embedPng(rendered.png), descent: rendered.descent }
      } catch (error) {
        console.warn("[DownloadManager] Could not embed the watermark image:", error)
      }
    }

    const text = Array.from(this.userName).filter(char => this._canEncode(font, char)).join("").trim()
    if (!text) {
      console.warn("[DownloadManager] Watermark omitted: the user name cannot be drawn")
      return null
    }
    return { font, text }
  }

  _canEncode(font, text) {
    try {
      font.encodeText(text)
      return true
    } catch {
      return false
    }
  }

  /**
   * Draw text to a PNG with the browser's own fonts, which cover scripts the
   * PDF standard fonts do not.
   * @returns {{png: string, descent: number}|null} A PNG data URI, and the
   *   share of the image height that sits below the text baseline. null when
   *   the canvas can't produce one.
   */
  _renderTextPng(text) {
    try {
      const fontPx = 96
      const font = `${fontPx}px sans-serif`
      const descent = 0.25
      const canvas = document.createElement("canvas")
      const context = canvas.getContext("2d")
      if (!context?.measureText) return null

      context.font = font
      const width = Math.ceil(context.measureText(text).width)
      if (!width) return null

      // Sizing a canvas resets its context, so the font is set again
      canvas.width = width
      canvas.height = Math.ceil(fontPx / (1 - descent))
      context.font = font
      context.fillStyle = "#000"
      context.textBaseline = "alphabetic"
      context.fillText(text, 0, fontPx)

      const png = canvas.toDataURL("image/png")
      return png.startsWith("data:image/png") ? { png, descent } : null
    } catch {
      return null
    }
  }

  _applyWatermarkToPage(page, watermark, geometry) {
    if (!watermark) return

    // Positions are given as the page is displayed and angles are offset by
    // the page's rotation, so the watermark reads the same on a rotated page
    const { width, height, rotation, toPdf } = geometry
    const draw = ({ x, y, size, opacity, angle, centered = false }) => {
      const rotate = degrees(angle + rotation)

      if (watermark.image) {
        // Scale the image so its text matches `size`, and sit it so the
        // text's baseline is at y
        const imageHeight = size / (1 - watermark.descent)
        const imageWidth = imageHeight * (watermark.image.width / watermark.image.height)
        const left = centered ? (width - imageWidth) / 2 : x
        const [pdfX, pdfY] = toPdf(left, y + imageHeight * watermark.descent)
        page.drawImage(watermark.image, { x: pdfX, y: pdfY, width: imageWidth, height: imageHeight, opacity, rotate })
      } else {
        const left = centered ? (width - watermark.font.widthOfTextAtSize(watermark.text, size)) / 2 : x
        const [pdfX, pdfY] = toPdf(left, y)
        page.drawText(watermark.text, { x: pdfX, y: pdfY, size, font: watermark.font, color: rgb(0, 0, 0), opacity, rotate })
      }
    }

    // Diagonal watermark
    draw({ x: width / 2 - 50, y: height / 2, size: 25, opacity: 0.07, angle: -45 })

    // Header watermark
    draw({ y: 10, size: 6, opacity: 0.10, angle: 0, centered: true })
  }

  _applyAnnotationsToPage(pdfDoc, page, annotations, geometry) {
    for (const annotation of annotations) {
      switch (annotation.annotation_type) {
        case AnnotationType.HIGHLIGHT:
          this._applyHighlight(pdfDoc, page, annotation, geometry)
          break
        case AnnotationType.UNDERLINE:
          this._applyUnderline(pdfDoc, page, annotation, geometry)
          break
        case AnnotationType.INK:
          this._applyInk(pdfDoc, page, annotation, geometry)
          break
        case AnnotationType.NOTE:
          this._applyNote(pdfDoc, page, annotation, geometry)
          break
      }
    }
  }

  _applyHighlight(pdfDoc, page, annotation, geometry) {
    const { quads, color } = annotation
    if (!quads || quads.length === 0) return

    const rgba = this._parseColor(color)

    // Build QuadPoints array - PDF format is [x1,y1,x2,y2,x3,y3,x4,y4] for each quad
    // Order: bottom-left, bottom-right, top-right, top-left (counter-clockwise from bottom-left)
    const quadPoints = []
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

    for (const quad of quads) {
      // Convert from displayed coordinates to PDF user space
      const points = [
        ...geometry.toPdf(quad.p3.x, quad.p3.y), // bottom-left
        ...geometry.toPdf(quad.p4.x, quad.p4.y), // bottom-right
        ...geometry.toPdf(quad.p2.x, quad.p2.y), // top-right
        ...geometry.toPdf(quad.p1.x, quad.p1.y), // top-left
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
      Subtype: PDFName.of(PDF_SUBTYPES[AnnotationType.HIGHLIGHT]),
      Rect: [minX, minY, maxX, maxY],
      QuadPoints: quadPoints,
      C: [rgba.r, rgba.g, rgba.b],
      CA: 0.4,
      F: 4,
      ...this._getAnnotationMetadata(annotation),
    })

    this._addAnnotationToPage(pdfDoc, page, annotationDict)
  }

  _applyUnderline(pdfDoc, page, annotation, geometry) {
    const { quads, color } = annotation
    if (!quads || quads.length === 0) return

    const rgba = this._parseColor(color)

    // Build QuadPoints array - same format as highlight
    const quadPoints = []
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

    for (const quad of quads) {
      const points = [
        ...geometry.toPdf(quad.p3.x, quad.p3.y),
        ...geometry.toPdf(quad.p4.x, quad.p4.y),
        ...geometry.toPdf(quad.p2.x, quad.p2.y),
        ...geometry.toPdf(quad.p1.x, quad.p1.y),
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
      Subtype: PDFName.of(PDF_SUBTYPES[AnnotationType.UNDERLINE]),
      Rect: [minX, minY, maxX, maxY],
      QuadPoints: quadPoints,
      C: [rgba.r, rgba.g, rgba.b],
      F: 4,
      ...this._getAnnotationMetadata(annotation),
    })

    this._addAnnotationToPage(pdfDoc, page, annotationDict)
  }

  _applyInk(pdfDoc, page, annotation, geometry) {
    // Freehand highlights need different rendering (thick, semi-transparent strokes)
    if (isFreeHighlight(annotation)) {
      this._applyFreehandHighlight(pdfDoc, page, annotation, geometry)
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
        const [pdfX, pdfY] = geometry.toPdf(point.x, point.y)
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
      Subtype: PDFName.of(PDF_SUBTYPES[AnnotationType.INK]),
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

  _applyFreehandHighlight(pdfDoc, page, annotation, geometry) {
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
        const [pdfX, pdfY] = geometry.toPdf(point.x, point.y)
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
      Subtype: PDFName.of(PDF_SUBTYPES[AnnotationType.INK]),
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

  _applyNote(pdfDoc, page, annotation, geometry) {
    const { rect, contents, color } = annotation
    if (!rect || !contents) return

    const rgba = this._parseColor(color)
    const [x, y] = rect
    const iconSize = 24

    // The icon's box as displayed, converted corner by corner so it stays a
    // well-formed Rect whichever way the page is rotated
    const [ax, ay] = geometry.toPdf(x, y)
    const [bx, by] = geometry.toPdf(x + iconSize, y + iconSize)

    const annotationDict = pdfDoc.context.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of(PDF_SUBTYPES[AnnotationType.NOTE]),
      Rect: [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)],
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

    // Author (T = title/author in PDF spec). fromText encodes as UTF-16BE
    // when needed; PDFString.of only covers PDFDocEncoding and mangles curly
    // quotes, dashes, and names outside Latin-1.
    if (this.userName) {
      metadata.T = PDFHexString.fromText(this.userName)
    }

    // Contents - a note's body, or the comment on any other annotation type
    if (annotation.contents) {
      metadata.Contents = PDFHexString.fromText(annotation.contents)
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

    // Check for emptiness before appending the extension. A name made only of
    // illegal characters is empty at this point, and appending first would
    // produce a hidden ".pdf" file instead of falling back.
    if (!sanitized) return "document.pdf"

    // Ensure it ends with .pdf
    if (!sanitized.toLowerCase().endsWith(".pdf")) {
      sanitized += ".pdf"
    }

    return sanitized
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
