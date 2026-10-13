import { Container } from '@cloudflare/containers';

const REQUIRED = ['APP_URL', 'SOCIALBREWERY_MASTER_KEY', 'R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
const PASSED = [...REQUIRED, 'GITHUB_AUTH_CLIENT_ID', 'GITHUB_AUTH_CLIENT_SECRET', 'GOOGLE_AUTH_CLIENT_ID', 'GOOGLE_AUTH_CLIENT_SECRET'];

export class SocialbreweryContainer extends Container {
  defaultPort = 3847;
  // Long enough that a Grok run or an Instagram upload never outlives the container.
  sleepAfter = '30m';
  enableInternet = true;

  constructor(ctx, env) {
    super(ctx, env);
    const vars = { HOST: '0.0.0.0', PORT: '3847', SOCIALBREWERY_HOME: '/data' };
    for (const key of PASSED) if (env[key]) vars[key] = String(env[key]);
    this.envVars = vars;
  }

  onError(error) {
    console.error('Socialbrewery container error:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export default {
  async fetch(request, env) {
    const missing = REQUIRED.filter((key) => !env[key] || String(env[key]).includes('<'));
    if (missing.length) {
      return new Response(`Socialbrewery is not configured yet. Set: ${missing.join(', ')}`, {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
    return env.APP.getByName('main').fetch(request);
  },
};
