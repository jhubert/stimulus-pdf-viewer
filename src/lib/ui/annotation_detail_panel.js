import { ColorPicker } from "./color_picker"
import { Icons } from "./icons"

export class AnnotationDetailPanel {
  constructor(options = {}) {
    this.container = options.container
    this.onColorChange = options.onColorChange
    this.onDelete = options.onDelete
    this.onEdit = options.onEdit
    this.onComment = options.onComment
    this.onClose = options.onClose
    this.colors = options.colors || ColorPicker.COLORS.map(c => c.value)

    this.currentAnnotation = null
    this.anchorElement = null
    this.colorDropdownOpen = false

    this._createPanel()
    this._setupEventListeners()
  }

  _createPanel() {
    this.element = document.createElement("div")
    this.element.className = "annotation-detail-panel hidden"
    this.element.innerHTML = `
      <div class="annotation-detail-header">
        <div class="annotation-detail-header-info">
          <span class="annotation-detail-type"></span>
        </div>
        <div class="annotation-detail-header-actions">
          <button class="toolbar-btn comment-btn hidden" title="Add Comment (C)">
            ${Icons.comment}
          </button>
          <button class="color-picker-btn" title="Change color" aria-haspopup="true" aria-expanded="false">
            <span class="color-swatch"></span>
            ${Icons.chevronDown}
          </button>
          <div class="color-dropdown hidden">
            ${this.colors.map(color => `
              <button class="color-option" data-color="${color}" aria-selected="false">
                <span class="color-swatch" style="background-color: ${color}"></span>
              </button>
            `).join("")}
          </div>
          <button class="toolbar-btn edit-btn hidden" title="Edit (E)">
            ${Icons.edit}
          </button>
          <div class="toolbar-divider"></div>
          <button class="toolbar-btn delete-btn" title="Delete (Delete)">
            ${Icons.delete}
          </button>
          <div class="toolbar-divider"></div>
          <button class="annotation-detail-close" title="Close (Escape)">
            ${Icons.close}
          </button>
        </div>
      </div>
      <div class="annotation-detail-body">
        <div class="annotation-detail-text hidden"></div>
        <div class="annotation-detail-content-slot"></div>
      </div>
    `

    this.commentBtn = this.element.querySelector(".comment-btn")
    this.editBtn = this.element.querySelector(".edit-btn")
    this.typeLabel = this.element.querySelector(".annotation-detail-type")
    this.textContent = this.element.querySelector(".annotation-detail-text")
    this.contentSlot = this.element.querySelector(".annotation-detail-content-slot")
  }

  _setupEventListeners() {
    // Prevent pointer/click events inside the panel from triggering annotation tools
    // Tools listen on pointerdown on the pages container, so we must stop all phases
    this.element.addEventListener("pointerdown", (e) => {
      e.stopPropagation()
    })
    this.element.addEventListener("click", (e) => {
      e.stopPropagation()
    })

    // Close button
    this.element.querySelector(".annotation-detail-close").addEventListener("click", (e) => {
      e.stopPropagation()
      this.onClose?.()
    })

    // Color picker button
    const colorBtn = this.element.querySelector(".color-picker-btn")
    colorBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      this._toggleColorDropdown()
    })

    // Color options
    this.element.querySelectorAll(".color-option").forEach(option => {
      option.addEventListener("click", (e) => {
        e.stopPropagation()
        this._selectColor(option.dataset.color)
      })
    })

    // Comment button
    this.commentBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      if (this.currentAnnotation && this.onComment) {
        this.onComment(this.currentAnnotation)
      }
    })

    // Edit button
    this.editBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      if (this.currentAnnotation && this.onEdit) {
        this.onEdit(this.currentAnnotation)
      }
    })

    // Delete button (hide is handled by _deselectAnnotation cascade)
    this.element.querySelector(".delete-btn").addEventListener("click", (e) => {
      e.stopPropagation()
      if (this.currentAnnotation && this.onDelete) {
        this.onDelete(this.currentAnnotation)
      }
    })

    // Close color dropdown on outside click
    document.addEventListener("click", (e) => {
      if (this.colorDropdownOpen && !this.element.contains(e.target)) {
        this._closeColorDropdown()
      }
    })

    // Keyboard shortcuts
    this._keydownHandler = (e) => {
      if (this.element.classList.contains("hidden")) return

      const activeEl = document.activeElement
      if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable)) return

      if (e.key === "Escape") {
        if (this.colorDropdownOpen) {
          this._closeColorDropdown()
        } else {
          this.onClose?.()
        }
        e.preventDefault()
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault()
        if (this.currentAnnotation && this.onDelete) {
          this.onDelete(this.currentAnnotation)
        }
      } else if (e.key === "e" || e.key === "E") {
        if (this.currentAnnotation?.annotation_type === "note" && this.onEdit) {
          e.preventDefault()
          this.onEdit(this.currentAnnotation)
        }
      } else if (e.key === "c" || e.key === "C") {
        const supportsComment = ["highlight", "line", "ink"].includes(this.currentAnnotation?.annotation_type)
        if (supportsComment && this.onComment) {
          e.preventDefault()
          this.onComment(this.currentAnnotation)
        }
      }
    }
    document.addEventListener("keydown", this._keydownHandler)
  }

  _toggleColorDropdown() {
    if (this.colorDropdownOpen) {
      this._closeColorDropdown()
    } else {
      this._openColorDropdown()
    }
  }

  _openColorDropdown() {
    const dropdown = this.element.querySelector(".color-dropdown")
    const btn = this.element.querySelector(".color-picker-btn")
    dropdown.classList.remove("hidden")
    btn.setAttribute("aria-expanded", "true")
    this.colorDropdownOpen = true
  }

  _closeColorDropdown() {
    const dropdown = this.element.querySelector(".color-dropdown")
    const btn = this.element.querySelector(".color-picker-btn")
    dropdown.classList.add("hidden")
    btn.setAttribute("aria-expanded", "false")
    this.colorDropdownOpen = false
  }

  _selectColor(color) {
    if (this.currentAnnotation && this.onColorChange) {
      this.onColorChange(this.currentAnnotation, color)
    }
    this._updateSelectedColor(color)
    this._closeColorDropdown()
  }

  _updateSelectedColor(color) {
    const swatch = this.element.querySelector(".color-picker-btn .color-swatch")
    swatch.style.backgroundColor = color

    this.element.querySelectorAll(".color-option").forEach(option => {
      option.setAttribute("aria-selected", option.dataset.color === color ? "true" : "false")
    })
  }

  _getTypeLabel(annotationType) {
    const labels = {
      highlight: "Highlight",
      line: "Underline",
      note: "Note",
      ink: "Drawing"
    }
    return labels[annotationType] || "Annotation"
  }

  show(annotation, anchorElement, options = {}) {
    this.currentAnnotation = annotation
    this.anchorElement = anchorElement

    // Update header info
    const page = annotation.page || 1
    this.typeLabel.textContent = `${this._getTypeLabel(annotation.annotation_type)} \u2014 Page ${page}`

    // Update color swatch
    const color = annotation.color || ColorPicker.DEFAULT_HIGHLIGHT_COLOR
    this._updateSelectedColor(color)

    // Show/hide buttons based on annotation type
    const isNote = annotation.annotation_type === "note"
    const supportsComment = ["highlight", "line", "ink"].includes(annotation.annotation_type)
    this.commentBtn.classList.toggle("hidden", !supportsComment)
    this.editBtn.classList.toggle("hidden", !isNote)

    if (supportsComment) {
      const hasComment = annotation.contents && annotation.contents.trim()
      this.commentBtn.title = hasComment ? "Edit Comment (C)" : "Add Comment (C)"
    }

    // Show annotation text content if present
    if (annotation.contents) {
      this.textContent.textContent = annotation.contents
      this.textContent.classList.remove("hidden")
    } else {
      this.textContent.textContent = ""
      this.textContent.classList.add("hidden")
    }

    // Inject custom content if provided (HTML string or DOM element)
    if (options.content) {
      if (typeof options.content === "string") {
        this.contentSlot.innerHTML = options.content
      } else {
        this.contentSlot.innerHTML = ""
        this.contentSlot.appendChild(options.content)
      }
    }

    // Position and show the panel
    this._positionPanel(anchorElement)
    this.element.classList.remove("hidden")
  }

  _positionPanel(anchorElement) {
    const pageContainer = anchorElement.closest(".pdf-page")
    if (!pageContainer) return

    // Append to page container so it scrolls with the page
    pageContainer.appendChild(this.element)

    // Get annotation position relative to the page
    const anchorRect = anchorElement.getBoundingClientRect()
    const pageRect = pageContainer.getBoundingClientRect()

    const anchorTop = anchorRect.top - pageRect.top
    const anchorLeft = anchorRect.left - pageRect.left
    const anchorRight = anchorLeft + anchorRect.width
    const pageWidth = pageRect.width

    const panelWidth = parseInt(
      getComputedStyle(this.element).getPropertyValue("--panel-width") || "320", 10
    )

    // Try to position to the right of the annotation
    if (anchorRight + panelWidth + 12 <= pageWidth) {
      this.element.style.left = `${anchorRight + 8}px`
      this.element.style.right = "auto"
    }
    // Fall back to the left side
    else if (anchorLeft - panelWidth - 12 >= 0) {
      this.element.style.left = `${anchorLeft - panelWidth - 8}px`
      this.element.style.right = "auto"
    }
    // Fall back to below the annotation (centered)
    else {
      const centerX = anchorLeft + anchorRect.width / 2
      this.element.style.left = `${Math.max(8, centerX - panelWidth / 2)}px`
      this.element.style.right = "auto"
    }

    // Vertical alignment: align top of panel with top of annotation
    this.element.style.top = `${anchorTop}px`
  }

  hide() {
    this._closeColorDropdown()
    this.element.classList.add("hidden")
    this.currentAnnotation = null
    this.anchorElement = null

    // Clear text content
    this.textContent.textContent = ""
    this.textContent.classList.add("hidden")

    // Clear injected content (but preserve the slot container)
    this.contentSlot.innerHTML = ""

    // Remove from parent when hidden
    if (this.element.parentNode) {
      this.element.parentNode.removeChild(this.element)
    }
  }

  isVisible() {
    return !this.element.classList.contains("hidden")
  }

  getContentContainer() {
    return this.contentSlot
  }

  destroy() {
    if (this._keydownHandler) {
      document.removeEventListener("keydown", this._keydownHandler)
    }
    this.element.remove()
  }
}
