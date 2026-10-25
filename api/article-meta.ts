import fs from 'fs';
import path from 'path';
import { getArticles } from './articles.ts';
import { initResponseHelpers } from './_helpers.ts';
import {
  SITE_NAME,
  SITE_DOMAIN,
  JSON_LD_SCRIPT_ID,
  getArticleSeoDescription,
  getArticleImageUrl,
  getArticleStructuredImageUrl,
  resolveArticlePublishedIso,
  resolveArticleModifiedIso,
  hasPublishedEnglishVersion,
  hasPublishedUkrainianVersion,
  isArticleExcerptVisible,
  buildArticleJsonLd,
  serializeJsonLd,
  stripHtml,
} from '../src/utils/seo.ts';

function escapeHtml(input?: string): string {
  if (!input) return '';
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Шляхи пошуку базового index.html залежно від середовища (production/Vercel vs dev)
function getBaseHtml(): string {
  const isProd = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
  const possiblePaths = isProd
    ? [
        path.join(process.cwd(), 'dist', 'index.html'),
        path.resolve('dist/index.html'),
        path.join(process.cwd(), 'index.html'),
        path.resolve('index.html'),
      ]
    : [
        path.join(process.cwd(), 'index.html'),
        path.resolve('index.html'),
        path.join(process.cwd(), 'dist', 'index.html'),
        path.resolve('dist/index.html'),
      ];

  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        if (content && content.includes('<html')) {
          return content;
        }
      }
    } catch {}
  }

  return `<!doctype html>
<html lang="uk" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(SITE_NAME)}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;
}

function isEnglishQueryRequested(req: any): boolean {
  if (req?.query?.lang === 'en') return true;
  if (typeof req?.url === 'string' && req.url.includes('?')) {
    try {
      const parsed = new URL(req.url, SITE_DOMAIN);
      return parsed.searchParams.get('lang') === 'en';
    } catch {}
  }
  return false;
}

export default async function handler(req: any, res: any) {
  initResponseHelpers(res);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  // Отримання ID статті з params (Express), query (Vercel) або URL
  const paramId = req.params?.id;
  const queryId = req.query?.id;
  let articleId = paramId ? String(paramId).trim() : queryId ? String(queryId).trim() : null;

  if (!articleId && req.url) {
    const match = req.url.match(/\/article\/([^?#/]+)/i);
    if (match) {
      articleId = decodeURIComponent(match[1]);
    }
  }

  const rawBaseHtml = getBaseHtml();

  const injectHead = (html: string, headContent: string) => {
    if (html.includes('</head>')) {
      return html.replace('</head>', `${headContent}\n</head>`);
    }
    if (html.includes('<body')) {
      return html.replace('<body', `${headContent}\n</head>\n<body`);
    }
    return `${headContent}\n${html}`;
  };

  // Видаляємо дефолтні мета-теги та будь-які попередні блоки application/ld+json, щоб уникнути дублювання
  const cleanDefaultTags = (html: string) => {
    return html
      .replace(/<meta\s+name=["']description["'][^>]*>/gi, '')
      .replace(/<meta\s+property=["']og:[^"']*["'][^>]*>/gi, '')
      .replace(/<meta\s+name=["']twitter:[^"']*["'][^>]*>/gi, '')
      .replace(/<link\s+rel=["']canonical["'][^>]*>/gi, '')
      .replace(/<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, '');
  };

  if (!articleId) {
    const notFoundHtml = injectHead(
      cleanDefaultTags(rawBaseHtml).replace(
        /<title>[\s\S]*?<\/title>/i,
        `<title>Матеріал не знайдено — ${escapeHtml(SITE_NAME)}</title>`
      ),
      '<meta name="robots" content="noindex, nofollow" />\n    <meta name="description" content="Запитуваний матеріал не знайдено або він є чернеткою." />'
    );
    return res.status(404).send(notFoundHtml);
  }

  try {
    const allArticles = await getArticles();
    const article = allArticles.find((a) => String(a.id) === String(articleId));

    const pubUa = article ? hasPublishedUkrainianVersion(article) : false;
    const pubEn = article ? hasPublishedEnglishVersion(article) : false;

    // Якщо статті не існує або жодна мовна версія не опублікована публічно
    if (!article || (!pubUa && !pubEn)) {
      const notFoundHtml = injectHead(
        cleanDefaultTags(rawBaseHtml).replace(
          /<title>[\s\S]*?<\/title>/i,
          `<title>Матеріал не знайдено — ${escapeHtml(SITE_NAME)}</title>`
        ),
        '<meta name="robots" content="noindex, nofollow" />\n    <meta name="description" content="Запитуваний матеріал не знайдено або він є чернеткою." />'
      );
      return res.status(404).send(notFoundHtml);
    }

    // Мова визначається явно за параметром URL (?lang=en) або наявністю відповідної опублікованої версії
    const requestedEn = isEnglishQueryRequested(req);
    const effectiveIsEn = (requestedEn && pubEn) || (!pubUa && pubEn);

    const cleanTitle = stripHtml(effectiveIsEn ? article.titleEn : article.title) || SITE_NAME;
    const fullTitle = `${cleanTitle} — ${SITE_NAME}`;
    const description = getArticleSeoDescription(article, effectiveIsEn);
    const baseArticleUrl = `${SITE_DOMAIN}/article/${encodeURIComponent(article.id)}`;
    const canonicalUrl = effectiveIsEn && pubUa ? `${baseArticleUrl}?lang=en` : baseArticleUrl;
    const ogImageUrl = getArticleImageUrl(article);
    const structuredImageUrl = getArticleStructuredImageUrl(article);
    const lang = effectiveIsEn ? 'en' : 'uk';

    // Фактичні дати з БД у форматі ISO 8601 (без підстановки поточного часу відкриття сторінки)
    const publishedTime = resolveArticlePublishedIso(article);
    const modifiedTime = resolveArticleModifiedIso(article, publishedTime);
    const cleanAuthor = stripHtml(article.author);
    const section =
      stripHtml(effectiveIsEn ? (article.categoryEn || article.category) : article.category) ||
      (effectiveIsEn ? 'Articles' : 'Статті');

    const metaTags = [
      `<title>${escapeHtml(fullTitle)}</title>`,
      `<meta name="description" content="${escapeHtml(description)}" />`,
      `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`,
      `<meta name="robots" content="index, follow" />`,
      `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />`,
      `<meta property="og:type" content="article" />`,
      `<meta property="og:title" content="${escapeHtml(fullTitle)}" />`,
      `<meta property="og:description" content="${escapeHtml(description)}" />`,
      `<meta property="og:url" content="${escapeHtml(canonicalUrl)}" />`,
      `<meta property="og:image" content="${escapeHtml(ogImageUrl)}" />`,
    ];

    if (publishedTime) {
      metaTags.push(`<meta property="article:published_time" content="${escapeHtml(publishedTime)}" />`);
    }
    if (modifiedTime) {
      metaTags.push(`<meta property="article:modified_time" content="${escapeHtml(modifiedTime)}" />`);
    }
    if (cleanAuthor) {
      metaTags.push(`<meta property="article:author" content="${escapeHtml(cleanAuthor)}" />`);
    }
    if (section) {
      metaTags.push(`<meta property="article:section" content="${escapeHtml(section)}" />`);
    }

    metaTags.push(
      `<meta name="twitter:card" content="summary_large_image" />`,
      `<meta name="twitter:title" content="${escapeHtml(fullTitle)}" />`,
      `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
      `<meta name="twitter:image" content="${escapeHtml(ogImageUrl)}" />`
    );

    // Hreflang alternates: додаються виключно якщо існують обидві опубліковані версії
    if (pubUa && pubEn) {
      metaTags.push(`<link rel="alternate" hreflang="uk" href="${escapeHtml(baseArticleUrl)}" />`);
      metaTags.push(`<link rel="alternate" hreflang="en" href="${escapeHtml(`${baseArticleUrl}?lang=en`)}" />`);
      metaTags.push(`<link rel="alternate" hreflang="x-default" href="${escapeHtml(baseArticleUrl)}" />`);
    }

    // Структуровані дані Schema.org JSON-LD (NewsArticle для новин / Article для інших публікацій)
    const articleJsonLd = buildArticleJsonLd(article, effectiveIsEn);
    if (articleJsonLd) {
      metaTags.push(
        `<script id="${JSON_LD_SCRIPT_ID}" type="application/ld+json">\n${serializeJsonLd(articleJsonLd)}\n    </script>`
      );
    }

    let modifiedHtml = cleanDefaultTags(rawBaseHtml)
      .replace(/<html[^>]*lang=["'][^"']*["']/i, `<html lang="${lang}"`)
      .replace(/<title>[\s\S]*?<\/title>/i, '');

    modifiedHtml = injectHead(modifiedHtml, `    ${metaTags.join('\n    ')}`);

    // Семантичний noscript-блок із фактичним видимим вмістом матеріалу
    const rawBody = effectiveIsEn ? article.contentEn : article.content;
    const rawExcerpt = effectiveIsEn ? article.excerptEn : article.excerpt;
    const showExcerpt = isArticleExcerptVisible(article, effectiveIsEn);
    const cleanExcerpt = showExcerpt ? stripHtml(rawExcerpt) : '';

    const noscriptParts = [
      `<h1>${escapeHtml(cleanTitle)}</h1>`,
      cleanAuthor || publishedTime
        ? `<p>${cleanAuthor ? `<span>${escapeHtml(cleanAuthor)}</span>` : ''}${
            cleanAuthor && publishedTime ? ' • ' : ''
          }${publishedTime ? `<time datetime="${escapeHtml(publishedTime)}">${escapeHtml(article.date || publishedTime)}</time>` : ''}</p>`
        : '',
      structuredImageUrl
        ? `<img src="${escapeHtml(structuredImageUrl)}" alt="${escapeHtml(cleanTitle)}" />`
        : '',
      cleanExcerpt ? `<p><strong>${escapeHtml(cleanExcerpt)}</strong></p>` : '',
      `<div>${escapeHtml(stripHtml(rawBody || ''))}</div>`,
    ].filter(Boolean);

    const noscriptContent = `\n    <noscript>\n      <article>\n        ${noscriptParts.join('\n        ')}\n      </article>\n    </noscript>`;
    modifiedHtml = modifiedHtml.replace('</body>', `${noscriptContent}\n  </body>`);

    return res.status(200).send(modifiedHtml);
  } catch (err: any) {
    console.error('Error generating article SEO HTML:', err);
    return res.status(200).send(rawBaseHtml);
  }
}
