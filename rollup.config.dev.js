import resolve from "@rollup/plugin-node-resolve"
import serve from "rollup-plugin-serve"
import livereload from "rollup-plugin-livereload"

export default {
  input: "src/index.js",
  output: [
    {
      file: "dist/stimulus-pdf-viewer.esm.js",
      format: "es",
      sourcemap: true
    }
  ],
  external: [
    "@hotwired/stimulus",
    "@rails/request.js",
    "pdfjs-dist",
    "pdf-lib"
  ],
  plugins: [
    resolve(),
    serve({
      open: true,
      openPage: "/dev/",
      contentBase: [".", "dev"],
      port: 3030,
      headers: {
        "Access-Control-Allow-Origin": "*"
      }
    }),
    livereload({
      watch: ["dist", "dev", "src"]
    })
  ]
}
