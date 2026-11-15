import type { VercelRequest, VercelResponse } from '@vercel/node';
import { hasProviderRelayAuthHeader, isProviderModelListRelayTarget, sanitizeProviderRelayHeaders } from '../src/engines/chat-api/providerRelayShared.js';
import { isAllowedPolarisApiOrigin } from '../src/engines/server/corsOrigin.js';
import { ProviderRelayTargetError, validateProviderRelayTarget } from '../server/providerRelayTarget.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || '';
  if (isAllowedPolarisApiOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: { message: 'Method not allowed' } }); return; }
  try {
    let payload: Record<string, unknown>;
    try { payload = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); }
    catch { throw new ProviderRelayTargetError('模型列表请求必须是 JSON 对象。'); }
    const endpoint = typeof payload?.endpoint === 'string' ? payload.endpoint.trim() : '';
    if (!isProviderModelListRelayTarget(endpoint)) throw new ProviderRelayTargetError('模型列表只接受公开 HTTPS 的 /models 接口。');
    const url = new URL(endpoint);
    if (url.username || url.password) throw new ProviderRelayTargetError('请通过认证头提供供应商凭据。');
    await validateProviderRelayTarget(endpoint);
    const headers = sanitizeProviderRelayHeaders(payload.headers && typeof payload.headers === 'object' && !Array.isArray(payload.headers)
      ? Object.fromEntries(Object.entries(payload.headers).map(([key, value]) => [key, String(value)])) : {});
    if (!hasProviderRelayAuthHeader(headers)) throw new ProviderRelayTargetError('模型列表请求缺少供应商认证头。');
    const response = await fetch(endpoint, { method: 'GET', headers, redirect: 'error' });
    res.status(response.status);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
    res.send(await response.text());
  } catch (error) {
    const invalid = error instanceof ProviderRelayTargetError;
    res.status(invalid ? 400 : 502).json({ error: { message: invalid ? error.message : '读取供应商模型列表失败。' } });
  }
}
