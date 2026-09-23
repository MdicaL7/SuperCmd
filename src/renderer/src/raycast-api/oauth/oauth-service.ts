/**
 * raycast-api/oauth/oauth-service.ts
 * Purpose: OAuthService public class with built-in provider factory methods.
 */

import { PKCEClientCompat } from './oauth-client';
import { OAuthServiceCore } from './oauth-service-core';
import type { OAuthServiceOptions } from './oauth-types';

type OAuthFactoryOptions = {
  clientId?: string;
  scope: string;
  personalAccessToken?: string;
  authorize?: () => Promise<string>;
  onAuthorize?: OAuthServiceOptions['onAuthorize'];
};

export class OAuthService extends OAuthServiceCore {
  constructor(options: OAuthServiceOptions) {
    super(options);
  }

  static linear(options: OAuthFactoryOptions): OAuthService {
    const client = new PKCEClientCompat({
      providerId: 'linear',
      providerName: 'Linear',
      providerIcon: 'linear-app-icon.png',
      description: 'Connect your Linear account',
    });

    return new OAuthService({
      client,
      clientId: options.clientId || '',
      scope: options.scope,
      authorizeUrl: 'https://linear.app/oauth/authorize',
      tokenUrl: 'https://api.linear.app/oauth/token',
      personalAccessToken: options.personalAccessToken,
      authorize: options.authorize,
      onAuthorize: options.onAuthorize,
    });
  }

  static spotify(options: OAuthFactoryOptions): OAuthService {
    const client = new PKCEClientCompat({
      providerId: 'spotify',
      providerName: 'Spotify',
      providerIcon: 'spotify-icon.png',
      description: 'Connect your Spotify account',
    });

    return new OAuthService({
      client,
      clientId: options.clientId || '',
      scope: options.scope,
      authorizeUrl: 'https://accounts.spotify.com/authorize',
      tokenUrl: 'https://accounts.spotify.com/api/token',
      personalAccessToken: options.personalAccessToken,
      authorize: options.authorize,
      onAuthorize: options.onAuthorize,
    });
  }

  static github(options: OAuthFactoryOptions): OAuthService {
    const client = new PKCEClientCompat({ providerId: 'github', providerName: 'GitHub', providerIcon: 'github-icon.png', description: 'Connect your GitHub account' });
    return new OAuthService({
      client,
      clientId: options.clientId || '',
      scope: options.scope,
      authorizeUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      personalAccessToken: options.personalAccessToken,
      authorize: options.authorize,
      onAuthorize: options.onAuthorize,
    });
  }

  static google(options: OAuthFactoryOptions & { clientId: string }): OAuthService {
    const client = new PKCEClientCompat({ providerId: 'google', providerName: 'Google', providerIcon: 'google-icon.png', description: 'Connect your Google account' });
    return new OAuthService({
      client,
      clientId: options.clientId,
      scope: options.scope,
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      personalAccessToken: options.personalAccessToken,
      authorize: options.authorize,
      onAuthorize: options.onAuthorize,
    });
  }

  static asana(options: OAuthFactoryOptions): OAuthService {
    const client = new PKCEClientCompat({ providerId: 'asana', providerName: 'Asana', providerIcon: 'asana-icon.png', description: 'Connect your Asana account' });
    return new OAuthService({
      client,
      clientId: options.clientId || '',
      scope: options.scope,
      authorizeUrl: 'https://app.asana.com/-/oauth_authorize',
      tokenUrl: 'https://app.asana.com/-/oauth_token',
      personalAccessToken: options.personalAccessToken,
      authorize: options.authorize,
      onAuthorize: options.onAuthorize,
    });
  }

  static slack(options: OAuthFactoryOptions): OAuthService {
    const client = new PKCEClientCompat({ providerId: 'slack', providerName: 'Slack', providerIcon: 'slack-icon.png', description: 'Connect your Slack account' });
    return new OAuthService({
      client,
      clientId: options.clientId || '',
      scope: options.scope,
      authorizeUrl: 'https://slack.com/oauth/v2/authorize',
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
      personalAccessToken: options.personalAccessToken,
      authorize: options.authorize,
      onAuthorize: options.onAuthorize,
    });
  }

  static jira(options: OAuthFactoryOptions): OAuthService {
    const client = new PKCEClientCompat({ providerId: 'jira', providerName: 'Jira', providerIcon: 'jira-icon.png', description: 'Connect your Jira account' });
    return new OAuthService({
      client,
      clientId: options.clientId || '',
      scope: options.scope,
      authorizeUrl: 'https://auth.atlassian.com/authorize',
      tokenUrl: 'https://auth.atlassian.com/oauth/token',
      personalAccessToken: options.personalAccessToken,
      authorize: options.authorize,
      onAuthorize: options.onAuthorize,
    });
  }

  static zoom(options: OAuthFactoryOptions & { clientId: string }): OAuthService {
    const client = new PKCEClientCompat({ providerId: 'zoom', providerName: 'Zoom', providerIcon: 'zoom-icon.png', description: 'Connect your Zoom account' });
    return new OAuthService({
      client,
      clientId: options.clientId,
      scope: options.scope,
      authorizeUrl: 'https://zoom.us/oauth/authorize',
      tokenUrl: 'https://zoom.us/oauth/token',
      personalAccessToken: options.personalAccessToken,
      authorize: options.authorize,
      onAuthorize: options.onAuthorize,
    });
  }
}
