function base64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function createOAuthRandomValue(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function createPkcePair() {
  const verifier = createOAuthRandomValue(64);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return {
    verifier,
    challenge: base64Url(new Uint8Array(digest))
  };
}
