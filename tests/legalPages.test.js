import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pages = ['privacy.html', 'terms.html'];

function matches(source, expression) {
  return [...source.matchAll(expression)].map((match) => match[1]);
}

describe.each(pages)('public/%s', (name) => {
  const html = readFileSync(path.join(root, 'public', name), 'utf8');

  it('has balanced document landmarks and bilingual sections', () => {
    expect(html).toMatch(/^<!doctype html>/i);
    for (const tag of ['html', 'head', 'body', 'main', 'article', 'section', 'nav', 'footer']) {
      const openings = (html.match(new RegExp(`<${tag}(?:\\s|>)`, 'g')) || []).length;
      const closings = (html.match(new RegExp(`</${tag}>`, 'g')) || []).length;
      expect(openings, `${tag} opening/closing count`).toBe(closings);
    }
    expect(html).toContain('id="english" lang="en"');
    expect(html).toContain('id="russian" lang="ru"');
    expect(html).toContain('<time datetime="2026-07-27">2026-07-27</time>');
  });

  it('has unique fragments and valid internal links', () => {
    const ids = matches(html, /\sid="([^"]+)"/g);
    expect(new Set(ids).size).toBe(ids.length);

    for (const href of matches(html, /\shref="([^"]+)"/g)) {
      if (href.startsWith('#')) expect(ids).toContain(href.slice(1));
      if (href.startsWith('/')) {
        const target = href === '/'
          ? path.join(root, 'index.html')
          : path.join(root, 'public', href.slice(1));
        expect(existsSync(target), `missing internal link ${href}`).toBe(true);
      }
    }
  });

  it('uses only the disclosed operator identity and contact', () => {
    expect(html).toContain('Strategy Architect Pro');
    expect(html).toContain('https://t.me/djordano0');
    expect(html).not.toMatch(/\b(?:LLC|Inc\.|Ltd\.|ООО|ИП)\b/);
    expect(html).not.toMatch(/(?:street|postal|юридический|почтовый)\s+address/i);
    expect(html).not.toMatch(/mailto:/i);
  });
});
