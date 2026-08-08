/**
 * 이미지 중계 게이트웨이
 *  - gallery-art 버킷을 비공개로 두고, 이 경로를 통해서만 이미지에 접근하게 한다.
 *  - 요청을 검증한 뒤 유효시간이 짧은 서명 URL로 302 리다이렉트한다.
 *    (이미지 바이트는 Supabase에서 직접 전송되므로 호스팅 대역폭을 소모하지 않는다)
 *  - IP당 요청 수 제한 + 리퍼러 검사로 자동화 도구의 대량 수집을 차단한다.
 *
 * 사용: /api/img?p=<storage 경로>
 */
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cdlmkleujbxzrunudtvu.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const READER_EMAIL = process.env.GALLERY_READER_EMAIL || '';
const READER_PASSWORD = process.env.GALLERY_READER_PASSWORD || '';

const BUCKET = 'gallery-art';
const SIGN_TTL = 3600;          // 서명 URL 유효시간 (초)
const REDIRECT_CACHE = 1800;    // 브라우저가 리다이렉트를 재사용하는 시간 (초)

// ── IP당 요청 제한 (인스턴스 메모리, 슬라이딩 윈도) ──
// 썸네일·표지는 넉넉히, 1920×1080 완성본은 엄격히 — 정상 감상/사이니지 재생은 통과, 전량 수집은 차단
const WINDOW_MS = 10 * 60 * 1000;
const MAX_SMALL = 600;          // 썸네일(480×270)·표지
const MAX_FULL = 150;           // 사이니지 완성본 (슬라이드쇼 10분간 40장 수준)
const hits = new Map();

function rateLimited(ip, isFull) {
  const now = Date.now();
  const rec = hits.get(ip) || { small: [], full: [] };
  const key = isFull ? 'full' : 'small';
  rec[key] = rec[key].filter(t => now - t < WINDOW_MS);
  rec[key].push(now);
  hits.set(ip, rec);
  if (hits.size > 5000) {       // 메모리 보호
    for (const [k, v] of hits) {
      const last = Math.max(v.small.at(-1) || 0, v.full.at(-1) || 0);
      if (now - last > WINDOW_MS) hits.delete(k);
    }
  }
  return rec[key].length > (isFull ? MAX_FULL : MAX_SMALL);
}

// ── 읽기 계정 세션 캐시 ──
let session = { token: null, exp: 0 };
async function getToken() {
  if (session.token && Date.now() < session.exp) return session.token;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: READER_EMAIL, password: READER_PASSWORD }),
  });
  if (!r.ok) throw new Error('reader auth failed: ' + r.status);
  const j = await r.json();
  session = { token: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000 };
  return session.token;
}

module.exports = async (req, res) => {
  try {
    const path = (req.query?.p || '').toString();
    // 경로 검증 — 디렉터리 탈출·비이미지 차단
    if (!path || path.includes('..') || !/^[A-Za-z0-9가-힣 _\-/.]+\.(jpe?g|png|webp)$/i.test(path)) {
      res.status(400).send('bad request');
      return;
    }
    // 타 사이트에서의 직접 임베드(핫링크) 차단
    const ref = req.headers.referer || req.headers.referrer || '';
    if (ref) {
      let ok = false;
      try {
        const h = new URL(ref).host;
        ok = h === req.headers.host || /(^|\.)vercel\.app$/.test(h) || h.startsWith('localhost');
      } catch { ok = false; }
      if (!ok) { res.status(403).send('forbidden'); return; }
    }
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    const isFull = !path.includes('/thumbs/') && !path.startsWith('covers/');
    if (rateLimited(ip, isFull)) {
      res.setHeader('Retry-After', '600');
      res.status(429).send('too many requests');
      return;
    }

    const token = await getToken();
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${encoded}`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: SIGN_TTL }),
    });
    if (!r.ok) { res.status(r.status === 404 ? 404 : 502).send('not available'); return; }
    const { signedURL } = await r.json();

    res.setHeader('Cache-Control', `private, max-age=${REDIRECT_CACHE}`);
    res.setHeader('X-Robots-Tag', 'noai, noimageai, noimageindex');
    res.redirect(302, `${SUPABASE_URL}/storage/v1${signedURL}`);
  } catch (e) {
    res.status(500).send('error');
  }
};
