import { Icons } from "./icons"

export class ColorPicker {
  static COLORS = [
    { name: "Orange", value: "#FFA500" },
    { name: "Yellow", value: "#FFFF00" },
    { name: "Green", value: "#00FF00" },
    { name: "Blue", value: "#00BFFF" },
    { name: "Pink", value: "#FF69B4" }
  ]

  // Default colors for different tool modes
  static DEFAULT_HIGHLIGHT_COLOR = "#FFA500" // Orange
  static DEFAULT_INK_COLOR = "#00BFFF" // Blue

  constructor(options = {}) {
    this.onChange = options.onChange
    this.currentColor = ColorPicker.DEFAULT_HIGHLIGHT_COLOR
    this.isOpen = false

    this._createUI()
    this._setupEventListeners()
  }

  _createUI() {
    this.element = document.createElement("div")
    this.element.className = "color-picker"
    this.element.innerHTML = `
      <button class="color-picker-toggle" aria-label="Select color" aria-expanded="false">
        <span class="color-picker-swatch" style="background-color: ${this.currentColor}"></span>
        ${Icons.chevronDown}
      </button>
      <div class="color-picker-dropdown hidden">
        ${ColorPicker.COLORS.map(color => `
          <button class="color-picker-option ${color.value === this.currentColor ? 'selected' : ''}"
                  data-color="${color.value}"
                  aria-label="${color.name}"
                  title="${color.name}">
            <span class="color-picker-swatch" style="background-color: ${color.value}"></span>
          </button>
        `).join("")}
      </div>
    `
  }

  /**
   * Render the color picker into a container.
   */
  render(container) {
    container.appendChild(this.element)
  }

  _setupEventListeners() {
    const toggle = this.element.querySelector(".color-picker-toggle")
    const dropdown = this.element.querySelector(".color-picker-dropdown")
    const options = this.element.querySelectorAll(".color-picker-option")

    // Toggle dropdown
    toggle.addEventListener("click", (e) => {
      e.stopPropagation()
      this.isOpen = !this.isOpen
      dropdown.classList.toggle("hidden", !this.isOpen)
      toggle.setAttribute("aria-expanded", this.isOpen)
    })

    // Color selection
    options.forEach(option => {
      option.addEventListener("click", (e) => {
        e.stopPropagation()
        const color = option.dataset.color
        this.setColor(color)
        this._closeDropdown()
      })
    })

    // Close on outside click
    document.addEventListener("click", () => {
      if (this.isOpen) {
        this._closeDropdown()
      }
    })
  }

  _closeDropdown() {
    this.isOpen = false
    const dropdown = this.element.querySelector(".color-picker-dropdown")
    const toggle = this.element.querySelector(".color-picker-toggle")
    dropdown.classList.add("hidden")
    toggle.setAttribute("aria-expanded", "false")
  }

  setColor(color) {
    this.currentColor = color

    // Update toggle swatch
    const toggleSwatch = this.element.querySelector(".color-picker-toggle .color-picker-swatch")
    toggleSwatch.style.backgroundColor = color

    // Update selected state
    const options = this.element.querySelectorAll(".color-picker-option")
    options.forEach(option => {
      option.classList.toggle("selected", option.dataset.color === color)
    })

    // Notify listeners
    if (this.onChange) {
      this.onChange(color)
    }
  }

  getColor() {
    return this.currentColor
  }
}
