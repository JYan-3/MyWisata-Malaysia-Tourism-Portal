import type { Page } from '@playwright/test';

// In-page dark-mode audit. Reads the *computed* colours of everything on screen, so it
// finds surfaces and text that did not follow the theme however the CSS was written
// (hard-coded Tailwind palette classes, inline styles, third-party widgets).

export type LightSurface = { tag: string; className: string; text: string; x: number; y: number; w: number; h: number; bg: string; luminance: number };
export type LowContrast = { tag: string; className: string; text: string; ratio: number; fg: string; bg: string; size: number };
export type ThemeAudit = {
  url: string;
  htmlIsDark: boolean;
  bodyLuminance: number;
  lightSurfaces: LightSurface[];
  lowContrast: LowContrast[];
  elements: number;
};

export async function auditTheme(page: Page): Promise<ThemeAudit> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    const cache = new Map<string, { r: number; g: number; b: number; a: number }>();
    // Computed colours can come back as oklch()/color(); a 1x1 canvas turns any CSS colour into sRGB.
    const rgba = (css: string) => {
      const hit = cache.get(css);
      if (hit) return hit;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      const value = { r, g, b, a: a / 255 };
      cache.set(css, value);
      return value;
    };
    const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const hex = ({ r, g, b }: { r: number; g: number; b: number }) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;

    const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IMG', 'SVG', 'CANVAS', 'VIDEO', 'IFRAME', 'PICTURE', 'OPTION', 'PATH', 'USE', 'LINK', 'META']);
    const ignored = (el: Element) => {
      for (let node: Element | null = el; node; node = node.parentElement) {
        if (SKIP_TAGS.has(node.tagName.toUpperCase())) return true;
        if (node.namespaceURI === 'http://www.w3.org/2000/svg') return true;
        if (node.matches('.maplibregl-map, .maplibregl-canvas-container, [data-theme-audit-ignore], nextjs-portal, [data-nextjs-toast], [data-next-badge-root]')) return true;
      }
      return false;
    };
    const visible = (el: Element, rect: DOMRect) => {
      if (rect.width < 1 || rect.height < 1) return false;
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05;
    };

    // Effective background behind an element: composite the translucent layers up to the first opaque one.
    // Returns null when an image or gradient is involved (the real colour is unknowable here).
    const bgCache = new Map<Element, { r: number; g: number; b: number } | null>();
    const effectiveBg = (el: Element): { r: number; g: number; b: number } | null => {
      if (bgCache.has(el)) return bgCache.get(el) as { r: number; g: number; b: number } | null;
      const layers: Array<{ r: number; g: number; b: number; a: number }> = [];
      let unknown = false;
      for (let node: Element | null = el; node; node = node.parentElement) {
        const cs = getComputedStyle(node);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') { unknown = true; break; }
        const c = rgba(cs.backgroundColor);
        if (c.a > 0) { layers.push(c); if (c.a >= 0.99) break; }
      }
      let result: { r: number; g: number; b: number } | null = null;
      if (!unknown) {
        let base = { r: 255, g: 255, b: 255 };
        for (let i = layers.length - 1; i >= 0; i--) {
          const l = layers[i];
          base = { r: l.r * l.a + base.r * (1 - l.a), g: l.g * l.a + base.g * (1 - l.a), b: l.b * l.a + base.b * (1 - l.a) };
        }
        result = base;
      }
      bgCache.set(el, result);
      return result;
    };

    const all = Array.from(document.body.querySelectorAll('*')).filter((el) => !ignored(el));
    const lightSurfaces: Array<LightSurface & { el: Element }> = [];
    const contrast = new Map<string, LowContrast & { count: number }>();

    for (const el of all) {
      const rect = el.getBoundingClientRect();
      if (!visible(el, rect)) continue;
      const cs = getComputedStyle(el);

      // 1. A large, opaque, light surface in dark mode.
      const bg = rgba(cs.backgroundColor);
      const area = rect.width * rect.height;
      if (bg.a >= 0.85 && area >= 3000 && rect.width >= 40 && rect.height >= 24 && !(cs.backgroundImage && cs.backgroundImage !== 'none')) {
        const l = lum(bg);
        // Saturated brand accents (the yellow CTAs) are meant to stay bright; pale tints are what we hunt.
        const mx = Math.max(bg.r, bg.g, bg.b);
        const saturated = mx > 0 && (mx - Math.min(bg.r, bg.g, bg.b)) / mx > 0.6;
        if (l >= 0.55 && !saturated) {
          lightSurfaces.push({
            el, tag: el.tagName.toLowerCase(), className: String(el.getAttribute('class') ?? '').slice(0, 140), text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 50),
            x: Math.round(rect.x), y: Math.round(rect.y + window.scrollY), w: Math.round(rect.width), h: Math.round(rect.height), bg: hex(bg), luminance: Number(l.toFixed(2)),
          });
        }
      }

      // 2. Text with too little contrast against what is behind it.
      const hasOwnText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length >= 2);
      if (hasOwnText) {
        const back = effectiveBg(el);
        if (back) {
          const fgRaw = rgba(cs.color);
          const fg = { r: fgRaw.r * fgRaw.a + back.r * (1 - fgRaw.a), g: fgRaw.g * fgRaw.a + back.g * (1 - fgRaw.a), b: fgRaw.b * fgRaw.a + back.b * (1 - fgRaw.a) };
          const r = ratio(lum(fg), lum(back));
          if (r < 3) {
            const key = `${el.tagName}|${el.getAttribute('class')}|${hex(fg)}|${hex(back)}`;
            const hit = contrast.get(key);
            if (hit) hit.count += 1;
            else contrast.set(key, { tag: el.tagName.toLowerCase(), className: String(el.getAttribute('class') ?? '').slice(0, 140), text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 50), ratio: Number(r.toFixed(2)), fg: hex(fg), bg: hex(back), size: parseFloat(cs.fontSize), count: 1 });
          }
        }
      }
    }

    // Keep only the outermost light surface of each nested group.
    const flagged = new Set(lightSurfaces.map((s) => s.el));
    const outer = lightSurfaces.filter((s) => {
      for (let p = s.el.parentElement; p; p = p.parentElement) if (flagged.has(p)) return false;
      return true;
    }).map(({ el: _el, ...rest }) => rest);

    const bodyBg = effectiveBg(document.body);
    return {
      url: location.pathname + location.search,
      htmlIsDark: document.documentElement.classList.contains('dark'),
      bodyLuminance: bodyBg ? Number(lum(bodyBg).toFixed(3)) : -1,
      lightSurfaces: outer,
      lowContrast: Array.from(contrast.values()).sort((a, b) => a.ratio - b.ratio).slice(0, 40),
      elements: all.length,
    };
  });
}
