// Extract title/author/ISBN/cover from an EPUB buffer via epub.js.

export type EpubMeta = {
  title: string;
  authors: string[];
  isbns: string[];
  cover?: string | null;
};

export async function extractEpubMeta(buffer: ArrayBuffer): Promise<EpubMeta> {
  const ePub = (await import("epubjs")).default;
  const book = ePub(buffer);
  await book.ready;

  const meta = await book.loaded.metadata;
  const title = meta.title?.trim() || "Untitled";
  const authors: string[] = [];
  if (meta.creator) authors.push(String(meta.creator));

  const isbns: string[] = [];
  const id = meta.identifier ? String(meta.identifier) : "";
  const isbnMatch = id.match(/\d{10,13}/);
  if (isbnMatch) isbns.push(isbnMatch[0]);

  let cover: string | null = null;
  try {
    const url = await book.coverUrl();
    if (url) {
      const res = await fetch(url);
      const blob = await res.blob();
      cover = await blobToDataUrl(blob);
    }
  } catch {
    /* no cover */
  }

  book.destroy?.();

  return { title, authors, isbns, cover };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
