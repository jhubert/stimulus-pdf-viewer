import { describe, it, expect, vi, beforeEach } from "vitest"
import { ColorPicker } from "../../../src/lib/ui/color_picker.js"

describe("ColorPicker", () => {
  let picker, container, onChange

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    onChange = vi.fn()
    picker = new ColorPicker({ onChange })
    picker.render(container)
  })

  const toggle = () => container.querySelector(".color-picker-toggle")
  const dropdown = () => container.querySelector(".color-picker-dropdown")
  const options = () => Array.from(container.querySelectorAll(".color-picker-option"))

  describe("rendering", () => {
    it("renders a swatch button per palette color", () => {
      expect(options()).toHaveLength(ColorPicker.COLORS.length)
    })

    it("labels each option for screen readers", () => {
      for (const [i, option] of options().entries()) {
        expect(option.getAttribute("aria-label")).toBe(ColorPicker.COLORS[i].name)
      }
    })

    it("starts closed with the dropdown hidden", () => {
      expect(picker.isOpen).toBe(false)
      expect(dropdown().classList.contains("hidden")).toBe(true)
      expect(toggle().getAttribute("aria-expanded")).toBe("false")
    })

    it("defaults to the highlight color", () => {
      expect(picker.getColor()).toBe(ColorPicker.DEFAULT_HIGHLIGHT_COLOR)
    })

    it("marks the current color as selected", () => {
      const selected = options().filter(o => o.classList.contains("selected"))

      expect(selected).toHaveLength(1)
      expect(selected[0].dataset.color).toBe(ColorPicker.DEFAULT_HIGHLIGHT_COLOR)
    })
  })

  describe("opening and closing", () => {
    it("opens on toggle click", () => {
      toggle().click()

      expect(picker.isOpen).toBe(true)
      expect(dropdown().classList.contains("hidden")).toBe(false)
      expect(toggle().getAttribute("aria-expanded")).toBe("true")
    })

    it("closes on a second toggle click", () => {
      toggle().click()
      toggle().click()

      expect(picker.isOpen).toBe(false)
    })

    it("closes when clicking elsewhere in the document", () => {
      toggle().click()
      document.body.click()

      expect(picker.isOpen).toBe(false)
      expect(dropdown().classList.contains("hidden")).toBe(true)
    })

    it("does not close when clicking the toggle itself", () => {
      // The toggle stops propagation so the document handler cannot
      // immediately undo the open.
      toggle().click()

      expect(picker.isOpen).toBe(true)
    })

    it("closes after picking a color", () => {
      toggle().click()
      options()[2].click()

      expect(picker.isOpen).toBe(false)
    })
  })

  describe("selecting a color", () => {
    it("notifies the listener with the chosen value", () => {
      options()[1].click()

      expect(onChange).toHaveBeenCalledWith(ColorPicker.COLORS[1].value)
    })

    it("becomes the current color", () => {
      options()[3].click()

      expect(picker.getColor()).toBe(ColorPicker.COLORS[3].value)
    })

    it("moves the selected marker", () => {
      options()[3].click()
      const selected = options().filter(o => o.classList.contains("selected"))

      expect(selected).toHaveLength(1)
      expect(selected[0].dataset.color).toBe(ColorPicker.COLORS[3].value)
    })

    it("updates the toggle swatch to preview the choice", () => {
      options()[2].click()
      const swatch = container.querySelector(".color-picker-toggle .color-picker-swatch")

      expect(swatch.style.backgroundColor).toBeTruthy()
    })
  })

  describe("setColor", () => {
    it("can be driven programmatically", () => {
      picker.setColor("#00FF00")

      expect(picker.getColor()).toBe("#00FF00")
      expect(onChange).toHaveBeenCalledWith("#00FF00")
    })

    it("clears the marker when set to a color outside the palette", () => {
      picker.setColor("#123456")

      expect(options().filter(o => o.classList.contains("selected"))).toHaveLength(0)
    })
  })

  it("tolerates having no change listener", () => {
    const bare = new ColorPicker()
    bare.render(document.createElement("div"))

    expect(() => bare.setColor("#FF0000")).not.toThrow()
    bare.destroy()
  })

  describe("destroy", () => {
    it("removes the element from the DOM", () => {
      picker.destroy()

      expect(container.querySelector(".color-picker")).toBeNull()
    })

    it("detaches the document click listener", () => {
      // Regression: reconnecting the controller left orphaned document
      // listeners behind, one per connect cycle.
      picker.destroy()

      expect(() => document.body.click()).not.toThrow()
    })

    it("is safe to call twice", () => {
      picker.destroy()

      expect(() => picker.destroy()).not.toThrow()
    })
  })
})
