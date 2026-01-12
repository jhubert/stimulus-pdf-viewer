import { Icons } from "./icons"

export class AnnotationPopup {
  constructor(options = {}) {
    this.onEdit = options.onEdit
    this.onDelete = options.onDelete

    this.currentAnnotation = null
    this.element = null
    this._triggerElement = null // Element that triggered the popup (for focus restoration)

    // Bound handlers for document event listeners (needed for cleanup)
    this._boundClickHandler = this._handleOutsideClick.bind(this)
    this._boundKeydownHandler = this._handleKeydown.bind(this)
    this._boundMouseMoveHandler = null
    this._boundMouseUpHandler = null

    this._createPopup()
    this._setupEventListeners()
  }

  _createPopup() {
    this.element = document.createElement("div")
    this.element.className = "annotation-popup hidden"
    this.element.innerHTML = `
      <div class="annotation-popup-header">
        <span class="annotation-popup-date"></span>
        <div class="annotation-popup-actions">
          <button class="annotation-popup-btn annotation-popup-edit" title="Edit">
            ${Icons.edit}
          </button>
          <button class="annotation-popup-btn annotation-popup-delete" title="Delete">
            ${Icons.delete}
          </button>
        </div>
      </div>
      <div class="annotation-popup-content"></div>
    `

    document.body.appendChild(this.element)
  }

  _setupEventListeners() {
    // Edit button
    this.element.querySelector(".annotation-popup-edit").addEventListener("click", (e) => {
      e.stopPropagation()
      if (this.currentAnnotation && this.onEdit) {
        this.onEdit(this.currentAnnotation)
      }
      this.hide()
    })

    // Delete button
    this.element.querySelector(".annotation-popup-delete").addEventListener("click", (e) => {
      e.stopPropagation()
      if (this.currentAnnotation && this.onDelete) {
        this.onDelete(this.currentAnnotation)
      }
      this.hide()
    })

    // Close on outside click
    document.addEventListener("click", this._boundClickHandler)

    // Close on escape, delete on Delete/Backspace
    document.addEventListener("keydown", this._boundKeydownHandler)

    // Make popup draggable
    this._setupDraggable()
  }

  _handleOutsideClick(e) {
    if (!this.element.contains(e.target) && !this.element.classList.contains("hidden")) {
      this.hide()
    }
  }

  _handleKeydown(e) {
    if (this.element.classList.contains("hidden")) return

    // Don't intercept if user is typing in an input/textarea
    const activeEl = document.activeElement
    if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) return

    if (e.key === "Escape") {
      this.hide()
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault()
      if (this.currentAnnotation && this.onDelete) {
        this.onDelete(this.currentAnnotation)
      }
      this.hide()
    }
  }

  _setupDraggable() {
    const header = this.element.querySelector(".annotation-popup-header")
    let isDragging = false
    let startX, startY, startLeft, startTop

    // Store bound handlers for cleanup
    this._boundMouseMoveHandler = (e) => {
      if (!isDragging) return

      const dx = e.clientX - startX
      const dy = e.clientY - startY

      this.element.style.left = `${startLeft + dx}px`
      this.element.style.top = `${startTop + dy}px`
    }

    this._boundMouseUpHandler = () => {
      isDragging = false
    }

    header.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON") return

      isDragging = true
      startX = e.clientX
      startY = e.clientY
      const rect = this.element.getBoundingClientRect()
      startLeft = rect.left
      startTop = rect.top

      e.preventDefault()
    })

    document.addEventListener("mousemove", this._boundMouseMoveHandler)
    document.addEventListener("mouseup", this._boundMouseUpHandler)
  }

  show(annotation, targetRect, triggerElement = null) {
    this.currentAnnotation = annotation
    // Store trigger element for focus restoration on close
    this._triggerElement = triggerElement || document.activeElement

    // Update content
    const dateElement = this.element.querySelector(".annotation-popup-date")
    const contentElement = this.element.querySelector(".annotation-popup-content")

    const date = new Date(annotation.created_at)
    dateElement.textContent = date.toLocaleDateString()

    // Show content based on annotation type
    // Notes: show contents
    // Other types: show title (highlighted text) and/or contents (comment)
    const isNote = annotation.annotation_type === "note"
    const hasTitle = annotation.title && annotation.title.trim()
    const hasContents = annotation.contents && annotation.contents.trim()

    if (isNote && hasContents) {
      contentElement.textContent = annotation.contents
      contentElement.classList.remove("hidden")
    } else if (hasTitle || hasContents) {
      // Build content with title and/or comment
      let content = ""
      if (hasTitle) {
        content = annotation.title
      }
      if (hasContents) {
        // Add comment on a new line if there's also a title
        content += hasTitle ? `\n\nComment: ${annotation.contents}` : annotation.contents
      }
      contentElement.textContent = content
      contentElement.classList.remove("hidden")
    } else {
      contentElement.classList.add("hidden")
    }

    // Set background color based on annotation color
    if (annotation.color) {
      this.element.style.backgroundColor = annotation.color
      this.element.style.borderColor = annotation.color
    } else {
      this.element.style.backgroundColor = ""
      this.element.style.borderColor = ""
    }

    // Position popup near the annotation (viewport coordinates for fixed positioning)
    const popupWidth = 250
    const popupHeight = 100
    const margin = 10

    let left = targetRect.right + margin
    let top = targetRect.top

    // Adjust if off screen
    if (left + popupWidth > window.innerWidth) {
      left = targetRect.left - popupWidth - margin
    }
    if (top + popupHeight > window.innerHeight) {
      top = window.innerHeight - popupHeight - margin
    }
    if (top < 0) {
      top = margin
    }

    this.element.style.left = `${left}px`
    this.element.style.top = `${top}px`
    this.element.classList.remove("hidden")
  }

  hide() {
    this.element.classList.add("hidden")
    this.currentAnnotation = null

    // Restore focus to trigger element for keyboard accessibility
    if (this._triggerElement && typeof this._triggerElement.focus === "function") {
      // Use setTimeout to ensure focus happens after the hide completes
      setTimeout(() => {
        this._triggerElement?.focus({ preventScroll: true })
        this._triggerElement = null
      }, 0)
    }
  }

  destroy() {
    // Remove document event listeners to prevent memory leaks
    document.removeEventListener("click", this._boundClickHandler)
    document.removeEventListener("keydown", this._boundKeydownHandler)
    if (this._boundMouseMoveHandler) {
      document.removeEventListener("mousemove", this._boundMouseMoveHandler)
    }
    if (this._boundMouseUpHandler) {
      document.removeEventListener("mouseup", this._boundMouseUpHandler)
    }

    this.element.remove()
  }
}
