import { ThumbnailView, ThumbnailRenderingState } from "./thumbnail_view"
import { ViewerEvents } from "../core/event_bus"
import { Icons } from "./icons"

/**
 * ThumbnailSidebar - Toggle-able sidebar with browsable page thumbnails
 *
 * Features:
 * - Lazy loading of thumbnails (only renders visible thumbnails)
 * - Click to navigate to page
 * - Current page highlighting
 * - Resizable sidebar
 * - Collapse/expand toggle
 */

const SIDEBAR_DEFAULT_WIDTH = 200
const SIDEBAR_MIN_WIDTH = 150
const SIDEBAR_MAX_WIDTH = 400

export class ThumbnailSidebar {
  constructor({ container, viewer, eventBus, onPageClick }) {
    this.container = container
    this.viewer = viewer
    this.eventBus = eventBus
    this.onPageClick = onPageClick
    this.eventTarget = container // Use container for dispatching error events

    this.thumbnails = []
    this.pdfDocument = null
    this.currentPage = 1
    this.isOpen = false
    this.sidebarWidth = SIDEBAR_DEFAULT_WIDTH

    this._createElements()
    this._setupEventListeners()
  }

  _createElements() {
    // Main sidebar element
    this.element = document.createElement("div")
    this.element.className = "pdf-sidebar is-left pdf-thumbnail-sidebar"
    this.element.style.setProperty("--sidebar-width", `${this.sidebarWidth}px`)

    // Sidebar header with title and close button
    this.header = document.createElement("div")
    this.header.className = "pdf-sidebar-header"
    this.header.innerHTML = `
      <span class="pdf-sidebar-title">Pages</span>
      <button class="pdf-sidebar-close" type="button" aria-label="Close sidebar">
        ${Icons.close}
      </button>
    `

    // Scrollable thumbnails container
    this.thumbnailContainer = document.createElement("div")
    this.thumbnailContainer.className = "pdf-sidebar-content"

    // Resize handle
    this.resizer = document.createElement("div")
    this.resizer.className = "pdf-sidebar-resizer"

    // Assemble sidebar
    this.element.appendChild(this.header)
    this.element.appendChild(this.thumbnailContainer)
    this.element.appendChild(this.resizer)

    // Insert sidebar at beginning of container (before pages container)
    this.container.insertBefore(this.element, this.container.firstChild)
  }

  _setupEventListeners() {
    // Close button in header
    const closeBtn = this.header.querySelector(".pdf-sidebar-close")
    closeBtn.addEventListener("click", () => this.close())

    // Thumbnail scroll - lazy load thumbnails
    this.thumbnailContainer.addEventListener("scroll", () => {
      this._renderVisibleThumbnails()
    })

    // Sidebar resizing
    this._setupResizer()

    // Listen for page changes from the viewer
    this.eventBus.on(ViewerEvents.PAGE_CHANGING, ({ pageNumber }) => {
      this._onPageChange(pageNumber)
    })

    // Listen for scroll events to update current page indicator
    this.eventBus.on(ViewerEvents.SCROLL, () => {
      const currentPage = this.viewer.getCurrentPage()
      if (currentPage !== this.currentPage) {
        this._onPageChange(currentPage)
      }
    })

    // Keyboard navigation within sidebar
    this.thumbnailContainer.addEventListener("keydown", (e) => {
      this._handleKeydown(e)
    })
  }

  _setupResizer() {
    let startX, startWidth

    const onMouseMove = (e) => {
      const delta = e.clientX - startX
      const newWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, startWidth + delta))
      this.sidebarWidth = newWidth
      this.element.style.setProperty("--sidebar-width", `${newWidth}px`)
    }

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
      this.element.classList.remove("resizing")
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }

    this.resizer.addEventListener("mousedown", (e) => {
      e.preventDefault()
      startX = e.clientX
      startWidth = this.sidebarWidth
      this.element.classList.add("resizing")
      document.body.style.cursor = "ew-resize"
      document.body.style.userSelect = "none"
      document.addEventListener("mousemove", onMouseMove)
      document.addEventListener("mouseup", onMouseUp)
    })
  }

  _handleKeydown(e) {
    const focusedThumbnail = document.activeElement?.closest(".thumbnail")
    if (!focusedThumbnail) return

    const currentIndex = parseInt(focusedThumbnail.dataset.pageNumber, 10) - 1

    switch (e.key) {
      case "ArrowUp":
        e.preventDefault()
        if (currentIndex > 0) {
          this.thumbnails[currentIndex - 1].div.focus()
        }
        break
      case "ArrowDown":
        e.preventDefault()
        if (currentIndex < this.thumbnails.length - 1) {
          this.thumbnails[currentIndex + 1].div.focus()
        }
        break
      case "Home":
        e.preventDefault()
        this.thumbnails[0]?.div.focus()
        break
      case "End":
        e.preventDefault()
        this.thumbnails[this.thumbnails.length - 1]?.div.focus()
        break
    }
  }

  /**
   * Initialize thumbnails for the loaded PDF document
   */
  async setDocument(pdfDocument) {
    // Clear existing thumbnails
    this.thumbnailContainer.innerHTML = ""
    this.thumbnails = []
    this.pdfDocument = pdfDocument

    if (!pdfDocument) return

    const numPages = pdfDocument.numPages

    // Get first page for default viewport
    const firstPage = await pdfDocument.getPage(1)
    const defaultViewport = firstPage.getViewport({ scale: 1 })

    // Create thumbnail views for all pages
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const thumbnail = new ThumbnailView({
        container: this.thumbnailContainer,
        pageNumber: pageNum,
        defaultViewport: defaultViewport,
        onClick: (page) => this._onThumbnailClick(page)
      })
      this.thumbnails.push(thumbnail)
    }

    // Set the first page's pdfPage immediately
    this.thumbnails[0]?.setPdfPage(firstPage)
    this.thumbnails[0]?.setActive(true)

    // Render visible thumbnails if sidebar is open
    if (this.isOpen) {
      this._renderVisibleThumbnails()
    }
  }

  _onThumbnailClick(pageNumber) {
    if (this.onPageClick) {
      this.onPageClick(pageNumber)
    }
    this._onPageChange(pageNumber)
  }

  _onPageChange(pageNumber) {
    if (pageNumber === this.currentPage) return

    // Update active state
    const prevThumbnail = this.thumbnails[this.currentPage - 1]
    const newThumbnail = this.thumbnails[pageNumber - 1]

    if (prevThumbnail) {
      prevThumbnail.setActive(false)
    }
    if (newThumbnail) {
      newThumbnail.setActive(true)
      // Scroll thumbnail into view if sidebar is open
      if (this.isOpen) {
        newThumbnail.scrollIntoView()
      }
    }

    this.currentPage = pageNumber
  }

  /**
   * Render thumbnails that are currently visible in the scroll container
   */
  _renderVisibleThumbnails() {
    if (!this.isOpen || this.thumbnails.length === 0) return

    const containerRect = this.thumbnailContainer.getBoundingClientRect()
    const scrollTop = this.thumbnailContainer.scrollTop
    const containerHeight = this.thumbnailContainer.clientHeight

    // Buffer to render thumbnails slightly before they become visible
    const buffer = 100

    for (const thumbnail of this.thumbnails) {
      const thumbRect = thumbnail.div.getBoundingClientRect()
      const relativeTop = thumbRect.top - containerRect.top

      // Check if thumbnail is visible (with buffer)
      const isVisible = (
        relativeTop + thumbRect.height > -buffer &&
        relativeTop < containerHeight + buffer
      )

      if (isVisible && thumbnail.renderingState === ThumbnailRenderingState.INITIAL) {
        // Load the PDF page if needed and render
        this._ensurePageAndRender(thumbnail)
      }
    }
  }

  async _ensurePageAndRender(thumbnail) {
    if (!this.pdfDocument) return

    // Get the PDF page if not already loaded
    if (!thumbnail.pdfPage) {
      try {
        const pdfPage = await this.pdfDocument.getPage(thumbnail.pageNumber)
        thumbnail.setPdfPage(pdfPage)
      } catch (error) {
        console.error(`Error loading page ${thumbnail.pageNumber}:`, error)
        this._dispatchError(`Failed to load page ${thumbnail.pageNumber}`, error)
        return
      }
    }

    thumbnail.draw()
  }

  /**
   * Dispatch an error event for UI feedback and logging.
   */
  _dispatchError(message, originalError) {
    if (this.eventTarget) {
      this.eventTarget.dispatchEvent(new CustomEvent("pdf-viewer:error", {
        bubbles: true,
        detail: {
          source: "thumbnail_sidebar",
          errorType: "page_load_failed",
          message,
          error: originalError
        }
      }))
    }
  }

  /**
   * Open the sidebar
   */
  open() {
    this.isOpen = true
    this.element.classList.add("open")
    this.container.classList.add("sidebar-open")

    // Render visible thumbnails
    requestAnimationFrame(() => {
      this._renderVisibleThumbnails()
      // Scroll current page into view
      const currentThumbnail = this.thumbnails[this.currentPage - 1]
      if (currentThumbnail) {
        currentThumbnail.scrollIntoView()
      }
    })
  }

  /**
   * Close the sidebar
   */
  close() {
    this.isOpen = false
    this.element.classList.remove("open")
    this.container.classList.remove("sidebar-open")
  }

  /**
   * Toggle the sidebar
   */
  toggle() {
    if (this.isOpen) {
      this.close()
    } else {
      this.open()
    }
  }

  /**
   * Clean up
   */
  destroy() {
    for (const thumbnail of this.thumbnails) {
      thumbnail.destroy()
    }
    this.thumbnails = []
    this.element.remove()
  }
}
