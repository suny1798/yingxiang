/** 同源转发层：不包含账号、配额、支付或模型业务，也不回退旧写入端。 */
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

const allowedRequestHeaders = ['host', 'origin', 'cookie', 'content-type', 'stripe-signature', 'x-studio-access', 'x-video-attempt', 'sec-fetch-site'];
const allowedResponseHeaders = ['content-type', 'cache-control', 'x-content-type-options', 'set-cookie', 'content-disposition', 'cross-origin-resource-policy', 'allow'];
const maxBodyBytes = 35 * 1024 * 1024 + 4096;

function unavailable(code = 'SERVICE_UNAVAILABLE', message = '服务暂不可用，请刷新状态核查，不要重复提交。', status = 503) {
  return Response.json({ error: { code, message, retryable: false }, requestId: randomUUID() }, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export async function forwardApi(request: Request): Promise<Response> {
  try {
    const origin = new URL(process.env.YINGXIANG_API_ORIGIN ?? 'http://127.0.0.1:8788');
    if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) return unavailable();
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return unavailable('NOT_FOUND', '接口不存在。', 404);
    const headers = new Headers();
    for (const key of allowedRequestHeaders) {
      const value = request.headers.get(key);
      if (value !== null) headers.set(key, value);
    }
    // HTTPX/Fetch 都只使用白名单；不信任客户端 X-Forwarded-*。
    headers.set('accept-encoding', 'identity');
    const abort = new AbortController();
    const signal = AbortSignal.any([request.signal, abort.signal, AbortSignal.timeout(130_000)]);
    let size = 0;
    if (Number(request.headers.get('content-length') ?? 0) > maxBodyBytes) return unavailable('BODY_TOO_LARGE', '请求内容过大。', 413);
    const body = request.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > maxBodyBytes) { abort.abort(); controller.error(new Error('请求内容过大。')); return; }
        controller.enqueue(chunk);
      },
    }));
    // Node Fetch 会重写 Host；使用原生 HTTP 才能保持页面 Host 和原始字节。
    const upstream = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      const outgoing = httpRequest(new URL(url.pathname + url.search, origin), {
        method: request.method, headers: Object.fromEntries(headers), signal,
      }, resolve);
      outgoing.once('error', reject);
      if (body && request.method !== 'GET' && request.method !== 'HEAD') {
        const input = Readable.fromWeb(body as NodeReadableStream<Uint8Array>);
        input.once('error', () => outgoing.destroy(new Error('请求传输中断。')));
        outgoing.once('close', () => input.destroy());
        input.pipe(outgoing);
      } else outgoing.end();
    });
    const responseHeaders = new Headers();
    for (const key of allowedResponseHeaders) {
      const value = upstream.headers[key];
      if (value !== undefined) responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
    }
    responseHeaders.set('Cache-Control', 'no-store');
    responseHeaders.set('X-Content-Type-Options', 'nosniff');
    const status = upstream.statusCode ?? 503;
    return new Response(request.method === 'HEAD' || [204, 304].includes(status) ? null : Readable.toWeb(upstream) as ReadableStream<Uint8Array>, { status, headers: responseHeaders });
  } catch {
    return unavailable();
  }
}
