import { describe, it, expect, vi, beforeEach } from "vitest"
import { PasswordPrompt } from "../../../src/lib/ui/password_prompt.js"

describe("PasswordPrompt", () => {
  let container, prompt

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    prompt = new PasswordPrompt({ container })
  })

  const el = () => container.querySelector(".pdf-password-prompt")
  const input = () => container.querySelector(".pdf-password-prompt-input")
  const error = () => container.querySelector(".pdf-password-prompt-error")
  const submit = () => container.querySelector(".pdf-password-prompt-submit")
  const cancel = () => container.querySelector(".pdf-password-prompt-cancel")

  describe("markup", () => {
    it("starts hidden", () => {
      expect(el().classList.contains("hidden")).toBe(true)
    })

    it("is a labelled modal dialog", () => {
      const dialog = container.querySelector('[role="dialog"]')

      expect(dialog.getAttribute("aria-modal")).toBe("true")
      expect(dialog.getAttribute("aria-labelledby")).toBeTruthy()
    })

    it("masks the password field and disables autocomplete", () => {
      expect(input().type).toBe("password")
      expect(input().getAttribute("autocomplete")).toBe("off")
    })

    it("hides the retry error initially", () => {
      expect(error().classList.contains("hidden")).toBe(true)
    })
  })

  describe("request", () => {
    it("reveals the dialog", () => {
      prompt.request()

      expect(el().classList.contains("hidden")).toBe(false)
    })

    it("resolves with the entered password", async () => {
      const pending = prompt.request()
      input().value = "hunter2"

      submit().click()

      await expect(pending).resolves.toBe("hunter2")
    })

    it("rejects when cancelled", async () => {
      const pending = prompt.request()

      cancel().click()

      await expect(pending).rejects.toThrow("Password entry cancelled")
    })

    it("hides the dialog after a successful entry", async () => {
      const pending = prompt.request()
      input().value = "pw"
      submit().click()
      await pending

      expect(el().classList.contains("hidden")).toBe(true)
    })

    it("clears the field so the password does not linger in the DOM", async () => {
      const pending = prompt.request()
      input().value = "secret"
      submit().click()
      await pending

      expect(input().value).toBe("")
    })

    it("starts each request with an empty field", async () => {
      const first = prompt.request()
      input().value = "first"
      submit().click()
      await first

      prompt.request()

      expect(input().value).toBe("")
    })
  })

  describe("retry", () => {
    it("shows the incorrect-password message when retrying", () => {
      prompt.request({ retry: true })

      expect(error().classList.contains("hidden")).toBe(false)
    })

    it("hides it again on a fresh, non-retry request", async () => {
      const first = prompt.request({ retry: true })
      cancel().click()
      await first.catch(() => {})

      prompt.request({ retry: false })

      expect(error().classList.contains("hidden")).toBe(true)
    })
  })

  describe("empty input", () => {
    it("does not submit an empty password", () => {
      const pending = prompt.request()
      let settled = false
      pending.then(() => { settled = true }, () => { settled = true })

      input().value = ""
      submit().click()

      expect(settled).toBe(false)
      expect(el().classList.contains("hidden")).toBe(false)
    })
  })

  describe("keyboard", () => {
    it("submits on Enter", async () => {
      const pending = prompt.request()
      input().value = "hunter2"

      el().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))

      await expect(pending).resolves.toBe("hunter2")
    })

    it("cancels on Escape", async () => {
      const pending = prompt.request()

      el().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))

      await expect(pending).rejects.toThrow("Password entry cancelled")
    })
  })

  describe("overlapping requests", () => {
    it("cancels the earlier request rather than leaving it dangling", async () => {
      const first = prompt.request()
      const firstResult = first.catch(e => e.message)

      const second = prompt.request()

      await expect(firstResult).resolves.toBe("Password entry cancelled")

      input().value = "pw"
      submit().click()
      await expect(second).resolves.toBe("pw")
    })
  })

  describe("destroy", () => {
    it("rejects an in-flight request so callers are not left hanging", async () => {
      const pending = prompt.request()

      prompt.destroy()

      await expect(pending).rejects.toThrow("Password entry cancelled")
    })

    it("removes the element", () => {
      prompt.destroy()

      expect(container.querySelector(".pdf-password-prompt")).toBeNull()
    })

    it("is safe to call twice", () => {
      prompt.destroy()

      expect(() => prompt.destroy()).not.toThrow()
    })
  })
})
