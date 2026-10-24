import { describe, expect, it } from 'vitest';
import { readBoundedFormData } from '../request-body';

describe('bounded binary multipart', () => {
  it('keeps valid binary files intact', async () => {
    const form = new FormData(); form.set('image', new File([new Uint8Array([0, 255, 42])], 'test.jpg'));
    const parsed = await readBoundedFormData(new Request('http://localhost', { method: 'POST', body: form }), 4096);
    expect(new Uint8Array(await (parsed.get('image') as File).arrayBuffer())).toEqual(new Uint8Array([0, 255, 42]));
  });
  it('rejects actual streamed bytes even without a length header', async () => {
    const request = new Request('http://localhost', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=test' }, body: 'a'.repeat(50) });
    await expect(readBoundedFormData(request, 10)).rejects.toMatchObject({ code: 'too_large' });
  });
  it('rejects declared oversize and aborted requests before parsing', async () => {
    const controller = new AbortController(); controller.abort();
    const request = () => new Request('http://localhost', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=test', 'content-length': '100' }, body: 'x' });
    await expect(readBoundedFormData(request(), 50)).rejects.toMatchObject({ code: 'too_large' });
    await expect(readBoundedFormData(request(), 500, controller.signal)).rejects.toMatchObject({ code: 'timeout' });
  });
});
