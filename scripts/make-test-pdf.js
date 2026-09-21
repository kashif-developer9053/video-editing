/**
 * Writes a small multi-page PDF with real text, for exercising the render
 * pipeline without needing a real document on hand.
 *
 * Hand-assembled rather than pulled from a library: it keeps the repo free
 * of a dependency that only a test script would use.
 */

const fs = require("node:fs");
const path = require("node:path");

const PAGE_COUNT = 6;

function escapeText(s) {
  return s.replace(/([()\\])/g, "\\$1");
}

function buildPdf(pageCount) {
  const contentStreams = [];

  for (let i = 1; i <= pageCount; i++) {
    // Vary the text volume per page so auto-pace weighting has something
    // real to differentiate.
    const filler = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(i * 2);
    const text = `Page ${i} of ${pageCount} - Scrollcast render test. ${filler}`;
    const lines = text.match(/.{1,62}/g) || [text];

    let stream = "BT\n/F1 16 Tf\n60 760 Td\n20 TL\n";
    stream += `(${escapeText(`PAGE ${i}`)}) Tj T* T*\n`;
    stream += "/F1 11 Tf\n";
    for (const line of lines) {
      stream += `(${escapeText(line)}) Tj T*\n`;
    }
    stream += "ET";
    contentStreams.push(stream);
  }

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  let nextId = 1;

  function addObject(body) {
    offsets.push(pdf.length);
    const id = nextId++;
    pdf += `${id} 0 obj\n${body}\nendobj\n`;
    return id;
  }

  const contentIds = contentStreams.map((stream) =>
    addObject(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`),
  );

  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  // Page objects need the Pages object id, which is allocated after them.
  const pagesId = nextId + pageCount;
  const pageIds = contentIds.map((contentId) =>
    addObject(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] ` +
        `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    ),
  );

  const actualPagesId = addObject(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`,
  );
  if (actualPagesId !== pagesId) {
    throw new Error(`Pages id mismatch: predicted ${pagesId}, got ${actualPagesId}`);
  }

  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  const xrefPos = pdf.length;
  pdf += `xref\n0 ${nextId}\n0000000000 65535 f \n`;
  for (let i = 1; i < nextId; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${nextId} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

  return pdf;
}

const out = path.join(__dirname, "..", "test-sample.pdf");
fs.writeFileSync(out, buildPdf(PAGE_COUNT), "latin1");
console.log(`Wrote ${out} (${PAGE_COUNT} pages)`);
