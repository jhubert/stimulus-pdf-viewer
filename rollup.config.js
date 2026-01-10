import resolve from "@rollup/plugin-node-resolve"

export default {
  input: "src/index.js",
  output: [
    {
      file: "dist/stimulus-pdf-viewer.esm.js",
      format: "es",
      sourcemap: true
    },
    {
      file: "dist/stimulus-pdf-viewer.js",
      format: "umd",
      name: "StimulusPdfViewer",
      sourcemap: true,
      globals: {
        "@hotwired/stimulus": "Stimulus",
        "@rails/request.js": "Rails",
        "pdfjs-dist": "pdfjsLib",
        "pdf-lib": "PDFLib"
      }
    }
  ],
  external: [
    "@hotwired/stimulus",
    "@rails/request.js",
    "pdfjs-dist",
    "pdf-lib"
  ],
  plugins: [
    resolve()
  ]
}
