export const cvoaOrigins = new Set(['https://www.cvoa.one', 'https://cvoa.one']);
export const embedded = window.location.pathname.startsWith('/integrations/cvoa') && window.parent !== window;
export function trustedParent(event) {
  return embedded && event.source === window.parent && cvoaOrigins.has(event.origin) && event.data?.type === 'cvoa:schedlr-connect' && typeof event.data.accessToken === 'string';
}
