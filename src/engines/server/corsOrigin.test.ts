import { describe, expect, it } from 'vitest';
import { isAllowedPolarisApiOrigin } from './corsOrigin';

describe('isAllowedPolarisApiOrigin', () => {
  it('allows native and desktop app origins', () => {
    expect(isAllowedPolarisApiOrigin('capacitor://localhost')).toBe(true);
    expect(isAllowedPolarisApiOrigin('polaris://app')).toBe(true);
  });

  it('allows hosted preview origins', () => {
    expect(isAllowedPolarisApiOrigin('https://preview-user.vercel.app')).toBe(true);
  });

  it('rejects unrelated origins', () => {
    expect(isAllowedPolarisApiOrigin('https://polaris.example.com')).toBe(false);
    expect(isAllowedPolarisApiOrigin('https://example.com')).toBe(false);
  });
});

describe('deployer-owned API origins', () => {
  it('accepts the actual HTTPS request host without adding a global domain allowance', () => {
    expect(isAllowedPolarisApiOrigin('https://selfhost.example.test', 'selfhost.example.test')).toBe(true);
    expect(isAllowedPolarisApiOrigin('https://selfhost.example.test')).toBe(false);
    expect(isAllowedPolarisApiOrigin('https://other.example.test', 'selfhost.example.test')).toBe(false);
  });
  it.each(['http://selfhost.example.test', 'https://selfhost.example.test/path', 'https://user@selfhost.example.test'])('rejects non-origin or insecure same-host inputs: %s', (origin) => {
    expect(isAllowedPolarisApiOrigin(origin, 'selfhost.example.test')).toBe(false);
  });
});
