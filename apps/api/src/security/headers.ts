import type { FastifyReply } from 'fastify';

/** API 只回 JSON，CSP 收得比网页更紧。 */
export const API_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
};

export function applySecurityHeaders(reply: FastifyReply): void {
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
    reply.header(name, value);
  }
}