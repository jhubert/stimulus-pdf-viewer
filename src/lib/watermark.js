export class Watermark {
  constructor(userName) {
    this.userName = userName
  }

  // Apply watermark to canvas
  // scale: the scale at which the canvas is rendered (e.g., 2.0 for high DPI)
  applyToPage(canvas, scale = 2.0) {
    if (!this.userName) return

    const ctx = canvas.getContext("2d")
    const width = canvas.width
    const height = canvas.height

    // Draw diagonal watermark (center of page)
    this._drawDiagonalWatermark(ctx, width, height, scale)

    // Draw header watermark
    this._drawHeaderWatermark(ctx, width, scale)
  }

  _drawDiagonalWatermark(ctx, width, height, scale) {
    ctx.save()
    ctx.translate(width / 2, height / 2)
    ctx.rotate(-Math.PI / 4) // -45 degrees

    // Scale font size to match canvas resolution
    const fontSize = 25 * scale
    ctx.font = `${fontSize}px sans-serif`
    ctx.fillStyle = "rgba(0, 0, 0, 0.07)" // 7% opacity
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(this.userName, 0, 0)

    ctx.restore()
  }

  _drawHeaderWatermark(ctx, width, scale) {
    ctx.save()

    // Scale font size and offset to match canvas resolution
    const fontSize = 6 * scale
    const topOffset = 5 * scale
    ctx.font = `${fontSize}px sans-serif`
    ctx.fillStyle = "rgba(0, 0, 0, 0.10)" // 10% opacity
    ctx.textAlign = "center"
    ctx.textBaseline = "top"
    ctx.fillText(this.userName, width / 2, topOffset)

    ctx.restore()
  }
}
