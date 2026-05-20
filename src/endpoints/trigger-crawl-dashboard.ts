import type { Endpoint } from 'payload';
import { triggerCrawl } from '../trigger-crawl';
import type { ReversiaPluginConfig } from '../types';

export function createTriggerCrawlDashboardEndpoint(pluginConfig: ReversiaPluginConfig): Endpoint {
  return {
    path: '/reversia/dashboard/trigger-crawl',
    method: 'post',
    handler: async (req) => {
      if (!req.user) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const body = req.json ? await req.json() : undefined;
      const types = Array.isArray((body as { types?: unknown })?.types)
        ? ((body as { types: unknown[] }).types.filter(
            (t): t is string => typeof t === 'string',
          ) as Array<never>)
        : undefined;
      const noCache = Boolean((body as { noCache?: unknown })?.noCache);

      try {
        const result = await triggerCrawl({
          apiKey: pluginConfig.apiKey,
          baseUrl: pluginConfig.baseUrl,
          ...(types && types.length > 0 ? { types } : {}),
          ...(noCache ? { noCache: true } : {}),
        });

        return Response.json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        req.payload.logger.error({
          msg: '[reversia] dashboard trigger-crawl failed',
          err: message,
        });
        return Response.json({ error: message }, { status: 502 });
      }
    },
  };
}
