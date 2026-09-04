import { describe, it, expect, vi, beforeEach } from "vitest"
import { FindController, FindState } from "../../src/lib/find_controller.js"

/** A PDF document whose pages yield the given strings as text content. */
function makeDocument(pageTexts) {
  return {
    numPages: pageTexts.length,
    getPage: vi.fn(async (n) => ({
      getTextContent: async () => ({
        items: [{ str: pageTexts[n - 1], hasEOL: false }]
      })
    }))
  }
}

function makeController(pageTexts, { visible = { first: 1, last: 1 } } = {}) {
  const onUpdateState = vi.fn()
  // FindController is handed the PdfViewer, and reaches through to the core
  // viewer for page geometry and text layers.
  const host = {
    viewer: {
      getVisiblePages: vi.fn(() => visible),
      getPageCount: vi.fn(() => (pageTexts ? pageTexts.length : 1)),
      getTextLayer: vi.fn(() => null),
      getPageContainer: vi.fn(() => null),
      goToPage: vi.fn()
    }
  }

  const controller = new FindController(host, { onUpdateState })
  if (pageTexts) controller.setDocument(makeDocument(pageTexts))
  return { controller, onUpdateState, host }
}

/** Let the lazy extraction loop run to completion. */
async function extracted(controller) {
  for (let i = 0; i < 200 && !controller.extractionComplete; i++) {
    await Promise.resolve()
  }
}

describe("FindController", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  describe("setDocument", () => {
    it("starts with no matches and nothing extracted", () => {
      const { controller } = makeController(["hello world"])

      expect(controller.matches).toEqual([])
      expect(controller.currentMatchIndex).toBe(-1)
      expect(controller.extractionComplete).toBe(false)
    })

    it("does not extract text until a search runs", () => {
      const { controller } = makeController(["hello world"])

      expect(controller.pdfDocument.getPage).not.toHaveBeenCalled()
    })

    it("discards state from a previously loaded document", async () => {
      const { controller } = makeController(["hello"])
      controller.find("hello")
      await extracted(controller)

      controller.setDocument(makeDocument(["different"]))

      expect(controller.matches).toEqual([])
      expect(controller.pageContents.size).toBe(0)
    })
  })

  describe("matching", () => {
    it("finds a term on a single page", async () => {
      const { controller } = makeController(["the quick brown fox"])

      controller.find("quick")
      await extracted(controller)

      expect(controller.matches).toHaveLength(1)
      expect(controller.matches[0].text).toBe("quick")
    })

    it("finds every occurrence on a page", async () => {
      const { controller } = makeController(["cat cat cat"])

      controller.find("cat")
      await extracted(controller)

      expect(controller.matches).toHaveLength(3)
    })

    it("finds matches across pages", async () => {
      const { controller } = makeController(["cat here", "cat there", "nothing"])

      controller.find("cat")
      await extracted(controller)

      expect(controller.matches).toHaveLength(2)
      expect(controller.matches.map(m => m.pageNumber)).toEqual([1, 2])
    })

    it("is case-insensitive by default", async () => {
      const { controller } = makeController(["The Quick Brown Fox"])

      controller.find("quick")
      await extracted(controller)

      expect(controller.matches).toHaveLength(1)
    })

    it("respects case-sensitive mode", async () => {
      const { controller } = makeController(["Cat cat CAT"])

      controller.find("cat", { caseSensitive: true })
      await extracted(controller)

      expect(controller.matches).toHaveLength(1)
      expect(controller.matches[0].text).toBe("cat")
    })

    it("matches substrings by default", async () => {
      const { controller } = makeController(["concatenate"])

      controller.find("cat")
      await extracted(controller)

      expect(controller.matches).toHaveLength(1)
    })

    it("respects whole-word mode", async () => {
      const { controller } = makeController(["concatenate the cat"])

      controller.find("cat", { entireWord: true })
      await extracted(controller)

      expect(controller.matches).toHaveLength(1)
    })

    it("records where each match sits in the page text", async () => {
      const { controller } = makeController(["abc target def"])

      controller.find("target")
      await extracted(controller)

      expect(controller.matches[0]).toMatchObject({ startOffset: 4, endOffset: 10 })
    })

    it("treats regex metacharacters as literal text", async () => {
      // A query like "a.c" must not match "abc".
      const { controller } = makeController(["abc and a.c"])

      controller.find("a.c")
      await extracted(controller)

      expect(controller.matches).toHaveLength(1)
      expect(controller.matches[0].text).toBe("a.c")
    })

    it.each(["(", ")", "[", "]", "{", "}", "*", "+", "?", "^", "$", "|", "\\"])(
      "does not crash on a query containing %j", async (char) => {
        const { controller } = makeController([`literal ${char} here`])

        expect(() => controller.find(char)).not.toThrow()
        await extracted(controller)
      }
    )

    it("orders matches by page then position", async () => {
      const { controller } = makeController(["x cat y cat", "cat"])

      controller.find("cat")
      await extracted(controller)

      const order = controller.matches.map(m => [m.pageNumber, m.startOffset])
      expect(order).toEqual([[1, 2], [1, 8], [2, 0]])
    })
  })

  describe("state reporting", () => {
    it("reports FOUND with a match count", async () => {
      const { controller, onUpdateState } = makeController(["cat cat"])

      controller.find("cat")
      await extracted(controller)

      expect(controller.state).toBe(FindState.FOUND)
      const last = onUpdateState.mock.calls.at(-1)
      expect(last[1]).toMatchObject({ current: 1, total: 2 })
    })

    it("reports NOT_FOUND only once extraction has finished", async () => {
      const { controller } = makeController(["nothing here"])

      controller.find("missing")

      // Extraction is still running, so the absence is not yet conclusive.
      expect(controller.state).toBe(FindState.PENDING)

      await extracted(controller)
      controller.find("missing2")

      expect(controller.state).toBe(FindState.NOT_FOUND)
    })

    it("flags that extraction is still in progress, then that it is done", async () => {
      // The find bar renders "N+" while this is true, so a climbing count
      // does not look like a miscount.
      const { controller, onUpdateState } = makeController(["cat", "cat", "cat"])

      controller.find("cat")

      expect(onUpdateState.mock.calls[0][1].extracting).toBe(true)

      await extracted(controller)

      expect(onUpdateState.mock.calls.at(-1)[1].extracting).toBe(false)
    })

    it("clears everything on an empty query", async () => {
      const { controller, onUpdateState } = makeController(["cat"])
      controller.find("cat")
      await extracted(controller)

      controller.find("")

      expect(controller.matches).toEqual([])
      expect(controller.state).toBe(FindState.PENDING)
      expect(onUpdateState.mock.calls.at(-1)[1]).toMatchObject({ current: 0, total: 0 })
    })
  })

  describe("navigation", () => {
    async function threeMatches() {
      const { controller } = makeController(["cat cat cat"])
      controller.find("cat")
      await extracted(controller)
      return controller
    }

    it("starts on the first match", async () => {
      const controller = await threeMatches()

      expect(controller.currentMatchIndex).toBe(0)
    })

    it("selects the first match on a document's very first search", async () => {
      // Regression: the first search runs before any text is extracted, so
      // find() found nothing and left no current match. Matches arriving from
      // the background extraction left the UI at "0 of N" until the user
      // pressed Next.
      const { controller, onUpdateState } = makeController(["cat cat"])

      controller.find("cat")
      await extracted(controller)

      expect(controller.currentMatchIndex).toBe(0)
      expect(controller.state).toBe(FindState.FOUND)
      expect(onUpdateState.mock.calls.at(-1)[1]).toMatchObject({ current: 1, total: 2 })
    })

    it("keeps the user's position as later pages stream in", async () => {
      const { controller } = makeController(["cat", "cat", "cat"], { visible: { first: 1, last: 1 } })
      controller.find("cat")
      await extracted(controller)
      controller.findNext()
      const position = controller.currentMatchIndex

      expect(position).toBe(1)
      expect(controller.matches).toHaveLength(3)
    })

    it("steps forward", async () => {
      const controller = await threeMatches()

      controller.findNext()

      expect(controller.currentMatchIndex).toBe(1)
      expect(controller.state).toBe(FindState.FOUND)
    })

    it("wraps to the first match past the end", async () => {
      const controller = await threeMatches()

      controller.findNext()
      controller.findNext()
      controller.findNext()

      expect(controller.currentMatchIndex).toBe(0)
      expect(controller.state).toBe(FindState.WRAPPED)
    })

    it("steps backward", async () => {
      const controller = await threeMatches()
      controller.findNext()

      controller.findPrevious()

      expect(controller.currentMatchIndex).toBe(0)
    })

    it("wraps to the last match before the beginning", async () => {
      const controller = await threeMatches()

      controller.findPrevious()

      expect(controller.currentMatchIndex).toBe(2)
      expect(controller.state).toBe(FindState.WRAPPED)
    })

    it("preserves search options while navigating", async () => {
      const { controller } = makeController(["Cat cat"])
      controller.find("cat", { caseSensitive: true })
      await extracted(controller)

      controller.findNext()

      expect(controller.caseSensitive).toBe(true)
      expect(controller.matches).toHaveLength(1)
    })

    it("does nothing when there is nothing to navigate", async () => {
      const { controller } = makeController(["nothing"])
      controller.find("missing")
      await extracted(controller)

      expect(() => controller.findNext()).not.toThrow()
      expect(controller.currentMatchIndex).toBe(-1)
    })

    it("restarts from the first match when the query changes", async () => {
      const controller = await threeMatches()
      controller.findNext()

      controller.find("cat cat")

      expect(controller.currentMatchIndex).toBe(0)
    })
  })

  describe("lazy extraction order", () => {
    it("extracts the visible page before the rest", async () => {
      const { controller } = makeController(["one", "two", "three", "four", "five"], {
        visible: { first: 3, last: 3 }
      })

      controller.find("e")
      await extracted(controller)

      expect(controller.pdfDocument.getPage.mock.calls[0][0]).toBe(3)
    })

    it("eventually extracts every page", async () => {
      const { controller } = makeController(["one", "two", "three"], {
        visible: { first: 2, last: 2 }
      })

      controller.find("zzz")
      await extracted(controller)

      expect(controller.pageContents.size).toBe(3)
    })

    it("extracts each page only once across repeated searches", async () => {
      const { controller } = makeController(["cat", "dog"])
      controller.find("cat")
      await extracted(controller)
      const callsAfterFirst = controller.pdfDocument.getPage.mock.calls.length

      controller.find("dog")
      await extracted(controller)

      expect(controller.pdfDocument.getPage.mock.calls.length).toBe(callsAfterFirst)
    })

    it("survives a page whose text cannot be extracted", async () => {
      const { controller } = makeController(["ok", "bad", "ok"])
      controller.pdfDocument.getPage = vi.fn(async (n) => {
        if (n === 2) throw new Error("extraction failed")
        return { getTextContent: async () => ({ items: [{ str: "ok", hasEOL: false }] }) }
      })

      controller.find("ok")
      await extracted(controller)

      expect(controller.matches.length).toBeGreaterThan(0)
      expect(console.error).toHaveBeenCalled()
    })
  })

  describe("text assembly", () => {
    it("joins text items on a page", async () => {
      const { controller } = makeController(null)
      controller.setDocument({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({
            items: [{ str: "hello" }, { str: "world" }]
          })
        })
      })

      controller.find("helloworld")
      await extracted(controller)

      expect(controller.matches).toHaveLength(1)
    })

    it("inserts a space at end-of-line markers so words do not run together", async () => {
      const { controller } = makeController(null)
      controller.setDocument({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({
            items: [{ str: "hello", hasEOL: true }, { str: "world" }]
          })
        })
      })

      controller.find("hello world")
      await extracted(controller)

      expect(controller.matches).toHaveLength(1)
    })

    it("skips items with no string", async () => {
      const { controller } = makeController(null)
      controller.setDocument({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({
            items: [{ str: "" }, { str: "text" }]
          })
        })
      })

      controller.find("text")
      await extracted(controller)

      expect(controller.matches).toHaveLength(1)
    })
  })
})
