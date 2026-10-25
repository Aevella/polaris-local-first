import { describe, expect, it } from 'vitest';
import { extractPolarisAssetIds, remapAssetReferences } from './assetReferences';

describe('extractPolarisAssetIds', () => {
  it('extracts CSS and markup asset references without exposing surrounding text', () => {
    expect(extractPolarisAssetIds([
      'background: url("polaris-asset://asset-bg")',
      '<img src="polaris-asset://asset-inline">',
      'url(polaris-asset://asset%20encoded)',
      'imported id polaris-asset://kelivo-image-1'
    ].join('\n'))).toEqual(['asset-bg', 'asset-inline', 'asset encoded', 'kelivo-image-1']);
  });

  it('does not include escaped CSS delimiters in asset ids', () => {
    expect(extractPolarisAssetIds(
      'background-image: url(\\"polaris-asset://asset-1779094469797-jm3myl\\");'
    )).toEqual(['asset-1779094469797-jm3myl']);
  });

  it('ignores documentation placeholders that are not real asset ids', () => {
    expect(extractPolarisAssetIds([
      'polaris-asset://assetId 是示例，不是资产。',
      '常见写法是 url("polaris-asset://...")。',
      '也不要把 `polaris-asset://...` 后面的正文当成 id。',
      '中文句号后面停住：polaris-asset://assetId。',
      '中文逗号后面停住：polaris-asset://...，'
    ].join('\n'))).toEqual([]);
  });

  it('stops asset ids at common Chinese punctuation boundaries', () => {
    expect(extractPolarisAssetIds([
      '正文里的引用 polaris-asset://asset-real。',
      '另一个引用 polaris-asset://imported-id，后面是说明'
    ].join('\n'))).toEqual(['asset-real', 'imported-id']);
  });

  it('deduplicates repeated valid asset ids', () => {
    expect(extractPolarisAssetIds([
      'url("polaris-asset://asset-repeat")',
      'url(polaris-asset://asset-repeat)',
      'polaris-asset://asset-other'
    ].join('\n'))).toEqual(['asset-repeat', 'asset-other']);
  });
});


describe('remapAssetReferences', () => {
  it('shares reference rewriting across overlay and structured imports without changing source values', () => {
    const source = { assetId: 'old id', content: '<img src="polaris-asset://old%20id">', nested: [{ backgroundAssetId: 'old id' }], text: 'ordinary text' };
    expect(remapAssetReferences(source, new Map([['old id', 'new-id']]))).toEqual({
      assetId: 'new-id', content: '<img src="polaris-asset://new-id">', nested: [{ backgroundAssetId: 'new-id' }], text: 'ordinary text'
    });
    expect(source.assetId).toBe('old id');
  });
});
