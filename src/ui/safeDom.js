const HTML_CHARS = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_CHARS[ch]);
}

export const escapeAttr = escapeHtml;

export function safeExternalUrl(value, { allowedHosts = [] } = {}) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:') return null;
    if (allowedHosts.length && !allowedHosts.includes(url.hostname.toLowerCase())) return null;
    return url.href;
  } catch {
    return null;
  }
}
