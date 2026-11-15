import { buildInternalApiEndpoint } from '../chat-api/chatApiEndpoint';
import { Capacitor } from '@capacitor/core';
import type { McpServerConfig } from '../../types/domain';
import { McpHttpError, type McpAuthorizationChallenge } from '../mcp-transport/protocol';
import { createOAuthRandomValue, createPkcePair } from './crypto';
import {
  discoverAuthorizationServer,
  discoverProtectedResource,
  registerPublicClient,
  requestOAuthToken
} from './discovery';
import {
  deleteMcpOAuthPendingAuthorization,
  deleteMcpOAuthToken,
  readMcpOAuthPendingAuthorization,
  readMcpOAuthToken,
  writeMcpOAuthPendingAuthorization,
  writeMcpOAuthToken
} from './secureStore';
import type {
  McpOAuthAuthorizationRequest,
  McpOAuthBeginResult,
  McpOAuthCompletionResult,
  McpOAuthFetch,
  McpOAuthStatus,
  McpOAuthTokenSet
} from './types';

const AUTHORIZATION_LIFETIME_MS = 10 * 60 * 1000;
const TOKEN_EXPIRY_SKEW_MS = 30 * 1000;
export const MCP_OAUTH_COMPLETED_EVENT = 'polaris:mcp-oauth-completed';

export function getMcpOAuthRedirectUri() {
  if (Capacitor.isNativePlatform()) {
    const configured = import.meta.env.VITE_POLARIS_MCP_OAUTH_REDIRECT_URI?.trim();
    const url = new URL(configured || buildInternalApiEndpoint('/'));
    if (url.protocol !== 'https:') throw new Error('请为原生 MCP 授权配置自己部署的 HTTPS 回调页面。');
    url.search = '';
    url.hash = '';
    url.searchParams.set('mcp_oauth_callback', '1');
    url.searchParams.set('mcp_oauth_native', '1');
    return url.toString();
  }
  const url = new URL(globalThis.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('mcp_oauth_callback', '1');
  return url.toString();
}

function resolveScope(
  challenge: McpAuthorizationChallenge,
  supported?: string[]
) {
  if (challenge.scope?.trim()) return challenge.scope.trim();
  return supported?.join(' ') || undefined;
}

function normalizeTokenResponse(args: {
  response: Record<string, unknown>;
  resource: string;
  authorizationServer: string;
  tokenEndpoint: string;
  clientId: string;
  previousRefreshToken?: string;
}): McpOAuthTokenSet {
  const accessToken = typeof args.response.access_token === 'string'
    ? args.response.access_token.trim()
    : '';
  if (!accessToken) throw new Error('OAuth token 响应缺少 access_token。');
  const tokenType = typeof args.response.token_type === 'string'
    ? args.response.token_type.trim()
    : 'Bearer';
  if (tokenType.toLowerCase() !== 'bearer') {
    throw new Error(`Polaris 暂不支持 OAuth token_type「${tokenType}」。`);
  }
  const refreshToken = typeof args.response.refresh_token === 'string'
    ? args.response.refresh_token
    : args.previousRefreshToken;
  const expiresIn = typeof args.response.expires_in === 'number'
    ? args.response.expires_in
    : typeof args.response.expires_in === 'string'
      ? Number(args.response.expires_in)
      : NaN;

  return {
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    tokenType,
    ...(Number.isFinite(expiresIn) && expiresIn > 0
      ? { expiresAt: Date.now() + Math.floor(expiresIn * 1000) }
      : {}),
    ...(typeof args.response.scope === 'string' ? { scope: args.response.scope } : {}),
    resource: args.resource,
    authorizationServer: args.authorizationServer,
    tokenEndpoint: args.tokenEndpoint,
    clientId: args.clientId
  };
}

function isExpired(token: McpOAuthTokenSet) {
  return token.expiresAt !== undefined && token.expiresAt <= Date.now() + TOKEN_EXPIRY_SKEW_MS;
}

function resourcesMatch(left: string, right: string) {
  const normalize = (value: string) => {
    const url = new URL(value);
    url.hash = '';
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  };
  return normalize(left) === normalize(right);
}

async function refreshToken(
  serverId: string,
  token: McpOAuthTokenSet,
  fetchImpl?: McpOAuthFetch
) {
  if (!token.refreshToken) return null;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: token.refreshToken,
    client_id: token.clientId,
    resource: token.resource
  });
  if (token.scope) body.set('scope', token.scope);
  const response = await requestOAuthToken({
    tokenEndpoint: token.tokenEndpoint,
    body,
    fetchImpl
  });
  const next = normalizeTokenResponse({
    response,
    resource: token.resource,
    authorizationServer: token.authorizationServer,
    tokenEndpoint: token.tokenEndpoint,
    clientId: token.clientId,
    previousRefreshToken: token.refreshToken
  });
  await writeMcpOAuthToken(serverId, next);
  return next;
}

export function getMcpOAuthAuthorizationRequest(
  error: unknown,
  server: Pick<McpServerConfig, 'id' | 'name' | 'url'>
): McpOAuthAuthorizationRequest | null {
  if (!(error instanceof McpHttpError) || error.status !== 401) {
    return null;
  }
  return {
    serverId: server.id,
    serverName: server.name,
    serverUrl: server.url,
    challenge: error.authorizationChallenge ?? { scheme: 'Bearer' }
  };
}

export async function beginMcpOAuthAuthorization(args: {
  server: McpServerConfig;
  challenge: McpAuthorizationChallenge;
  fetchImpl?: McpOAuthFetch;
  redirectUri?: string;
}): Promise<McpOAuthBeginResult> {
  const redirectUri = args.redirectUri ?? getMcpOAuthRedirectUri();
  const resourceMetadata = await discoverProtectedResource({
    server: args.server,
    challenge: args.challenge,
    fetchImpl: args.fetchImpl
  });
  const authorizationServer = await discoverAuthorizationServer(
    resourceMetadata.authorizationServers[0]!,
    args.fetchImpl
  );
  const clientId = args.server.oauthClientId?.trim()
    || (authorizationServer.registrationEndpoint
      ? await registerPublicClient({
          registrationEndpoint: authorizationServer.registrationEndpoint,
          redirectUri,
          fetchImpl: args.fetchImpl
        })
      : '');
  if (!clientId) {
    throw new Error('该授权服务器不支持动态客户端注册；请填写它为 Polaris 分配的 OAuth Client ID。');
  }

  const state = createOAuthRandomValue(32);
  const pkce = await createPkcePair();
  const scope = resolveScope(args.challenge, resourceMetadata.scopesSupported);
  await writeMcpOAuthPendingAuthorization({
    state,
    createdAt: Date.now(),
    serverId: args.server.id,
    serverUrl: args.server.url,
    resource: resourceMetadata.resource,
    authorizationServer: authorizationServer.issuer,
    tokenEndpoint: authorizationServer.tokenEndpoint,
    clientId,
    redirectUri,
    codeVerifier: pkce.verifier,
    ...(scope ? { scope } : {})
  });

  const authorizationUrl = new URL(authorizationServer.authorizationEndpoint);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('client_id', clientId);
  authorizationUrl.searchParams.set('redirect_uri', redirectUri);
  authorizationUrl.searchParams.set('state', state);
  authorizationUrl.searchParams.set('code_challenge', pkce.challenge);
  authorizationUrl.searchParams.set('code_challenge_method', 'S256');
  authorizationUrl.searchParams.set('resource', resourceMetadata.resource);
  if (scope) authorizationUrl.searchParams.set('scope', scope);

  return { authorizationUrl: authorizationUrl.toString(), state };
}

export async function completeMcpOAuthAuthorization(
  callbackUrl: string,
  fetchImpl?: McpOAuthFetch
): Promise<McpOAuthCompletionResult | null> {
  const url = new URL(callbackUrl);
  const isCallback = url.protocol === 'polaris:'
    ? url.hostname === 'mcp' && url.pathname === '/oauth/callback'
    : url.searchParams.get('mcp_oauth_callback') === '1';
  if (!isCallback) return null;

  const state = url.searchParams.get('state') ?? '';
  if (!state) throw new Error('OAuth 回调缺少 state。');
  const pending = await readMcpOAuthPendingAuthorization(state);
  if (!pending) throw new Error('OAuth 回调已失效或不属于这台设备。');
  await deleteMcpOAuthPendingAuthorization(state);
  if (Date.now() - pending.createdAt > AUTHORIZATION_LIFETIME_MS) {
    throw new Error('OAuth 授权已超时，请重新连接。');
  }
  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    const description = url.searchParams.get('error_description');
    throw new Error(`OAuth 授权失败：${description || oauthError}`);
  }
  const code = url.searchParams.get('code') ?? '';
  if (!code) throw new Error('OAuth 回调缺少 authorization code。');

  const response = await requestOAuthToken({
    tokenEndpoint: pending.tokenEndpoint,
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: pending.redirectUri,
      client_id: pending.clientId,
      code_verifier: pending.codeVerifier,
      resource: pending.resource
    }),
    fetchImpl
  });
  const token = normalizeTokenResponse({
    response,
    resource: pending.resource,
    authorizationServer: pending.authorizationServer,
    tokenEndpoint: pending.tokenEndpoint,
    clientId: pending.clientId
  });
  await writeMcpOAuthToken(pending.serverId, token);
  return { serverId: pending.serverId };
}

export function getMcpOAuthNativeRelayUrl(callbackUrl: string) {
  const url = new URL(callbackUrl);
  if (url.protocol !== 'https:' || url.searchParams.get('mcp_oauth_native') !== '1') {
    return null;
  }
  const relay = new URL('polaris://mcp/oauth/callback');
  ['code', 'state', 'error', 'error_description'].forEach((key) => {
    const value = url.searchParams.get(key);
    if (value) relay.searchParams.set(key, value);
  });
  return relay.searchParams.has('state') ? relay.toString() : null;
}

export async function getMcpOAuthStatus(serverId: string): Promise<McpOAuthStatus> {
  return await readMcpOAuthToken(serverId) ? 'connected' : 'disconnected';
}

export async function disconnectMcpOAuth(serverId: string) {
  await deleteMcpOAuthToken(serverId);
}

export async function getMcpOAuthAuthorizationHeader(
  server: Pick<McpServerConfig, 'id' | 'url'>,
  fetchImpl?: McpOAuthFetch
) {
  let token = await readMcpOAuthToken(server.id);
  if (!token) return null;
  if (!resourcesMatch(token.resource, server.url)) {
    await deleteMcpOAuthToken(server.id);
    return null;
  }
  if (isExpired(token)) {
    try {
      token = await refreshToken(server.id, token, fetchImpl);
    } catch {
      await deleteMcpOAuthToken(server.id);
      return null;
    }
  }
  return token ? `${token.tokenType} ${token.accessToken}` : null;
}

export async function withMcpOAuthHeader(
  server: McpServerConfig,
  fetchImpl?: McpOAuthFetch
) {
  if (server.headers.some((header) => header.key.trim().toLowerCase() === 'authorization')) {
    return server;
  }
  const authorization = await getMcpOAuthAuthorizationHeader(server, fetchImpl);
  if (!authorization) return server;
  return {
    ...server,
    headers: [
      ...server.headers,
      { id: 'oauth-authorization', key: 'Authorization', value: authorization }
    ]
  };
}

export async function refreshMcpOAuthAuthorization(
  serverId: string,
  fetchImpl?: McpOAuthFetch
) {
  const token = await readMcpOAuthToken(serverId);
  if (!token) return false;
  if (!token.refreshToken) {
    await deleteMcpOAuthToken(serverId);
    return false;
  }
  try {
    return Boolean(await refreshToken(serverId, token, fetchImpl));
  } catch {
    await deleteMcpOAuthToken(serverId);
    return false;
  }
}

export function dispatchMcpOAuthCompleted(result: McpOAuthCompletionResult) {
  globalThis.dispatchEvent(new CustomEvent(MCP_OAUTH_COMPLETED_EVENT, { detail: result }));
}

export function clearMcpOAuthCallbackFromWebUrl() {
  if (Capacitor.isNativePlatform() || typeof history === 'undefined') return;
  const url = new URL(globalThis.location.href);
  if (url.searchParams.get('mcp_oauth_callback') !== '1') return;
  ['mcp_oauth_callback', 'mcp_oauth_native', 'code', 'state', 'error', 'error_description'].forEach((key) => {
    url.searchParams.delete(key);
  });
  history.replaceState(history.state, '', url.toString());
}
