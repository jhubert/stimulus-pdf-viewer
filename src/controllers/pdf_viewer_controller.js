import { Controller } from "@hotwired/stimulus"
import { PdfViewer, ToolMode } from "../lib"
import { ScaleValue } from "../lib/core"

// Connects to data-controller="pdf-viewer"
export default class extends Controller {
  static targets = ["container", "zoomSelect", "pageInput", "pageCount", "prevBtn", "nextBtn", "colorPicker", "loadingOverlay", "overflowBtn", "overflowMenu", "overflowColorPicker", "overflowPageNum", "overflowPageCount"]
  static values = {
    documentUrl: String,
    documentName: String,
    organizationName: String,
    userName: String,
    annotationsUrl: String,
    documentId: String,
    trackingUrl: String,
    initialPage: Number,
    initialAnnotation: String,
    autoHeight: { type: Boolean, default: true }
  }

  initialize() {
    this.resizeObserver = new ResizeObserver(() => this.setViewportHeight())
    this.pdfViewer = null
  }

  async connect() {
    this.resizeObserver.observe(this.containerTarget)

    // Create the PDF viewer instance
    this.pdfViewer = new PdfViewer(this.containerTarget, {
      documentUrl: this.documentUrlValue,
      documentName: this.documentNameValue,
      organizationName: this.organizationNameValue,
      annotationsUrl: this.annotationsUrlValue,
      trackingUrl: this.trackingUrlValue,
      userName: this.userNameValue,
      documentId: this.documentIdValue,
      initialPage: this.initialPageValue || 1,
      initialAnnotation: this.initialAnnotationValue,
      onCopy: (e) => this._dispatchClipboardEvent("copy", e),
      onCut: (e) => this._dispatchClipboardEvent("cut", e)
    })

    // Set up the toolbar
    this._setupToolbar()

    // Listen for error events from the PDF viewer
    this._setupErrorListener()

    // Load the PDF
    try {
      await this.pdfViewer.load()
    } catch (error) {
      console.error("Failed to load PDF:", error)
      this._showError("Failed to load PDF document")
    }
  }

  _setupErrorListener() {
    this._errorHandler = (e) => {
      const { message } = e.detail
      this._showError(message, false)
    }
    this.containerTarget.addEventListener("pdf-viewer:user-error", this._errorHandler)
  }

  disconnect() {
    this.resizeObserver.unobserve(this.containerTarget)

    if (this._keydownHandler) {
      document.removeEventListener("keydown", this._keydownHandler)
    }

    if (this._errorHandler) {
      this.containerTarget.removeEventListener("pdf-viewer:user-error", this._errorHandler)
    }

    if (this._readyHandler) {
      this.containerTarget.removeEventListener("pdf-viewer:ready", this._readyHandler)
    }

    if (this._pageChangedHandler) {
      this.containerTarget.removeEventListener("pdf-viewer:page-changed", this._pageChangedHandler)
    }

    if (this._overflowMenuClickOutsideHandler) {
      document.removeEventListener("click", this._overflowMenuClickOutsideHandler)
    }

    if (this.pdfViewer) {
      this.pdfViewer.destroy()
      this.pdfViewer = null
    }
  }

  _setupToolbar() {
    const toolbar = this.containerTarget.querySelector(".pdf-viewer-toolbar")
    if (!toolbar) return

    // Append color picker to existing container
    const colorPickerContainer = toolbar.querySelector(".pdf-toolbar-colors")
    if (colorPickerContainer && this.pdfViewer.colorPicker) {
      colorPickerContainer.appendChild(this.pdfViewer.colorPicker.element)
    }

    // Append color picker clone to overflow menu
    if (this.hasOverflowColorPickerTarget && this.pdfViewer.colorPicker) {
      this._setupOverflowColorPicker()
    }

    // Append find bar below toolbar
    if (this.pdfViewer.findBar) {
      toolbar.after(this.pdfViewer.findBar.element)
    }

    // Set up keyboard shortcuts for zoom and search
    this._setupKeyboardShortcuts()

    // Listen for page changes to update the page input
    this._setupPageNavigationListeners()
  }

  _setupOverflowColorPicker() {
    // Import the static COLORS from the ColorPicker class
    const colorPicker = this.pdfViewer.colorPicker
    if (!colorPicker) return

    const container = this.overflowColorPickerTarget

    // Get colors from the main color picker's dropdown buttons
    const mainColors = colorPicker.element.querySelectorAll(".color-picker-option")

    mainColors.forEach(mainBtn => {
      const colorValue = mainBtn.dataset.color
      const btn = document.createElement("button")
      btn.type = "button"
      btn.className = "color-picker-option"
      btn.dataset.color = colorValue
      btn.innerHTML = `<span class="color-picker-swatch" style="background-color: ${colorValue}"></span>`

      // Sync with main color picker's current selection
      if (colorValue === colorPicker.currentColor) {
        btn.classList.add("selected")
      }

      btn.addEventListener("click", () => {
        // Update main color picker
        colorPicker.setColor(colorValue)
        // Update selection UI in overflow menu
        container.querySelectorAll(".color-picker-option").forEach(b => {
          b.classList.toggle("selected", b.dataset.color === colorValue)
        })
      })

      container.appendChild(btn)
    })

    // Store original onChange to chain our sync handler
    const originalOnChange = colorPicker.onChange
    colorPicker.onChange = (color) => {
      // Call original handler
      if (originalOnChange) originalOnChange(color)
      // Sync overflow menu
      container.querySelectorAll(".color-picker-option").forEach(btn => {
        btn.classList.toggle("selected", btn.dataset.color === color)
      })
    }
  }

  _setupKeyboardShortcuts() {
    this._keydownHandler = (e) => {
      // Ctrl+F / Cmd+F for search (always handle, even in inputs within our container)
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        // Only handle if the event is within our container or globally when not in another input
        if (this.containerTarget.contains(e.target) || e.target.tagName !== "INPUT") {
          e.preventDefault()
          this.toggleSearch()
          return
        }
      }

      // Only handle zoom shortcuts if not in an input/textarea
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return

      if ((e.ctrlKey || e.metaKey) && (e.key === "+" || e.key === "=")) {
        e.preventDefault()
        this.zoomIn()
      } else if ((e.ctrlKey || e.metaKey) && e.key === "-") {
        e.preventDefault()
        this.zoomOut()
      } else if ((e.ctrlKey || e.metaKey) && e.key === "0") {
        e.preventDefault()
        this._setZoomLevel(1)
      }
    }
    document.addEventListener("keydown", this._keydownHandler)
  }

  toggleSearch() {
    this._closeOverflowMenu()
    this.pdfViewer?.toggleFindBar()
  }

  toggleSidebar() {
    this._closeOverflowMenu()
    this.pdfViewer?.thumbnailSidebar?.toggle()
  }

  toggleAnnotationSidebar() {
    this._closeOverflowMenu()
    this.pdfViewer?.annotationSidebar?.toggle()
  }

  selectTool(event) {
    const button = event.currentTarget
    const toolName = button.dataset.tool
    this._activateTool(toolName)
  }

  selectToolFromOverflow(event) {
    const button = event.currentTarget
    const toolName = button.dataset.tool
    this._activateTool(toolName)
    // Close the overflow menu after selecting a tool
    this._closeOverflowMenu()
  }

  _activateTool(toolName) {
    // Tool map for name -> mode conversion
    const toolMap = {
      select: ToolMode.SELECT,
      highlight: ToolMode.HIGHLIGHT,
      underline: ToolMode.UNDERLINE,
      note: ToolMode.NOTE,
      ink: ToolMode.INK
    }

    // Toggle behavior: if clicking the already-active tool, switch back to Select
    // (except for Select itself, which should stay selected)
    const currentMode = this.pdfViewer?.currentMode
    const clickedMode = toolMap[toolName]
    const targetTool = (clickedMode === currentMode && toolName !== "select")
      ? "select"
      : toolName

    // Update active state on main toolbar tool buttons
    this.containerTarget.querySelectorAll(".pdf-tool-btn[data-tool]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.tool === targetTool)
    })

    // Update active state on overflow menu tool buttons
    this.containerTarget.querySelectorAll(".pdf-overflow-tool-btn[data-tool]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.tool === targetTool)
    })

    // Set the tool
    if (toolMap[targetTool]) {
      this.pdfViewer.setTool(toolMap[targetTool])
    }
  }

  toggleOverflowMenu(event) {
    if (!this.hasOverflowMenuTarget || !this.hasOverflowBtnTarget) return

    const isOpen = this.overflowMenuTarget.classList.toggle("open")
    this.overflowBtnTarget.classList.toggle("active", isOpen)

    if (isOpen) {
      // Position the menu below the button
      const btnRect = this.overflowBtnTarget.getBoundingClientRect()
      this.overflowMenuTarget.style.top = `${btnRect.bottom + 4}px`
      this.overflowMenuTarget.style.right = `${window.innerWidth - btnRect.right}px`

      // Close menu when clicking outside
      this._overflowMenuClickOutsideHandler = (e) => {
        if (!this.overflowMenuTarget.contains(e.target) && !this.overflowBtnTarget.contains(e.target)) {
          this._closeOverflowMenu()
        }
      }
      // Delay to prevent immediate close from the current click
      setTimeout(() => {
        document.addEventListener("click", this._overflowMenuClickOutsideHandler)
      }, 0)
    } else {
      this._closeOverflowMenu()
    }
  }

  _closeOverflowMenu() {
    if (this.hasOverflowMenuTarget) {
      this.overflowMenuTarget.classList.remove("open")
    }
    if (this.hasOverflowBtnTarget) {
      this.overflowBtnTarget.classList.remove("active")
    }
    if (this._overflowMenuClickOutsideHandler) {
      document.removeEventListener("click", this._overflowMenuClickOutsideHandler)
      this._overflowMenuClickOutsideHandler = null
    }
  }

  async download() {
    this._closeOverflowMenu()
    try {
      await this.pdfViewer.download()
    } catch (error) {
      console.error("Failed to download:", error)
      this._showError("Failed to download PDF")
    }
  }

  // Zoom controls
  zoomIn() {
    const currentScale = this.pdfViewer.getScale()
    const zoomLevels = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]
    // Find next zoom level greater than current scale (with small tolerance for floating point)
    const nextLevel = zoomLevels.find(level => level > currentScale + 0.001) || zoomLevels[zoomLevels.length - 1]
    this._setZoomLevel(nextLevel)
  }

  zoomOut() {
    const currentScale = this.pdfViewer.getScale()
    const zoomLevels = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]
    // Find previous zoom level less than current scale (with small tolerance for floating point)
    const prevLevel = [...zoomLevels].reverse().find(level => level < currentScale - 0.001) || zoomLevels[0]
    this._setZoomLevel(prevLevel)
  }

  setZoom(event) {
    const value = event.target.value
    // Handle preset string values
    if (["auto", "page-width", "page-fit", "page-actual"].includes(value)) {
      this._setZoomPreset(value)
    } else {
      this._setZoomLevel(parseFloat(value))
    }
  }

  _setZoomPreset(preset) {
    // Map our preset names to ScaleValue constants
    const presetMap = {
      "auto": ScaleValue.AUTO,
      "page-width": ScaleValue.PAGE_WIDTH,
      "page-fit": ScaleValue.PAGE_FIT,
      "page-actual": 1.0  // Actual size is just 100%
    }

    const scaleValue = presetMap[preset]
    this.pdfViewer.viewer.setScale(scaleValue)

    // Store the current preset mode (for dropdown selection)
    this._currentScalePreset = preset
  }

  _setZoomLevel(scale) {
    this.pdfViewer.viewer.setScale(scale)
    // Clear any preset mode since we're using a specific numeric scale
    this._currentScalePreset = null
    // Update the dropdown to reflect the current zoom
    this._updateZoomSelect(scale)
  }

  _updateZoomSelect(scale) {
    if (!this.hasZoomSelectTarget) return

    // Try to find a matching option value
    const scaleStr = String(scale)
    const options = Array.from(this.zoomSelectTarget.options)
    const matchingOption = options.find(opt => opt.value === scaleStr)

    if (matchingOption) {
      this.zoomSelectTarget.value = scaleStr
    }
    // If no match, leave the current selection (preset modes will show their label)
  }

  // Page navigation
  previousPage() {
    const currentPage = this.pdfViewer.getCurrentPage()
    if (currentPage > 1) {
      this.pdfViewer.goToPage(currentPage - 1)
    }
  }

  nextPage() {
    const currentPage = this.pdfViewer.getCurrentPage()
    const pageCount = this.pdfViewer.getPageCount()
    if (currentPage < pageCount) {
      this.pdfViewer.goToPage(currentPage + 1)
    }
  }

  goToPage(event) {
    const pageNumber = parseInt(event.target.value, 10)
    const pageCount = this.pdfViewer.getPageCount()
    if (pageNumber >= 1 && pageNumber <= pageCount) {
      this.pdfViewer.goToPage(pageNumber)
    } else {
      // Reset to current page if invalid
      event.target.value = this.pdfViewer.getCurrentPage()
    }
  }

  handlePageInputKey(event) {
    if (event.key === "Enter") {
      event.target.blur()
      this.goToPage(event)
    }
  }

  _setupPageNavigationListeners() {
    // Listen for ready event from PdfViewer
    this._readyHandler = (e) => {
      const { pageCount, currentPage } = e.detail
      this._onViewerReady(pageCount, currentPage)
    }
    this.containerTarget.addEventListener("pdf-viewer:ready", this._readyHandler)

    // Listen for page change events from PdfViewer
    this._pageChangedHandler = (e) => {
      const { currentPage, pageCount } = e.detail
      this._onPageChanged(currentPage, pageCount)
    }
    this.containerTarget.addEventListener("pdf-viewer:page-changed", this._pageChangedHandler)
  }

  _onViewerReady(pageCount, currentPage) {
    // Hide the loading overlay
    if (this.hasLoadingOverlayTarget) {
      this.loadingOverlayTarget.classList.add("hidden")
    }

    if (this.hasPageCountTarget) {
      this.pageCountTarget.textContent = pageCount
    }
    if (this.hasPageInputTarget) {
      this.pageInputTarget.max = pageCount
      this.pageInputTarget.value = currentPage
    }
    // Update overflow menu page display
    if (this.hasOverflowPageCountTarget) {
      this.overflowPageCountTarget.textContent = pageCount
    }
    if (this.hasOverflowPageNumTarget) {
      this.overflowPageNumTarget.textContent = currentPage
    }
    this._updateNavigationButtons()

    // Set initial zoom to "auto" which fits the page width for portrait documents
    this._setZoomPreset("auto")
  }

  _onPageChanged(currentPage, pageCount) {
    if (this.hasPageInputTarget && document.activeElement !== this.pageInputTarget) {
      this.pageInputTarget.value = currentPage
    }
    if (this.hasPageCountTarget) {
      this.pageCountTarget.textContent = pageCount
    }
    // Update overflow menu page display
    if (this.hasOverflowPageNumTarget) {
      this.overflowPageNumTarget.textContent = currentPage
    }
    if (this.hasOverflowPageCountTarget) {
      this.overflowPageCountTarget.textContent = pageCount
    }
    this._updateNavigationButtons()
  }

  _updateNavigationButtons() {
    if (!this.pdfViewer?.viewer) return

    const currentPage = this.pdfViewer.getCurrentPage()
    const pageCount = this.pdfViewer.getPageCount()

    if (this.hasPrevBtnTarget) {
      this.prevBtnTarget.disabled = currentPage <= 1
    }
    if (this.hasNextBtnTarget) {
      this.nextBtnTarget.disabled = currentPage >= pageCount
    }
  }

  setViewportHeight() {
    requestAnimationFrame(() => {
      // Skip if autoHeight is disabled (container height managed by consuming application)
      if (!this.autoHeightValue) {
        return
      }

      const rect = this.containerTarget.getBoundingClientRect()
      this.containerTarget.style.position = "relative"
      this.containerTarget.style.overflow = "hidden"
      this.containerTarget.style.height = `${window.innerHeight - rect.top}px`
    })
  }

  /**
   * Dispatch clipboard events (copy/cut) as custom events for Stimulus actions.
   * @param {string} type - "copy" or "cut"
   * @param {ClipboardEvent} event - The original clipboard event
   */
  _dispatchClipboardEvent(type, event) {
    this.containerTarget.dispatchEvent(new CustomEvent(`pdf-viewer:${type}`, {
      bubbles: true,
      detail: { originalEvent: event }
    }))
  }

  /**
   * Show an error message to the user.
   * @param {string} message - The error message
   * @param {boolean} persistent - If true, shows permanent error overlay. If false, shows auto-dismissing toast.
   */
  _showError(message, persistent = true) {
    if (persistent) {
      const errorDiv = document.createElement("div")
      errorDiv.className = "pdf-viewer-error"
      errorDiv.textContent = message
      this.containerTarget.appendChild(errorDiv)
    } else {
      const toast = document.createElement("div")
      toast.className = "pdf-viewer-toast"
      toast.textContent = message

      const body = this.containerTarget.querySelector(".pdf-viewer-body")
      if (body) {
        body.parentNode.insertBefore(toast, body)
      } else {
        this.containerTarget.appendChild(toast)
      }

      requestAnimationFrame(() => {
        toast.classList.add("visible")
      })

      setTimeout(() => {
        toast.classList.remove("visible")
        setTimeout(() => toast.remove(), 300)
      }, 4000)
    }
  }
}
