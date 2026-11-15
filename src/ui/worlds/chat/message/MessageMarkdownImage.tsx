import { useState } from 'react';

type MessageMarkdownImageProps = {
  alt: string;
  src: string;
};

export function resolveMarkdownImageUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Providers may return the image itself inside Markdown instead of a URL.
  // Keep active document formats (such as SVG/HTML) outside this image path.
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon);base64,[a-z\d+/=\s]+$/i.test(trimmed)) {
    return trimmed.replace(/\s/g, '');
  }

  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function MessageMarkdownImage({ alt, src }: MessageMarkdownImageProps) {
  const safeSrc = resolveMarkdownImageUrl(src);
  const label = alt.trim() || safeSrc || src;
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');

  if (!safeSrc) {
    return <span className="message-markdown-image-unsafe">{label}</span>;
  }

  if (state === 'failed') {
    return (
      <a
        className="message-markdown-image-fallback"
        href={safeSrc}
        target="_blank"
        rel="noreferrer"
      >
        {label}
      </a>
    );
  }

  return (
    <a
      className={`message-markdown-image-link is-${state}`}
      href={safeSrc}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      title={label}
    >
      {state === 'loading' ? <span className="message-markdown-image-placeholder" aria-hidden="true" /> : null}
      <img
        className="message-markdown-image"
        src={safeSrc}
        alt={alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onLoad={() => setState('loaded')}
        onError={() => setState('failed')}
      />
    </a>
  );
}
