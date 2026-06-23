/**
 * Extension-side network bridge for GitHub requests.
 *
 * GitHub's OAuth device endpoints do not emit browser CORS headers. Keeping
 * those requests in the service worker lets Chrome apply the extension's host
 * permissions instead of treating them like ordinary page fetches.
 */
const ALLOWED_GITHUB_HOSTS = new Set([
  'api.github.com',
  'github.com',
  'gist.github.com',
  'gist.githubusercontent.com'
]);

const FAVICON_IMAGE_MAX_BYTES = 256 * 1024;
const FAVICON_HTML_MAX_BYTES = 256 * 1024;
const FAVICON_MANIFEST_MAX_BYTES = 128 * 1024;
const FAVICON_IMAGE_TIMEOUT_MS = 2800;
const FAVICON_PAGE_TIMEOUT_MS = 3500;
const FAVICON_MANIFEST_TIMEOUT_MS = 2200;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'github-fetch') {
    handleGitHubFetch(message)
      .then(sendResponse)
      .catch(error => {
        sendResponse({
          ok: false,
          status: 0,
          statusText: '',
          body: error?.message || 'GitHub request failed'
        });
      });

    return true;
  }

  if (message?.type === 'favicon-fetch') {
    handleFaviconFetch(message)
      .then(sendResponse)
      .catch(error => {
        sendResponse({
          ok: false,
          error: error?.message || 'Favicon request failed'
        });
      });

    return true;
  }

  return false;
});

async function handleGitHubFetch(message) {
  const url = new URL(message.url);
  if (!ALLOWED_GITHUB_HOSTS.has(url.hostname)) {
    throw new Error(`Blocked unsupported GitHub host: ${url.hostname}`);
  }

  const response = await fetch(url.toString(), {
    method: message.method || 'GET',
    headers: message.headers || {},
    body: message.body
  });

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    body: await response.text()
  };
}

async function handleFaviconFetch(message) {
  const pageUrl = parseHttpUrl(message.url);
  const favicon = await resolveFavicon(pageUrl);

  if (!favicon) {
    return {
      ok: false,
      error: 'No favicon found'
    };
  }

  return {
    ok: true,
    dataUrl: favicon.dataUrl,
    source: favicon.source,
    url: favicon.url,
    mimeType: favicon.mimeType
  };
}

async function resolveFavicon(pageUrl) {
  const commonIcon = await fetchBestImage(buildCommonIconCandidates(pageUrl));
  if (commonIcon) return commonIcon;

  const manifestIcon = await fetchManifestIconCandidates(buildCommonManifestUrls(pageUrl));
  const commonManifestIcon = await fetchBestImage(manifestIcon);
  if (commonManifestIcon) return commonManifestIcon;

  const pageIcon = await fetchIconFromPage(pageUrl);
  if (pageIcon) return pageIcon;

  const originUrl = new URL('/', pageUrl.origin);
  if (originUrl.href !== pageUrl.href) {
    return fetchIconFromPage(originUrl);
  }

  return null;
}

function parseHttpUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs are supported');
  }
  return url;
}

function buildCommonIconCandidates(pageUrl) {
  return [
    { url: new URL('/favicon.svg', pageUrl.origin).href, source: 'common-path', score: 105 },
    { url: new URL('/favicon.ico', pageUrl.origin).href, source: 'common-path', score: 100 },
    { url: new URL('/favicon.png', pageUrl.origin).href, source: 'common-path', score: 96 },
    { url: new URL('/apple-touch-icon.png', pageUrl.origin).href, source: 'common-path', score: 90 },
    { url: new URL('/apple-touch-icon-precomposed.png', pageUrl.origin).href, source: 'common-path', score: 88 }
  ];
}

function buildCommonManifestUrls(pageUrl) {
  return [
    new URL('/site.webmanifest', pageUrl.origin).href,
    new URL('/manifest.webmanifest', pageUrl.origin).href,
    new URL('/manifest.json', pageUrl.origin).href
  ];
}

async function fetchIconFromPage(pageUrl) {
  const page = await fetchPageHtml(pageUrl);
  if (!page) return null;

  const { icons, manifests } = extractPageIconCandidates(page.text, page.url);
  const manifestIcons = await fetchManifestIconCandidates(manifests);

  return fetchBestImage([...manifestIcons, ...icons]);
}

async function fetchPageHtml(pageUrl) {
  try {
    const response = await fetchWithTimeout(pageUrl.href, {
      cache: 'force-cache',
      credentials: 'omit',
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    }, FAVICON_PAGE_TIMEOUT_MS);

    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || '';
    if (contentType && !contentType.toLowerCase().includes('html')) return null;

    return {
      url: response.url || pageUrl.href,
      text: await readResponseText(response, FAVICON_HTML_MAX_BYTES, '</head>')
    };
  } catch {
    return null;
  }
}

async function fetchManifestIconCandidates(manifestUrls) {
  const uniqueUrls = [...new Set((manifestUrls || []).filter(Boolean))].slice(0, 4);
  const results = await Promise.allSettled(uniqueUrls.map(fetchManifestIcons));

  return results
    .filter(result => result.status === 'fulfilled')
    .flatMap(result => result.value);
}

async function fetchManifestIcons(manifestUrl) {
  try {
    const response = await fetchWithTimeout(manifestUrl, {
      cache: 'force-cache',
      credentials: 'omit',
      redirect: 'follow',
      headers: {
        Accept: 'application/manifest+json,application/json,text/plain;q=0.8,*/*;q=0.5'
      }
    }, FAVICON_MANIFEST_TIMEOUT_MS);

    if (!response.ok) return [];

    const body = await readResponseText(response, FAVICON_MANIFEST_MAX_BYTES);
    const manifest = JSON.parse(body);
    if (!Array.isArray(manifest.icons)) return [];

    return manifest.icons
      .filter(icon => icon && icon.src)
      .map(icon => {
        const iconUrl = safeResolveUrl(icon.src, response.url || manifestUrl);
        if (!iconUrl) return null;

        return {
          url: iconUrl,
          source: 'manifest',
          score: scoreManifestIcon(icon)
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  } catch {
    return [];
  }
}

function extractPageIconCandidates(html, baseUrl) {
  const icons = [];
  const manifests = [];
  const linkTagPattern = /<link\b[^>]*>/gi;
  let match;

  while ((match = linkTagPattern.exec(html))) {
    const attrs = parseTagAttributes(match[0]);
    const href = attrs.href;
    const rel = (attrs.rel || '').toLowerCase();
    if (!href || !rel) continue;

    const relTokens = rel.split(/\s+/).filter(Boolean);
    const hrefUrl = safeResolveUrl(href, baseUrl);
    if (!hrefUrl) continue;

    if (relTokens.includes('manifest')) {
      manifests.push(hrefUrl);
      continue;
    }

    const isIcon = relTokens.includes('icon')
      || relTokens.includes('apple-touch-icon')
      || relTokens.includes('apple-touch-icon-precomposed')
      || relTokens.includes('mask-icon');

    if (!isIcon) continue;

    icons.push({
      url: hrefUrl,
      source: 'html',
      score: scoreHtmlIconCandidate(attrs, hrefUrl, relTokens)
    });
  }

  return {
    icons: dedupeCandidates(icons).sort((a, b) => b.score - a.score).slice(0, 12),
    manifests: [...new Set(manifests)].slice(0, 4)
  };
}

function parseTagAttributes(tag) {
  const attrs = {};
  const attrPattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;

  while ((match = attrPattern.exec(tag))) {
    const name = match[1].toLowerCase();
    if (name === 'link') continue;
    attrs[name] = match[2] ?? match[3] ?? match[4] ?? '';
  }

  return attrs;
}

function scoreHtmlIconCandidate(attrs, hrefUrl, relTokens) {
  let score = 80;
  const type = (attrs.type || '').toLowerCase();
  const largestSize = getLargestDeclaredSize(attrs.sizes);

  if (relTokens.includes('apple-touch-icon') || relTokens.includes('apple-touch-icon-precomposed')) {
    score += 8;
  }

  if (relTokens.includes('mask-icon')) {
    score -= 8;
  }

  if (type.includes('svg') || /\.svg(?:[?#]|$)/i.test(hrefUrl)) {
    score += 15;
  }

  if (attrs.sizes === 'any') {
    score += 14;
  } else {
    score += scoreDeclaredSize(largestSize);
  }

  return score;
}

function scoreManifestIcon(icon) {
  const source = icon.src || '';
  const type = (icon.type || '').toLowerCase();
  const largestSize = getLargestDeclaredSize(icon.sizes);
  let score = 78 + scoreDeclaredSize(largestSize);

  if (type.includes('svg') || /\.svg(?:[?#]|$)/i.test(source)) score += 20;
  if (largestSize > 256) score -= 12;
  if (largestSize > 512) score -= 20;

  return score;
}

function scoreDeclaredSize(size) {
  if (!size) return 0;
  if (size <= 16) return 2;
  if (size <= 32) return 10;
  if (size <= 64) return 14;
  if (size <= 128) return 12;
  if (size <= 256) return 8;
  return 2;
}

function getLargestDeclaredSize(value = '') {
  let largest = 0;
  const sizePattern = /(\d{1,4})x(\d{1,4})/gi;
  let match;

  while ((match = sizePattern.exec(value))) {
    largest = Math.max(largest, Number(match[1]), Number(match[2]));
  }

  return largest;
}

function safeResolveUrl(value, baseUrl) {
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

async function fetchBestImage(candidates) {
  const uniqueCandidates = dedupeCandidates(candidates).slice(0, 12);
  if (uniqueCandidates.length === 0) return null;

  const results = await Promise.allSettled(uniqueCandidates.map(fetchImageCandidate));
  return results
    .filter(result => result.status === 'fulfilled' && result.value)
    .map(result => result.value)
    .sort((a, b) => b.score - a.score)[0] || null;
}

async function fetchImageCandidate(candidate) {
  const response = await fetchWithTimeout(candidate.url, {
    cache: 'force-cache',
    credentials: 'omit',
    redirect: 'follow',
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
    }
  }, FAVICON_IMAGE_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`Icon request failed: ${response.status}`);
  }

  const finalUrl = response.url || candidate.url;
  const rawContentType = response.headers.get('content-type') || '';
  const mimeType = inferImageMimeType(rawContentType, finalUrl);
  if (!mimeType) {
    throw new Error(`Unsupported icon content type: ${rawContentType || 'unknown'}`);
  }

  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > FAVICON_IMAGE_MAX_BYTES) {
    throw new Error('Icon is too large');
  }

  const buffer = await readResponseArrayBuffer(response, FAVICON_IMAGE_MAX_BYTES);
  if (!buffer.byteLength) {
    throw new Error('Icon is empty');
  }

  return {
    dataUrl: `data:${mimeType};base64,${arrayBufferToBase64(buffer)}`,
    mimeType,
    source: candidate.source,
    url: finalUrl,
    score: candidate.score || 0
  };
}

function inferImageMimeType(contentType, url) {
  const mimeType = contentType.split(';')[0].trim().toLowerCase();
  if (mimeType.startsWith('image/')) return mimeType;
  if (mimeType === 'application/x-ico' || mimeType === 'application/ico') return 'image/x-icon';
  if (!canInferImageTypeFromUrl(mimeType)) return null;

  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.endsWith('.ico')) return 'image/x-icon';
  if (pathname.endsWith('.png')) return 'image/png';
  if (pathname.endsWith('.svg')) return 'image/svg+xml';
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  if (pathname.endsWith('.webp')) return 'image/webp';
  if (pathname.endsWith('.gif')) return 'image/gif';

  return null;
}

function canInferImageTypeFromUrl(mimeType) {
  return !mimeType
    || mimeType === 'application/octet-stream'
    || mimeType === 'binary/octet-stream'
    || mimeType === 'text/plain'
    || mimeType === 'text/xml'
    || mimeType === 'application/xml';
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readResponseText(response, maxBytes, stopMarker = '') {
  if (!response.body?.getReader) {
    const text = await response.text();
    return text.slice(0, maxBytes);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  const marker = stopMarker.toLowerCase();
  let totalBytes = 0;
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    totalBytes += value.byteLength;
    chunks.push(decoder.decode(value, { stream: true }));
    text = chunks.join('');

    if (totalBytes >= maxBytes || (marker && text.toLowerCase().includes(marker))) {
      await reader.cancel();
      break;
    }
  }

  return text + decoder.decode();
}

async function readResponseArrayBuffer(response, maxBytes) {
  if (!response.body?.getReader) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      throw new Error('Response is too large');
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error('Response is too large');
    }

    chunks.push(value);
  }

  const buffer = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return buffer.buffer;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  return (candidates || []).filter(candidate => {
    if (!candidate?.url || seen.has(candidate.url)) return false;
    seen.add(candidate.url);
    return true;
  });
}
