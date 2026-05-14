import AppKit
import Foundation

let args = CommandLine.arguments
guard args.count == 3 else {
  FileHandle.standardError.write(Data("Usage: pdf-export.swift input.html output.pdf\n".utf8))
  exit(1)
}

let inputPath = args[1]
let outputPath = args[2]
let htmlData = try Data(contentsOf: URL(fileURLWithPath: inputPath))

let attributed = try NSAttributedString(
  data: htmlData,
  options: [
    .documentType: NSAttributedString.DocumentType.html,
    .characterEncoding: String.Encoding.utf8.rawValue
  ],
  documentAttributes: nil
)

let pageRect = CGRect(x: 0, y: 0, width: 595, height: 842)
let margin: CGFloat = 52
let textRect = pageRect.insetBy(dx: margin, dy: margin)
let data = NSMutableData()
var mediaBox = pageRect

guard let consumer = CGDataConsumer(data: data as CFMutableData),
      let context = CGContext(consumer: consumer, mediaBox: &mediaBox, nil) else {
  FileHandle.standardError.write(Data("Could not create PDF context\n".utf8))
  exit(1)
}

let storage = NSTextStorage(attributedString: attributed)
let layout = NSLayoutManager()
storage.addLayoutManager(layout)

var glyphIndex = 0
let glyphCount = layout.numberOfGlyphs

while glyphIndex < glyphCount {
  let container = NSTextContainer(size: textRect.size)
  container.lineFragmentPadding = 0
  layout.addTextContainer(container)

  let glyphRange = layout.glyphRange(for: container)
  if glyphRange.length == 0 { break }

  context.beginPDFPage(nil)
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)

  layout.drawBackground(forGlyphRange: glyphRange, at: textRect.origin)
  layout.drawGlyphs(forGlyphRange: glyphRange, at: textRect.origin)

  NSGraphicsContext.restoreGraphicsState()
  context.endPDFPage()
  glyphIndex = NSMaxRange(glyphRange)
}

context.closePDF()
try data.write(toFile: outputPath, options: .atomic)
