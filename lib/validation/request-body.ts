/** Limit bytes before a multipart parser allocates fields/files, including chunked uploads. */
export class RequestBodyError extends Error {
  constructor(public code: 'too_large' | 'invalid' | 'timeout') { super(code); }
}

export async function readBoundedFormData(request: Request, maxBytes: number, signal?: AbortSignal): Promise<FormData> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) throw new RequestBodyError('invalid');
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new RequestBodyError('too_large');
  const reader = request.body?.getReader();
  if (!reader) throw new RequestBodyError('invalid');
  const deadline = AbortSignal.any([request.signal, AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  deadline.addEventListener('abort', cancel, { once: true });
  try {
    if (deadline.aborted) throw new RequestBodyError('timeout');
    for (;;) {
      const { done, value } = await reader.read();
      if (deadline.aborted) throw new RequestBodyError('timeout');
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { cancel(); throw new RequestBodyError('too_large'); }
      chunks.push(value);
    }
  } finally {
    deadline.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return await new Response(bytes, { headers: { 'content-type': contentType } }).formData(); }
  catch { throw new RequestBodyError('invalid'); }
}
