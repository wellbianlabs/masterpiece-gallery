// 공용: Supabase 클라이언트 + 이미지 URL + 파일명 메타 파서
const CFG = window.GALLERY_CONFIG;
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

// 이미지는 중계 게이트웨이(/api/img)를 통해서만 제공된다 — 직접 URL 접근·대량 수집 차단
const artUrl = p => p ? `/api/img?p=${encodeURIComponent(p)}` : '';
const musicUrl = p => `${CFG.SUPABASE_URL}/storage/v1/object/public/gallery-music/${encodeURIComponent(p).replace(/%2F/g, '/')}`;

// 파일명 → {title, artist, year} 자동 파싱 (반스/메트 형식 지원)
function parseArtMeta(filename) {
  const base = filename.replace(/\.[^.]+$/, '').replace(/\.$/, '');
  let title = base, artist = '', year = '';
  const p2 = base.match(/^(.+?)_(.+?\([^)]*\))_?\s*(\d{4}(?:[-–]\d{2,4})?)?_?$/);
  const p1 = base.match(/^([A-ZÉÈÀÂÊÎÔÛÄÖÜ][^.]{2,60})\.\s+(.+?)(?:,\s*(c\.\s*)?(\d{4}(?:[-–]\d{2,4})?))?\.\s*\S*$/);
  if (p2) {
    title = p2[1].trim();
    artist = p2[2].replace(/\s*\([^)]*\)\s*/g, '').trim();
    year = (p2[3] || '').trim();
  } else if (p1) {
    artist = p1[1].trim();
    title = p1[2].trim();
    year = (p1[4] || '').trim();
  } else {
    const parts = base.split('_').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) { title = parts[0]; artist = parts[1].replace(/\s*\([^)]*\)/g, ''); }
    const ym = base.match(/(1[4-9]\d{2}|20[0-2]\d)/);
    if (ym) year = ym[1];
  }
  return { title, artist, year };
}
