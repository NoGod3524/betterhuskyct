export class RequestBodyError extends Error {
  readonly status: 400 | 408 | 413;

  constructor(status: 400 | 408 | 413) {
    super("Invalid request body.");
    this.name = "RequestBodyError";
    this.status = status;
  }
}

/** Bound bytes while reading, and stop even a client that keeps sending a slow trickle. */
export async function readRequestText(request: Request, maxBytes: number): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    if (Number(request.headers.get("content-length")) > maxBytes) throw new RequestBodyError(413);

    const read = async () => {
      const decoder = new TextDecoder();
      let bytes = 0;
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return text + decoder.decode();
        bytes += value.byteLength;
        if (bytes > maxBytes) throw new RequestBodyError(413);
        text += decoder.decode(value, { stream: true });
      }
    };

    return await Promise.race([
      read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new RequestBodyError(408)), 5_000);
      }),
    ]);
  } catch (error) {
    // Cancellation itself may stall or fail; neither may delay the error response.
    void reader.cancel().catch(() => undefined);
    throw error instanceof RequestBodyError ? error : new RequestBodyError(400);
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
