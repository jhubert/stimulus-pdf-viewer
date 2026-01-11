import { Icons } from "./icons"

/**
 * AnnotationSidebar - Right-side sidebar listing all annotations on the PDF
 *
 * Features:
 * - Lists all annotations with type icon, snippet/label, and metadata
 * - Sort by page number or timestamp (newest/oldest)
 * - Filter by annotation type
 * - Click to navigate and highlight annotation
 * - Real-time updates when annotations change
 * - Resizable and collapsible
 */

const SIDEBAR_DEFAULT_WIDTH = 280
const SIDEBAR_MIN_WIDTH = 200
const SIDEBAR_MAX_WIDTH = 450

const SortMode = {
  PAGE: "page",
  NEWEST: "newest",
  OLDEST: "oldest"
}

const FilterType = {
  ALL: "all",
  HIGHLIGHT: "highlight",
  NOTE: "note",
  DRAWING: "drawing",
  UNDERLINE: "underline"
}

// Icons for annotation types (SVG strings)
const ANNOTATION_ICONS = {
  highlight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <rect x="2" y="14" width="20" height="6" rx="1" fill="#FFEB3B" stroke="none" opacity="0.6"/>
    <line x1="4" y1="17" x2="20" y2="17"/>
  </svg>`,
  note: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" fill="#FFF9C4"/>
    <line x1="8" y1="9" x2="16" y2="9"/>
    <line x1="8" y1="13" x2="14" y2="13"/>
  </svg>`,
  ink: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
  </svg>`,
  line: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3"/>
    <line x1="4" y1="21" x2="20" y2="21" stroke-width="3"/>
  </svg>`
}

export class AnnotationSidebar {
  constructor({ element, itemTemplate, container, annotationManager, onAnnotationClick }) {
    this.annotationManager = annotationManager
    this.onAnnotationClick = onAnnotationClick
    this.itemTemplate = itemTemplate  // Optional <template> element for custom list items

    this.isOpen = false
    this.sidebarWidth = SIDEBAR_DEFAULT_WIDTH
    this.sortMode = SortMode.PAGE
    this.filterType = FilterType.ALL
    this.selectedAnnotationId = null

    if (element) {
      // User provided HTML - find elements via data attributes
      this.element = element
      this.container = element.parentElement
      this.listContainer = element.querySelector('[data-role="list"]')
      this.header = element.querySelector('.pdf-sidebar-header')
      this.emptyState = element.querySelector('[data-role="empty-state"]')
      this.sortControls = element.querySelector('[data-role="sort-controls"]')
      this.filterControls = element.querySelector('[data-role="filter-controls"]')
      this.resizer = element.querySelector('[data-role="resizer"]')

      // Read initial width from CSS variable if set
      const currentWidth = element.style.getPropertyValue('--sidebar-width')
      if (currentWidth) {
        this.sidebarWidth = parseInt(currentWidth, 10) || SIDEBAR_DEFAULT_WIDTH
      } else {
        element.style.setProperty('--sidebar-width', `${this.sidebarWidth}px`)
      }
    } else {
      // Fallback - create default HTML (existing behavior)
      this.container = container
      this._createElements()
    }

    this._setupEventListeners()
  }

  _createElements() {
    // Main sidebar element - positioned on the RIGHT
    this.element = document.createElement("div")
    this.element.className = "pdf-sidebar is-right pdf-annotation-sidebar"
    this.element.style.setProperty("--sidebar-width", `${this.sidebarWidth}px`)

    // Sidebar header with title, count badge, and controls
    this.header = document.createElement("div")
    this.header.className = "pdf-sidebar-header"
    this.header.innerHTML = `
      <div class="pdf-sidebar-header-left">
        <span class="pdf-sidebar-title">Annotations</span>
        <span class="annotation-count-badge">0</span>
      </div>
      <button class="pdf-sidebar-close" type="button" aria-label="Close sidebar">
        ${Icons.close}
      </button>
    `

    // Sort controls
    this.sortControls = document.createElement("div")
    this.sortControls.className = "annotation-sort-controls"
    this.sortControls.innerHTML = `
      <button class="sort-btn active" data-sort="${SortMode.PAGE}">Page</button>
      <button class="sort-btn" data-sort="${SortMode.NEWEST}">Newest</button>
      <button class="sort-btn" data-sort="${SortMode.OLDEST}">Oldest</button>
    `

    // Filter controls
    this.filterControls = document.createElement("div")
    this.filterControls.className = "annotation-filter-controls"
    this.filterControls.innerHTML = `
      <select class="annotation-filter-select">
        <option value="${FilterType.ALL}">All</option>
        <option value="${FilterType.HIGHLIGHT}">Highlights</option>
        <option value="${FilterType.NOTE}">Notes</option>
        <option value="${FilterType.DRAWING}">Drawings</option>
        <option value="${FilterType.UNDERLINE}">Underlines</option>
      </select>
    `

    // Scrollable list container
    this.listContainer = document.createElement("div")
    this.listContainer.className = "pdf-sidebar-content annotation-list"

    // Empty state
    this.emptyState = document.createElement("div")
    this.emptyState.className = "annotation-empty-state"
    this.emptyState.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M12 20h9"/>
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
      </svg>
      <p>No annotations yet</p>
      <p class="hint">Use the toolbar tools to add highlights, notes, or drawings</p>
    `

    // Resize handle (on the LEFT since this is a right sidebar)
    this.resizer = document.createElement("div")
    this.resizer.className = "pdf-sidebar-resizer"

    // Controls wrapper
    const controlsWrapper = document.createElement("div")
    controlsWrapper.className = "annotation-controls-wrapper"
    controlsWrapper.appendChild(this.sortControls)
    controlsWrapper.appendChild(this.filterControls)

    // Assemble sidebar
    this.element.appendChild(this.resizer)
    this.element.appendChild(this.header)
    this.element.appendChild(controlsWrapper)
    this.element.appendChild(this.listContainer)
    this.element.appendChild(this.emptyState)

    // Insert sidebar at the END of container (after pages container for right positioning)
    this.container.appendChild(this.element)
  }

  _setupEventListeners() {
    // Close button - support both user HTML (data-action="close") and auto-generated (.pdf-sidebar-close)
    const closeBtn = this.header?.querySelector('[data-action="close"]') ||
                     this.header?.querySelector(".pdf-sidebar-close")
    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.close())
    }

    // Sort buttons
    if (this.sortControls) {
      this.sortControls.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-sort]") || e.target.closest(".sort-btn")
        if (btn && btn.dataset.sort) {
          this.sortMode = btn.dataset.sort
          this.sortControls.querySelectorAll("[data-sort], .sort-btn").forEach(b => b.classList.remove("active"))
          btn.classList.add("active")
          this._refreshList()
        }
      })
    }

    // Filter select - support both user HTML (data-action="filter") and auto-generated (.annotation-filter-select)
    const filterSelect = this.filterControls?.querySelector('[data-action="filter"]') ||
                         this.filterControls?.querySelector(".annotation-filter-select")
    if (filterSelect) {
      filterSelect.addEventListener("change", (e) => {
        this.filterType = e.target.value
        this._refreshList()
      })
    }

    // Sidebar resizing
    this._setupResizer()

    // Keyboard navigation
    this.listContainer.addEventListener("keydown", (e) => {
      this._handleKeydown(e)
    })
  }

  _setupResizer() {
    if (!this.resizer) return

    let startX, startWidth

    const onMouseMove = (e) => {
      // For right sidebar, resizing from left edge: subtract delta
      const delta = startX - e.clientX
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
    const focused = document.activeElement?.closest(".annotation-list-item")
    if (!focused) return

    const items = Array.from(this.listContainer.querySelectorAll(".annotation-list-item"))
    const currentIndex = items.indexOf(focused)

    switch (e.key) {
      case "ArrowUp":
        e.preventDefault()
        if (currentIndex > 0) {
          items[currentIndex - 1].focus()
        }
        break
      case "ArrowDown":
        e.preventDefault()
        if (currentIndex < items.length - 1) {
          items[currentIndex + 1].focus()
        }
        break
      case "Enter":
      case " ":
        e.preventDefault()
        focused.click()
        break
      case "Home":
        e.preventDefault()
        items[0]?.focus()
        break
      case "End":
        e.preventDefault()
        items[items.length - 1]?.focus()
        break
    }
  }

  /**
   * Refresh the annotation list
   */
  _refreshList() {
    let annotations = this.annotationManager.getAllAnnotations()

    // Apply filter
    if (this.filterType !== FilterType.ALL) {
      annotations = annotations.filter(a => this._matchesFilter(a))
    }

    // Apply sort
    annotations = this._sortAnnotations(annotations)

    // Clear and rebuild list
    this.listContainer.innerHTML = ""

    // Update count badge - support both user HTML (data-role="count") and auto-generated
    const countBadge = this.header?.querySelector('[data-role="count"]') ||
                       this.header?.querySelector(".annotation-count-badge")
    if (countBadge) {
      countBadge.textContent = annotations.length
    }

    // Show empty state or list
    if (annotations.length === 0) {
      this.emptyState?.classList.add("visible")
      this.listContainer.classList.add("empty")
    } else {
      this.emptyState?.classList.remove("visible")
      this.listContainer.classList.remove("empty")

      for (const annotation of annotations) {
        const item = this._createListItem(annotation)
        this.listContainer.appendChild(item)
      }
    }
  }

  _matchesFilter(annotation) {
    const type = annotation.annotation_type

    switch (this.filterType) {
      case FilterType.HIGHLIGHT:
        return type === "highlight" || (type === "ink" && annotation.subject === "Free Highlight")
      case FilterType.NOTE:
        return type === "note"
      case FilterType.DRAWING:
        return type === "ink" && annotation.subject !== "Free Highlight"
      case FilterType.UNDERLINE:
        return type === "line"
      default:
        return true
    }
  }

  _sortAnnotations(annotations) {
    const sorted = [...annotations]

    switch (this.sortMode) {
      case SortMode.PAGE:
        sorted.sort((a, b) => {
          // Primary: page number
          if (a.page !== b.page) return a.page - b.page
          // Secondary: vertical position (top to bottom)
          const aY = this._getAnnotationY(a)
          const bY = this._getAnnotationY(b)
          return aY - bY
        })
        break
      case SortMode.NEWEST:
        sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        break
      case SortMode.OLDEST:
        sorted.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        break
    }

    return sorted
  }

  _getAnnotationY(annotation) {
    if (annotation.rect) {
      return annotation.rect[1]
    }
    if (annotation.quads && annotation.quads.length > 0) {
      return annotation.quads[0].p1.y
    }
    if (annotation.ink_strokes && annotation.ink_strokes.length > 0) {
      const firstStroke = annotation.ink_strokes[0]
      if (firstStroke.points && firstStroke.points.length > 0) {
        return firstStroke.points[0].y
      }
    }
    return 0
  }

  _createListItem(annotation) {
    let item

    if (this.itemTemplate) {
      // Clone user's template and populate data-field elements
      item = this.itemTemplate.content.firstElementChild.cloneNode(true)
      item.dataset.annotationId = annotation.id

      // Ensure tabIndex for keyboard navigation
      if (!item.hasAttribute("tabindex")) {
        item.tabIndex = 0
      }

      // Determine display values
      const { icon, label, typeLabel } = this._getAnnotationDisplay(annotation)
      const timestamp = this._formatTimestamp(annotation.created_at)

      // Populate data-field elements
      this._setField(item, "icon", icon, annotation.color)
      this._setField(item, "label", this._escapeHtml(label))
      this._setField(item, "type", typeLabel)
      this._setField(item, "page", `Page ${annotation.page}`)
      this._setField(item, "time", timestamp)

      // Also set data attributes for user's Stimulus controllers
      item.dataset.annotationType = annotation.annotation_type
      item.dataset.annotationPage = annotation.page
      item.dataset.annotationColor = annotation.color || ""
    } else {
      // Fallback - existing innerHTML approach
      item = document.createElement("div")
      item.className = "annotation-list-item"
      item.dataset.annotationId = annotation.id
      item.tabIndex = 0

      // Determine icon and label based on type
      const { icon, label, typeLabel } = this._getAnnotationDisplay(annotation)

      // Format timestamp
      const timestamp = this._formatTimestamp(annotation.created_at)

      item.innerHTML = `
        <div class="annotation-item-icon" style="color: ${annotation.color || '#666'}">
          ${icon}
        </div>
        <div class="annotation-item-content">
          <div class="annotation-item-label">${this._escapeHtml(label)}</div>
          <div class="annotation-item-meta">
            <span class="annotation-item-type">${typeLabel}</span>
            <span class="annotation-item-separator">•</span>
            <span class="annotation-item-page">Page ${annotation.page}</span>
            <span class="annotation-item-separator">•</span>
            <span class="annotation-item-time">${timestamp}</span>
          </div>
        </div>
        <div class="annotation-item-hover">
          <span>Jump</span>
          ${Icons.chevronRight}
        </div>
      `
    }

    // Selection state
    if (this.selectedAnnotationId === annotation.id) {
      item.classList.add("selected")
    }

    // Click handler
    item.addEventListener("click", () => {
      this._selectItem(annotation.id)
      if (this.onAnnotationClick) {
        this.onAnnotationClick(annotation.id)
      }
    })

    return item
  }

  /**
   * Set a field value in a template-cloned element
   * @param {HTMLElement} element - The cloned template element
   * @param {string} fieldName - The data-field name to find
   * @param {string} value - The value to set (can include HTML for icons)
   * @param {string} color - Optional color to apply
   */
  _setField(element, fieldName, value, color) {
    const field = element.querySelector(`[data-field="${fieldName}"]`)
    if (field) {
      field.innerHTML = value
      if (color && fieldName === "icon") {
        field.style.color = color
      }
    }
  }

  _getAnnotationDisplay(annotation) {
    const type = annotation.annotation_type
    let icon, label, typeLabel

    if (type === "highlight" || (type === "ink" && annotation.subject === "Free Highlight")) {
      icon = ANNOTATION_ICONS.highlight
      typeLabel = "Highlight"
      // Extract highlighted text if available
      label = annotation.title || annotation.contents || "Freehand Highlight"
      label = this._truncate(label, 80)
    } else if (type === "note") {
      icon = ANNOTATION_ICONS.note
      typeLabel = "Note"
      label = annotation.contents || "Empty note"
      label = this._truncate(label, 80)
    } else if (type === "ink") {
      icon = ANNOTATION_ICONS.ink
      typeLabel = "Drawing"
      label = "Ink drawing"
    } else if (type === "line") {
      icon = ANNOTATION_ICONS.line
      typeLabel = "Underline"
      label = annotation.title || "Underlined text"
      label = this._truncate(label, 80)
    } else {
      icon = ANNOTATION_ICONS.highlight
      typeLabel = type || "Annotation"
      label = annotation.contents || "Annotation"
    }

    return { icon, label, typeLabel }
  }

  _truncate(text, maxLength) {
    if (!text) return ""
    text = text.trim().replace(/\s+/g, " ")
    if (text.length <= maxLength) return text
    return text.substring(0, maxLength - 3) + "..."
  }

  _formatTimestamp(dateString) {
    if (!dateString) return ""

    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now - date
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) {
      // Today - show time
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    } else if (diffDays === 1) {
      return "Yesterday"
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: "short" })
    } else {
      return date.toLocaleDateString([], { month: "short", day: "numeric" })
    }
  }

  _escapeHtml(text) {
    const div = document.createElement("div")
    div.textContent = text
    return div.innerHTML
  }

  _selectItem(annotationId) {
    // Deselect previous
    const prev = this.listContainer.querySelector(".annotation-list-item.selected")
    if (prev) {
      prev.classList.remove("selected")
    }

    // Select new
    this.selectedAnnotationId = annotationId
    const item = this.listContainer.querySelector(`[data-annotation-id="${annotationId}"]`)
    if (item) {
      item.classList.add("selected")
    }
  }

  /**
   * Called when an annotation is created - refresh the list
   */
  onAnnotationCreated(annotation) {
    if (this.isOpen) {
      this._refreshList()
    }
  }

  /**
   * Called when an annotation is updated - refresh the list
   */
  onAnnotationUpdated(annotation) {
    if (this.isOpen) {
      this._refreshList()
    }
  }

  /**
   * Called when an annotation is deleted - refresh the list
   */
  onAnnotationDeleted(annotation) {
    if (this.isOpen) {
      // Clear selection if deleted annotation was selected
      if (this.selectedAnnotationId === annotation.id) {
        this.selectedAnnotationId = null
      }
      this._refreshList()
    }
  }

  /**
   * Select and scroll to an annotation in the list
   * @param {string} annotationId - The annotation ID to select
   * @param {Object} options - Options
   * @param {boolean} options.scroll - Whether to scroll the sidebar list (default: true)
   */
  selectAnnotation(annotationId, { scroll = true } = {}) {
    this._selectItem(annotationId)
    const item = this.listContainer.querySelector(`[data-annotation-id="${annotationId}"]`)
    if (item && this.isOpen && scroll) {
      item.scrollIntoView({ behavior: "smooth", block: "nearest" })
    }
  }

  /**
   * Open the sidebar
   */
  open() {
    this.isOpen = true
    this.element.classList.add("open")
    this.container.classList.add("annotation-sidebar-open")
    this._refreshList()
  }

  /**
   * Close the sidebar
   */
  close() {
    this.isOpen = false
    this.element.classList.remove("open")
    this.container.classList.remove("annotation-sidebar-open")
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
   * Get current annotation count
   */
  getCount() {
    return this.annotationManager.getAllAnnotations().length
  }

  /**
   * Clean up
   */
  destroy() {
    this.element.remove()
  }
}
