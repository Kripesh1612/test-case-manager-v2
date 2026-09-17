import { z } from 'zod';
import { structurallySafeUrl } from '../../utils/webhooks.js';

export const WEBHOOK_EVENTS = ['suite.run.completed'];

export const webhookSchema = z.object({
  url: z.string()
    .url('url must be an absolute http(s) URL')
    .max(2000)
    // SSRF structural guard: rejects non-http(s) schemes and any URL
    // whose hostname is a literal IPv4/IPv6 in the private/reserved
    // range. DNS-rebinding is caught at delivery time by
    // `assertUrlSafeAtDelivery`; here we just refuse to persist
    // obviously-bad URLs up front.
    .refine((u) => structurallySafeUrl(u) === null, {
      message: 'url must be an absolute http(s) URL pointing at a public address',
    }),
  secret: z.string().max(500).optional().default(''),
  event: z.enum(WEBHOOK_EVENTS).optional().default('suite.run.completed'),
  enabled: z.boolean().optional().default(true),
});

export const webhookUpdateSchema = webhookSchema.partial();