/** Builds a multipart /api/signup request by hand (a Request made from FormData has no Content-Length). */
export const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
export const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

export function multipartRequest(
  payload: unknown,
  opts: {
    image?: Uint8Array | null;
    imageType?: string;
    headers?: Record<string, string>;
    contentLength?: number | null;
  } = {},
): Request {
  const boundary = "----testboundary";
  const image = opts.image === undefined ? JPEG : opts.image;
  const parts: Buffer[] = [];
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${
        typeof payload === "string" ? payload : JSON.stringify(payload)
      }\r\n`,
    ),
  );
  if (image) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="cprImage"; filename="cpr.jpg"\r\nContent-Type: ${
          opts.imageType ?? "image/jpeg"
        }\r\n\r\n`,
      ),
    );
    parts.push(Buffer.from(image));
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(parts);
  const headers: Record<string, string> = {
    "content-type": `multipart/form-data; boundary=${boundary}`,
    ...opts.headers,
  };
  if (opts.contentLength !== null) headers["content-length"] = String(opts.contentLength ?? body.length);
  return new Request("http://x/api/signup", { method: "POST", headers, body });
}
