/**
 * ThumbnailView - Renders a single page thumbnail
 *
 * Inspired by PDF.js PDFThumbnailView but simplified for our use case.
 * Renders thumbnails at a fixed width with lazy loading support.
 */

const THUMBNAIL_WIDTH = 150 // Fixed thumbnail width in pixels
const RENDER_QUALITY = 2 // Canvas scale factor for crisp thumbnails

export const ThumbnailRenderingState = {
  INITIAL: 0,
  RUNNING: 1,
  FINISHED: 2
}

export class ThumbnailView {
  constructor({ container, pageNumber, defaultViewport, onClick }) {
    this.pageNumber = pageNumber
    this.pdfPage = null
    this.viewport = defaultViewport
    this.renderingState = ThumbnailRenderingState.INITIAL
    this.renderTask = null
    this.onClick = onClick

    // Calculate dimensions based on viewport aspect ratio
    const ratio = defaultViewport.width / defaultViewport.height
    this.canvasWidth = THUMBNAIL_WIDTH
    this.canvasHeight = Math.round(THUMBNAIL_WIDTH / ratio)

    // Create DOM elements
    this._createElements(container)
  }

  _createElements(container) {
    // Thumbnail container
    this.div = document.createElement("div")
    this.div.className = "thumbnail"
    this.div.dataset.pageNumber = this.pageNumber

    // Page number label
    const label = document.createElement("span")
    label.className = "thumbnail-label"
    label.textContent = this.pageNumber

    // Image placeholder (will be replaced with canvas/img)
    this.image = document.createElement("div")
    this.image.className = "thumbnail-image"
    this.image.style.width = `${this.canvasWidth}px`
    this.image.style.height = `${this.canvasHeight}px`

    // Click handler
    this.div.addEventListener("click", () => {
      if (this.onClick) {
        this.onClick(this.pageNumber)
      }
    })

    // Keyboard accessibility
    this.div.tabIndex = 0
    this.div.role = "button"
    this.div.setAttribute("aria-label", `Page ${this.pageNumber}`)
    this.div.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        if (this.onClick) {
          this.onClick(this.pageNumber)
        }
      }
    })

    this.div.appendChild(this.image)
    this.div.appendChild(label)
    container.appendChild(this.div)
  }

  /**
   * Set the PDF page and update dimensions
   */
  setPdfPage(pdfPage) {
    this.pdfPage = pdfPage
    const viewport = pdfPage.getViewport({ scale: 1 })
    this.viewport = viewport

    // Recalculate dimensions
    const ratio = viewport.width / viewport.height
    this.canvasHeight = Math.round(THUMBNAIL_WIDTH / ratio)
    this.image.style.height = `${this.canvasHeight}px`
  }

  /**
   * Render the thumbnail
   */
  async draw() {
    if (this.renderingState !== ThumbnailRenderingState.INITIAL) {
      return
    }

    if (!this.pdfPage) {
      return
    }

    this.renderingState = ThumbnailRenderingState.RUNNING

    try {
      // Calculate scale to fit thumbnail width
      const scale = THUMBNAIL_WIDTH / this.viewport.width
      const viewport = this.pdfPage.getViewport({ scale })

      // Create canvas
      const canvas = document.createElement("canvas")
      canvas.className = "thumbnail-canvas"
      canvas.width = Math.round(viewport.width * RENDER_QUALITY)
      canvas.height = Math.round(viewport.height * RENDER_QUALITY)
      canvas.style.width = `${Math.round(viewport.width)}px`
      canvas.style.height = `${Math.round(viewport.height)}px`

      const ctx = canvas.getContext("2d")
      ctx.scale(RENDER_QUALITY, RENDER_QUALITY)

      // Render the page
      this.renderTask = this.pdfPage.render({
        canvasContext: ctx,
        viewport: viewport
      })

      await this.renderTask.promise

      // Replace placeholder with canvas
      this.image.innerHTML = ""
      this.image.appendChild(canvas)
      this.image.style.height = "auto"

      this.renderingState = ThumbnailRenderingState.FINISHED
      this.renderTask = null
    } catch (error) {
      if (error.name === "RenderingCancelledException") {
        this.renderingState = ThumbnailRenderingState.INITIAL
      } else {
        console.error(`Error rendering thumbnail ${this.pageNumber}:`, error)
        this.renderingState = ThumbnailRenderingState.INITIAL
      }
      this.renderTask = null
    }
  }

  /**
   * Cancel any in-progress rendering
   */
  cancelRendering() {
    if (this.renderTask) {
      this.renderTask.cancel()
      this.renderTask = null
    }
  }

  /**
   * Reset to initial state
   */
  reset() {
    this.cancelRendering()
    this.renderingState = ThumbnailRenderingState.INITIAL
    this.image.innerHTML = ""
    this.image.style.height = `${this.canvasHeight}px`
  }

  /**
   * Mark as current page
   */
  setActive(isActive) {
    if (isActive) {
      this.div.classList.add("active")
      this.div.setAttribute("aria-current", "page")
    } else {
      this.div.classList.remove("active")
      this.div.removeAttribute("aria-current")
    }
  }

  /**
   * Scroll this thumbnail into view
   */
  scrollIntoView() {
    this.div.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    })
  }

  /**
   * Clean up
   */
  destroy() {
    this.cancelRendering()
    this.div.remove()
  }
}
