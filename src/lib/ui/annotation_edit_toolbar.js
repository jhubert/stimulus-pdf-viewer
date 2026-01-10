import { ColorPicker } from "./color_picker"
import { Icons } from "./icons"

export class AnnotationEditToolbar {
  constructor(options = {}) {
    this.onColorChange = options.onColorChange
    this.onDelete = options.onDelete
    this.onEdit = options.onEdit
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
      <div class="toolbar-note-content hidden"></div>
    `

    this.editBtn = this.element.querySelector(".edit-btn")
    this.noteContent = this.element.querySelector(".toolbar-note-content")
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

    // Edit button
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

    // Show/hide edit button and note content based on annotation type
    const isNote = annotation.annotation_type === "note"
    this.editBtn.classList.toggle("hidden", !isNote)

    if (isNote && annotation.contents) {
      this.noteContent.textContent = annotation.contents
      this.noteContent.classList.remove("hidden")
    } else {
      this.noteContent.classList.add("hidden")
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

    // Clear note content
    this.noteContent.textContent = ""
    this.noteContent.classList.add("hidden")

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
