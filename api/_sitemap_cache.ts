export interface CachedSitemapPayload {
  isIndex: boolean;
  rootXml: string;
  partsXml: string[];
  generatedAt: number;
}

const DEFAULT_CACHE_TTL_MS = 30_000;

let cachedPayload: CachedSitemapPayload | null = null;
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

export function invalidateSitemapCache(): void {
  cacheVersion += 1;
  cachedPayload = null;
}
