import fs from "node:fs";
import path from "node:path";

const PUBLIC_PATHS = ["/", "/rules", "/privacy", "/cookies"];

const PAGE_META = {
  "/": {
    title: "Live to see it - пиксельная браузерная игра на выживание",
    description:
      "Live to see it - браузерная пиксельная игра, где каждый участник отмечает, что он жив, ходит по бесконечному полю и борется за финал.",
    type: "website",
    indexed: true,
    schema: "news"
  },
  "/cookies": {
    title: "Cookie - Live to see it",
    description: "Какие необходимые cookie использует Live to see it для входа и сохранения игровой сессии.",
    type: "article",
    indexed: true,
    schema: "article"
  },
  "/rules": {
    title: "Правила игры - Live to see it",
    description:
      "Правила Live to see it: регистрация, взнос до старта, ежедневная отметка Я живой, банк, финиш и победители.",
    type: "article",
    indexed: true,
    schema: "article"
  },
  "/privacy": {
    title: "Политика конфиденциальности - Live to see it",
    description:
      "Как Live to see it обрабатывает email, cookie, игровые данные, платежные статусы и запросы пользователей.",
    type: "article",
    indexed: true,
    schema: "article"
  },
  "/admon": {
    title: "Live to see it",
    description: "Закрытая панель Live to see it.",
    type: "website",
    indexed: false,
    schema: null
  }
};

export function getPageMeta(pathname) {
  return PAGE_META[normalizePath(pathname)] || PAGE_META["/"];
}

export function renderRobots(origin) {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admon",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    ""
  ].join("\n");
}

export function renderSitemap(origin, lastModified) {
  const lastmod = lastModified.toISOString();
  const urls = PUBLIC_PATHS.map((pathname) => {
    const loc = `${origin}${pathname === "/" ? "/" : pathname}`;
    return [
      "  <url>",
      `    <loc>${escapeXml(loc)}</loc>`,
      `    <lastmod>${lastmod}</lastmod>`,
      '    <changefreq>weekly</changefreq>',
      '    <priority>0.8</priority>',
      `    <xhtml:link rel="alternate" hreflang="ru" href="${escapeXml(loc)}" />`,
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(loc)}" />`,
      "  </url>"
    ].join("\n");
  }).join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    urls,
    "</urlset>",
    ""
  ].join("\n");
}

export function renderHtmlWithSeo(html, { origin, pathname, lastModified }) {
  const meta = getPageMeta(pathname);
  const canonicalPath = normalizePath(pathname);
  const canonicalUrl = `${origin}${canonicalPath === "/" ? "/" : canonicalPath}`;
  const imageUrl = `${origin}/og-image.svg`;
  const robots = meta.indexed ? "index,follow" : "noindex,nofollow,noarchive";
  const jsonLd = renderJsonLd({ meta, origin, canonicalUrl, imageUrl, lastModified });

  const tags = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<meta name="robots" content="${robots}" />`,
    `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`,
    `<link rel="alternate" hreflang="ru" href="${escapeHtml(canonicalUrl)}" />`,
    `<link rel="alternate" hreflang="x-default" href="${escapeHtml(canonicalUrl)}" />`,
    `<meta property="og:locale" content="ru_RU" />`,
    `<meta property="og:type" content="${meta.type}" />`,
    `<meta property="og:site_name" content="Live to see it" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonicalUrl)}" />`,
    `<meta property="og:image" content="${escapeHtml(imageUrl)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />`,
    jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ""
  ].filter(Boolean).join("\n    ");

  return html
    .replace(/<title>.*?<\/title>/, "")
    .replace(/<meta name="description"[^>]*>\s*/g, "")
    .replace(/<meta property="og:[^"]+"[^>]*>\s*/g, "")
    .replace(/<meta name="twitter:[^"]+"[^>]*>\s*/g, "")
    .replace("<!-- SEO_HEAD -->", tags);
}

export function getLastModified(distPath) {
  const candidates = [
    path.join(distPath, "index.html"),
    path.join(process.cwd(), "client", "src", "main.jsx"),
    path.join(process.cwd(), "client", "src", "styles.css")
  ];
  const timestamps = candidates
    .filter((file) => fs.existsSync(file))
    .map((file) => fs.statSync(file).mtimeMs);

  return new Date(Math.max(...timestamps, Date.now()));
}

export function publicOrigin(req) {
  const configured = process.env.SITE_URL || process.env.APP_URL;
  if (configured) return configured.replace(/\/$/, "");
  return `${req.protocol}://${req.get("host")}`;
}

export function normalizePath(pathname) {
  const clean = pathname.replace(/\/$/, "") || "/";
  return PAGE_META[clean] ? clean : "/";
}

function renderJsonLd({ meta, origin, canonicalUrl, imageUrl, lastModified }) {
  const base = {
    headline: meta.title,
    description: meta.description,
    inLanguage: "ru-RU",
    url: canonicalUrl,
    image: imageUrl,
    datePublished: "2026-06-14T00:00:00.000Z",
    dateModified: lastModified.toISOString(),
    author: {
      "@type": "Organization",
      name: "Live to see it"
    },
    publisher: {
      "@type": "Organization",
      name: "Live to see it",
      logo: {
        "@type": "ImageObject",
        url: `${origin}/favicon.svg`
      }
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": canonicalUrl
    }
  };

  if (meta.schema === "news") {
    return {
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      ...base
    };
  }

  if (meta.schema === "article") {
    return {
      "@context": "https://schema.org",
      "@type": "Article",
      ...base
    };
  }

  return null;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeXml(value) {
  return escapeHtml(value).replaceAll("'", "&apos;");
}
