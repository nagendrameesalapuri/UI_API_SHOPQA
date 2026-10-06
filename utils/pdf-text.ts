import { inflateSync } from "node:zlib";

// Pulls the visible text out of a simple generated PDF (such as the order invoice)
// without a PDF library: inflates each FlateDecode content stream and decodes the
// hex strings inside every TJ operator. Each TJ becomes one line of the result.
export function extractPdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const lines: string[] = [];

  let streamStart = raw.indexOf("stream");
  while (streamStart >= 0) {
    let dataStart = streamStart + "stream".length;
    if (raw[dataStart] === "\r") dataStart++;
    if (raw[dataStart] === "\n") dataStart++;
    const dataEnd = raw.indexOf("endstream", dataStart);

    let content = "";
    try {
      content = inflateSync(pdf.subarray(dataStart, dataEnd)).toString("latin1");
    } catch {
      // Not a compressed content stream (fonts, images); skip it
    }

    for (const [, operands] of content.matchAll(/\[(.*?)\]\s*TJ/g)) {
      const text = [...operands.matchAll(/<([0-9a-fA-F]+)>/g)]
        .map(([, hex]) => Buffer.from(hex, "hex").toString("latin1"))
        .join("");
      lines.push(text);
    }

    streamStart = raw.indexOf("stream", dataEnd + "endstream".length);
  }

  return lines.join("\n");
}
