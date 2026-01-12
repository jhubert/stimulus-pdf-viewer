import { ColorPicker } from "./color_picker"
import { Icons } from "./icons"

export class AnnotationEditToolbar {
  constructor(options = {}) {
    this.onColorChange = options.onColorChange
    this.onDelete = options.onDelete
    this.onEdit = options.onEdit
    this.onComment = options.onComment
    this.onDeselect = options.onDeselect
    this.colors = options.colors || ColorPicker.COLORS.map(c => c.value)

    this.currentAnnotation = null
    this.element = null
    this.colorDropdownOpen = false

    this._createToolbar()
    this._setupEventListeners()
  }

  _createToolbar() {
    this.element = document.createElement("div")
    this.element.className = "annotation-edit-toolbar hidden"
    this.element.innerHTML = `
      <div class="toolbar-buttons">
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
      </div>
      <div class="toolbar-annotation-content hidden"></div>
    `

    this.commentBtn = this.element.querySelector(".comment-btn")
    this.editBtn = this.element.querySelector(".edit-btn")
    this.annotationContent = this.element.querySelector(".toolbar-annotation-content")
  }

  _setupEventListeners() {
    // Color picker button
    const colorBtn = this.element.querySelector(".color-picker-btn")
    colorBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      this._toggleColorDropdown()
    })

    // Color options
    const colorOptions = this.element.querySelectorAll(".color-option")
    colorOptions.forEach(option => {
      option.addEventListener("click", (e) => {
        e.stopPropagation()
        const color = option.dataset.color
        this._selectColor(color)
      })
    })

    // Comment button (for highlight/underline/ink annotations)
    this.commentBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      if (this.currentAnnotation && this.onComment) {
        this.onComment(this.currentAnnotation)
      }
    })

    // Edit button (for notes)
    this.editBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      if (this.currentAnnotation && this.onEdit) {
        this.onEdit(this.currentAnnotation)
      }
    })

    // Delete button
    const deleteBtn = this.element.querySelector(".delete-btn")
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      if (this.currentAnnotation && this.onDelete) {
        this.onDelete(this.currentAnnotation)
      }
      this.hide()
    })

    // Close color dropdown on outside click
    document.addEventListener("click", (e) => {
      if (this.colorDropdownOpen && !this.element.contains(e.target)) {
        this._closeColorDropdown()
      }
    })

    // Handle keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      if (this.element.classList.contains("hidden")) return

      // Don't intercept if user is typing
      const activeEl = document.activeElement
      if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) return

      if (e.key === "Escape") {
        if (this.colorDropdownOpen) {
          this._closeColorDropdown()
        } else {
          this.hide()
          this.onDeselect?.()
        }
        e.preventDefault()
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault()
        if (this.currentAnnotation && this.onDelete) {
          this.onDelete(this.currentAnnotation)
        }
        this.hide()
      } else if (e.key === "e" || e.key === "E") {
        // Edit shortcut for notes
        if (this.currentAnnotation?.annotation_type === "note" && this.onEdit) {
          e.preventDefault()
          this.onEdit(this.currentAnnotation)
        }
      } else if (e.key === "c" || e.key === "C") {
        // Comment shortcut for highlight/underline/ink annotations
        const supportsComment = ["highlight", "line", "ink"].includes(this.currentAnnotation?.annotation_type)
        if (supportsComment && this.onComment) {
          e.preventDefault()
          this.onComment(this.currentAnnotation)
        }
      }
    })
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
    // Update the swatch in the button
    const swatch = this.element.querySelector(".color-picker-btn .color-swatch")
    swatch.style.backgroundColor = color

    // Update aria-selected states
    const options = this.element.querySelectorAll(".color-option")
    options.forEach(option => {
      option.setAttribute("aria-selected", option.dataset.color === color ? "true" : "false")
    })
  }

  show(annotation, parentElement, pageHeight = null) {
    this.currentAnnotation = annotation

    // Update color swatch to match annotation's current color
    const color = annotation.color || ColorPicker.DEFAULT_HIGHLIGHT_COLOR
    this._updateSelectedColor(color)

    // Show/hide buttons based on annotation type
    const isNote = annotation.annotation_type === "note"
    const supportsComment = ["highlight", "line", "ink"].includes(annotation.annotation_type)

    // Comment button for highlight/underline/ink, edit button for notes
    this.commentBtn.classList.toggle("hidden", !supportsComment)
    this.editBtn.classList.toggle("hidden", !isNote)

    // Update comment button title based on whether contents exists
    if (supportsComment) {
      const hasComment = annotation.contents && annotation.contents.trim()
      this.commentBtn.title = hasComment ? "Edit Comment (C)" : "Add Comment (C)"
    }

    // Show contents for any annotation type that has it
    if (annotation.contents) {
      this.annotationContent.textContent = annotation.contents
      this.annotationContent.classList.remove("hidden")
    } else {
      this.annotationContent.classList.add("hidden")
    }

    // Determine if toolbar should flip above the annotation
    // Check if annotation bottom + toolbar height (~50px) would exceed page
    const toolbarHeight = 50
    const annotationBottom = annotation.rect[1] + annotation.rect[3]
    const shouldFlip = pageHeight && (annotationBottom + toolbarHeight > pageHeight)

    this.element.classList.toggle("flipped", shouldFlip)

    // Append to the annotation element so it moves/scales with it
    parentElement.appendChild(this.element)
    this.element.classList.remove("hidden")
  }

  hide() {
    this._closeColorDropdown()
    this.element.classList.add("hidden")
    this.currentAnnotation = null

    // Clear annotation content
    this.annotationContent.textContent = ""
    this.annotationContent.classList.add("hidden")

    // Remove from parent when hidden
    if (this.element.parentNode) {
      this.element.parentNode.removeChild(this.element)
    }
  }

  isVisible() {
    return !this.element.classList.contains("hidden")
  }

  destroy() {
    this.element.remove()
  }
}
