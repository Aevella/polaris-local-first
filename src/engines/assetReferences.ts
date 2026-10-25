const POLARIS_ASSET_URL_PATTERN = /polaris-asset:\/\/([^"')\s<>`\\,;，。！？、：；（）【】《》“”‘’{}\[\]]+)/g;
const PLACEHOLDER_ASSET_IDS = new Set(['...', 'assetId']);

function decodeAssetId(rawAssetId: string) {
  try {
    return decodeURIComponent(rawAssetId);
  } catch {
    return rawAssetId;
  }
}

export function extractPolarisAssetIds(text: string | undefined | null) {
  if (!text) return [];

  const ids = new Set<string>();
  for (const match of text.matchAll(POLARIS_ASSET_URL_PATTERN)) {
    const rawAssetId = match[1]?.trim();
    const assetId = rawAssetId ? decodeAssetId(rawAssetId) : '';
    if (assetId && !PLACEHOLDER_ASSET_IDS.has(assetId)) ids.add(assetId);
  }
  return Array.from(ids);
}

function replacePolarisAssetUrls(value: string, assetIdMap: ReadonlyMap<string, string>) {
  return value.replace(POLARIS_ASSET_URL_PATTERN, (match, rawId: string) => {
    const nextId = assetIdMap.get(decodeAssetId(rawId));
    return nextId ? `polaris-asset://${encodeURIComponent(nextId)}` : match;
  });
}

export function remapAssetReferences(value: unknown, assetIdMap: ReadonlyMap<string, string>, seen = new Map<object, unknown>()): unknown {
  if (typeof value === 'string') {
    return assetIdMap.get(value) ?? replacePolarisAssetUrls(value, assetIdMap);
  }
  if (!value || typeof value !== 'object') return value;
  const cached = seen.get(value);
  if (cached) return cached;
  if (Array.isArray(value)) {
    const next: unknown[] = [];
    seen.set(value, next);
    value.forEach((item) => next.push(remapAssetReferences(item, assetIdMap, seen)));
    return next;
  }
  const next: Record<string, unknown> = {};
  seen.set(value, next);
  for (const [key, item] of Object.entries(value)) {
    next[key] = remapAssetReferences(item, assetIdMap, seen);
  }
  return next;
}
