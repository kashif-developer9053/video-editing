/**
 * Next.js calls this once when the server starts.
 *
 * Rendering pulls in two native libraries that are slow to initialize:
 * pdfjs takes about half a second to import and another second to open its
 * first document, and node-canvas spends ~1.6 seconds setting up its font
 * subsystem on the first createCanvas. Left alone, all of that lands on the
 * first page of whichever render happens first, which reads as the app
 * hanging. Doing it at startup means it happens while nobody is waiting.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const started = Date.now();
  const { warmUp } = await import("./server/raster");
  await warmUp();
  console.log(`[scrollcast] ready to render in ${Date.now() - started}ms`);
}
