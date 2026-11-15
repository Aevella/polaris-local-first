import type { McpServerConfig } from '../../types/domain';
import type { McpAuthorizationChallenge } from '../mcp-transport/protocol';

export type McpOAuthTokenSet = {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt?: number;
  scope?: string;
  resource: string;
  authorizationServer: string;
  tokenEndpoint: string;
  clientId: string;
};

export type McpOAuthPendingAuthorization = {
  state: string;
  createdAt: number;
  serverId: string;
  serverUrl: string;
  resource: string;
  authorizationServer: string;
  tokenEndpoint: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  scope?: string;
};

export type McpOAuthAuthorizationRequest = {
  serverId: string;
  serverName: string;
  serverUrl: string;
  challenge: McpAuthorizationChallenge;
};

export type McpOAuthBeginResult = {
  authorizationUrl: string;
  state: string;
};

export type McpOAuthCompletionResult = {
  serverId: string;
};

export type McpOAuthStatus = 'connected' | 'disconnected';

export type McpOAuthFetch = typeof fetch;

export type McpOAuthServer = Pick<
  McpServerConfig,
  'id' | 'name' | 'url' | 'oauthClientId'
>;
