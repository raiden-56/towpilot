import type { Router } from 'express';
import { z } from 'zod';
import { createBookingInput } from './modules/bookings/service.js';

/**
 * OpenAPI 3.1 document generated from the mounted routers so it never drifts from the real
 * routes. Request schemas for the most important payloads are derived from the same Zod
 * schemas used for validation.
 */
const bodySchemas: Record<string, z.ZodType> = {
  'POST /bookings': createBookingInput,
  'POST /auth/otp/request': z.object({ phone: z.string().describe('Indian mobile, e.g. 9876543210 or +919876543210') }),
  'POST /auth/otp/verify': z.object({ phone: z.string(), code: z.string().length(6), fullName: z.string().optional(), acceptTerms: z.boolean().optional() }),
  'POST /auth/login': z.object({ email: z.string().email(), password: z.string() }),
  'POST /bookings/{id}/confirm': z.object({ quoteId: z.string() }),
  'POST /bookings/{id}/cancel': z.object({ reason: z.string(), acceptFee: z.boolean().optional() }),
  'POST /invoices/{id}/pay': z.object({ amount: z.number().optional().describe('Rupees; defaults to full outstanding') }),
  'POST /driver/location': z.object({ lat: z.number(), lng: z.number(), accuracyM: z.number().optional(), recordedAt: z.string() }),
  'POST /driver/jobs/{id}/transition': z.object({ to: z.string(), reason: z.string().optional() }),
};

const PUBLIC = [/^\/auth\/(otp|login|refresh|logout|password)/, /^\/public\//, /^\/catalog\//, /^\/webhooks\//, /^\/memberships\/plans/];

type Layer = { route?: { path: string; methods: Record<string, boolean> } };

export function buildOpenApi(mounts: [string, Router][]) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [prefix, router] of mounts) {
    const tag = prefix.split('/').filter(Boolean).slice(0, 2).join(' / ');
    for (const layer of (router as unknown as { stack: Layer[] }).stack) {
      if (!layer.route) continue;
      const path = (prefix + (layer.route.path === '/' ? '' : layer.route.path)).replace(/:(\w+)/g, '{$1}').replace(/\*(\w+)/g, '{$1}');
      for (const method of Object.keys(layer.route.methods)) {
        const key = `${method.toUpperCase()} ${path}`;
        const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
        const body = bodySchemas[key];
        (paths[path] ??= {})[method] = {
          tags: [tag],
          summary: key,
          parameters: params,
          ...(PUBLIC.some((r) => r.test(path)) ? { security: [] } : {}),
          ...(body ? { requestBody: { required: true, content: { 'application/json': { schema: z.toJSONSchema(body, { io: 'input', unrepresentable: 'any' }) } } } } : {}),
          responses: {
            '200': { description: 'Success — `{ data, meta? }`' },
            '400': { $ref: '#/components/responses/Error' },
            '401': { $ref: '#/components/responses/Error' },
            '403': { $ref: '#/components/responses/Error' },
            '404': { $ref: '#/components/responses/Error' },
            '409': { $ref: '#/components/responses/Error' },
          },
        };
      }
    }
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'TowPilot API',
      version: '1.0.0',
      description:
        'Versioned REST API for the TowPilot roadside assistance platform. All money values are integer paise unless an endpoint states rupees. Authenticate with `Authorization: Bearer <accessToken>`; refresh via the httpOnly cookie on POST /auth/refresh.',
    },
    servers: [{ url: '/api/v1' }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      responses: {
        Error: {
          description: 'Structured error',
          content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {}, requestId: { type: 'string' } } } } } } },
        },
      },
    },
    paths,
  };
}
