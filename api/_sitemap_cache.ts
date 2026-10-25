export interface CachedSitemapPayload {
  isIndex: boolean;
  rootXml: string;
  partsXml: string[];
  generatedAt: number;
}

export type NewsSitemapCacheKey = 'all' | 'uk' | 'en';

export interface CachedNewsSitemapPayload {
  xml: string;
  generatedAt: number;
}

const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_NEWS_CACHE_TTL_MS = 15_000;

let cachedPayload: CachedSitemapPayload | null = null;
const cachedNewsPayloads = new Map<NewsSitemapCacheKey, CachedNewsSitemapPayload>();
let cacheVersion = 0;

export function getSitemapCacheVersion(): number {
  return cacheVersion;
}

export function getCachedSitemap(ttlMs: number = DEFAULT_CACHE_TTL_MS): CachedSitemapPayload | null {
  if (!cachedPayload) return null;
  if (Date.now() - cachedPayload.generatedAt > ttlMs) {
    cachedPayload = null;
    return null;
  }
  return cachedPayload;
}

export function setCachedSitemap(
  payload: Omit<CachedSitemapPayload, 'generatedAt'>,
  expectedVersion?: number
): void {
  if (expectedVersion !== undefined && expectedVersion !== cacheVersion) {
    return;
  }
  cachedPayload = {
    ...payload,
    generatedAt: Date.now(),
  };
}

export function getCachedNewsSitemap(
  key: NewsSitemapCacheKey = 'all',
  ttlMs: number = DEFAULT_NEWS_CACHE_TTL_MS
): CachedNewsSitemapPayload | null {
  const entry = cachedNewsPayloads.get(key);
  if (!entry) return null;
  if (Date.now() - entry.generatedAt > ttlMs) {
    cachedNewsPayloads.delete(key);
    return null;
  }
  return entry;
}

export function setCachedNewsSitemap(
  key: NewsSitemapCacheKey,
  xml: string,
  expectedVersion?: number
): void {
  if (expectedVersion !== undefined && expectedVersion !== cacheVersion) {
    return;
  }
  cachedNewsPayloads.set(key, {
    xml,
    generatedAt: Date.now(),
  });
}

export function invalidateSitemapCache(): void {
  cacheVersion += 1;
  cachedPayload = null;
  cachedNewsPayloads.clear();
}
