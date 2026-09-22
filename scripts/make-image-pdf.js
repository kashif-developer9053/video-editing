/**
 * Writes a PDF with an embedded raster image.
 *
 * The text-only test PDF never exercised pdfjs's image drawing path, which
 * is where "TypeError: Image or Canvas expected" came from on real
 * documents. This one does.
 */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const W = 120;
const H = 90;

// A simple RGB gradient with a dark band, so the result is obviously an image.
const pixels = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const band = y > H * 0.4 && y < H * 0.6;
    pixels[i] = band ? 20 : Math.round((x / W) * 255);
    pixels[i + 1] = band ? 20 : Math.round((y / H) * 255);
    pixels[i + 2] = band ? 20 : 160;
  }
}
const imageData = zlib.deflateSync(pixels);

let pdf = "";
const offsets = [0];
let nextId = 1;
const chunks = [];

function add(body, raw) {
  offsets.push(Buffer.byteLength(pdf, "latin1") + chunks.reduce((a, b) => a + b.length, 0));
  const id = nextId++;
  pdf += `${id} 0 obj\n${body}\nendobj\n`;
  return id;
}

pdf = "%PDF-1.4\n";

// Image XObject, Flate-compressed RGB.
const imgId = nextId++;
offsets.push(Buffer.byteLength(pdf, "latin1"));
const imgHeader =
  `${imgId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} ` +
  `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode ` +
  `/Length ${imageData.length} >>\nstream\n`;
chunks.push(Buffer.from(pdf + imgHeader, "latin1"), imageData, Buffer.from("\nendstream\nendobj\n", "latin1"));
pdf = "";

function addAfterImage(body) {
  const id = nextId++;
  const so_far = chunks.reduce((a, b) => a + b.length, 0);
  offsets.push(so_far + Buffer.byteLength(pdf, "latin1"));
  pdf += `${id} 0 obj\n${body}\nendobj\n`;
  return id;
}

const content = `BT /F1 20 Tf 60 760 Td (Page with an embedded image) Tj ET\nq 400 0 0 300 60 380 cm /Im1 Do Q`;
const contentId = addAfterImage(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
const fontId = addAfterImage("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
const pagesIdGuess = nextId + 1;
const pageId = addAfterImage(
  `<< /Type /Page /Parent ${pagesIdGuess} 0 R /MediaBox [0 0 595 842] ` +
    `/Resources << /Font << /F1 ${fontId} 0 R >> /XObject << /Im1 ${imgId} 0 R >> >> ` +
    `/Contents ${contentId} 0 R >>`,
);
const pagesId = addAfterImage(`<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`);
const catalogId = addAfterImage(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

chunks.push(Buffer.from(pdf, "latin1"));
const body = Buffer.concat(chunks);
const xrefPos = body.length;

let tail = `xref\n0 ${nextId}\n0000000000 65535 f \n`;
for (let i = 1; i < nextId; i++) {
  tail += `${String(offsets[i] ?? 0).padStart(10, "0")} 00000 n \n`;
}
tail += `trailer\n<< /Size ${nextId} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

const out = path.join(__dirname, "..", "test-image.pdf");
fs.writeFileSync(out, Buffer.concat([body, Buffer.from(tail, "latin1")]));
console.log(`Wrote ${out} (1 page, ${W}x${H} embedded image)`);
