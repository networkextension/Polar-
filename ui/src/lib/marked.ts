declare global {
  interface Window {
    marked?: {
      parse(input: string, options?: Record<string, unknown>): string;
      use?(...extensions: Array<Record<string, unknown>>): void;
      Renderer?: new () => Record<string, unknown>;
    };
    __markedConfigured?: boolean;
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[\s]+/g, "-")
    .replace(/[^\p{L}\p{N}\-_]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function configureMarked(): void {
  const marked = window.marked;
  if (!marked || window.__markedConfigured) {
    return;
  }
  if (typeof marked.use !== "function") {
    return;
  }

  const usedSlugs = new Map<string, number>();

  marked.use({
    gfm: true,
    breaks: true,
    pedantic: false,
    renderer: {
      // Force external links to open in a new tab and add safe rel attrs.
      link(this: unknown, hrefOrToken: unknown, titleOrUndefined?: unknown, textOrUndefined?: unknown): string {
        let href = "";
        let title: string | null = null;
        let text = "";
        if (typeof hrefOrToken === "object" && hrefOrToken !== null) {
          // marked v5+ passes a token object
          const token = hrefOrToken as { href?: string; title?: string | null; text?: string; tokens?: unknown[] };
          href = token.href || "";
          title = token.title ?? null;
          // Try to use the parser's inline rendering if available; fall back to text.
          const parser = (this as { parser?: { parseInline?: (tokens: unknown[]) => string } } | undefined)?.parser;
          if (token.tokens && parser?.parseInline) {
            text = parser.parseInline(token.tokens);
          } else {
            text = token.text || "";
          }
        } else {
          href = String(hrefOrToken || "");
          title = (titleOrUndefined as string | null) ?? null;
          text = String(textOrUndefined || "");
        }
        const safeHref = href.replace(/"/g, "&quot;");
        const titleAttr = title ? ` title="${title.replace(/"/g, "&quot;")}"` : "";
        const isExternal = /^https?:\/\//i.test(href);
        const relAttr = isExternal ? ' target="_blank" rel="noopener noreferrer"' : "";
        return `<a href="${safeHref}"${titleAttr}${relAttr}>${text}</a>`;
      },
      heading(this: unknown, textOrToken: unknown, levelMaybe?: unknown): string {
        let text = "";
        let level = 1;
        let raw = "";
        if (typeof textOrToken === "object" && textOrToken !== null) {
          const token = textOrToken as { text?: string; depth?: number; tokens?: unknown[] };
          level = token.depth || 1;
          raw = token.text || "";
          const parser = (this as { parser?: { parseInline?: (tokens: unknown[]) => string } } | undefined)?.parser;
          if (token.tokens && parser?.parseInline) {
            text = parser.parseInline(token.tokens);
          } else {
            text = raw;
          }
        } else {
          text = String(textOrToken || "");
          level = Number(levelMaybe) || 1;
          raw = text.replace(/<[^>]+>/g, "");
        }
        let slug = slugify(raw);
        if (slug) {
          const used = usedSlugs.get(slug) || 0;
          usedSlugs.set(slug, used + 1);
          if (used > 0) {
            slug = `${slug}-${used}`;
          }
        }
        const idAttr = slug ? ` id="${slug}"` : "";
        return `<h${level}${idAttr}>${text}</h${level}>\n`;
      },
    },
  });

  window.__markedConfigured = true;
}

// Strip <script>, <style>, <iframe>, and inline event handlers from rendered
// HTML to mitigate XSS in user-supplied markdown.
function sanitizeHtml(html: string): string {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return html;
  }
  const doc = new DOMParser().parseFromString(`<div id="__md_root">${html}</div>`, "text/html");
  const root = doc.getElementById("__md_root");
  if (!root) {
    return html;
  }
  const dangerousTags = ["script", "style", "iframe", "object", "embed", "link", "meta"];
  dangerousTags.forEach((tag) => {
    root.querySelectorAll(tag).forEach((el) => el.remove());
  });
  root.querySelectorAll("*").forEach((el) => {
    Array.from(el.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
        return;
      }
      if ((name === "href" || name === "src") && /^\s*javascript:/i.test(value)) {
        el.removeAttribute(attr.name);
      }
    });
  });
  return root.innerHTML;
}

export function renderMarkdown(input: string): string {
  if (!input) {
    return "";
  }
  if (!window.marked) {
    return input;
  }
  configureMarked();
  try {
    const html = window.marked.parse(input);
    return sanitizeHtml(typeof html === "string" ? html : String(html));
  } catch {
    return input;
  }
}

// Plain-text raw view that preserves the original markdown source. The DOM
// caller is responsible for placing the returned string inside a <pre>.
export function escapeForRaw(input: string): string {
  return (input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export {};
