/**
 * 1) 미술관별 파일명 패턴 파서로 작품 메타(작품명/작가/연도) 일괄 교체
 * 2) 시카고뮤지움1·2 전시 삭제 → 원본(01.원본/미술관/시카고미술관)에서 재크롭 업로드 (엑셀 메타 매핑)
 * 3) PSD에서 변환한 표지 25종 업로드 및 전시 표지 지정
 *   ADMIN_PW='...' node seed/fix-meta-chicago-covers.js
 */
const { createClient } = require('@supabase/supabase-js');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SUPABASE_URL = 'https://cdlmkleujbxzrunudtvu.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNkbG1rbGV1amJ4enJ1bnVkdHZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNzMzOTgsImV4cCI6MjA5MzY0OTM5OH0.G26w_yE4ErRXCsHmWPphN4TccVmiivdd5OoPjv2dPdo';
const ADMIN_PW = process.env.ADMIN_PW;
if (!ADMIN_PW) { console.error('ADMIN_PW 필요'); process.exit(1); }

const ROOT = path.resolve(__dirname, '..', '..');
const EDITED = path.join(ROOT, '03.수정');
const CHICAGO_DIR = path.join(ROOT, '01.원본', '미술관', '시카고미술관');
const COVERS_DIR = path.join(__dirname, 'covers');
const CHICAGO_META = JSON.parse(fs.readFileSync(path.join(__dirname, 'chicago-meta.json'), 'utf8'));

const sb = createClient(SUPABASE_URL, ANON_KEY);
sharp.cache(false);
const md5 = s => crypto.createHash('md5').update(s).digest('hex');
const stripExt = f => f.replace(/\.[^.]+$/, '').replace(/\.$/, '');
const cleanArtist = s => s.replace(/\s*\(.*$/, '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/[,\s]*\d{4}\s*[–—-]\s*\d{4}/g, '').replace(/\s{2,}/g, ' ').trim();
const yearOf = s => (s.match(/\b(1[4-9]\d{2}|20[0-2]\d)\b/) || [])[1] || '';
const cap = s => s.split(/\s+/).map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');

/* ── 미술관별 파서 ── */
function dashTitleArtist(base) { // "Title-Artist"
  const i = base.lastIndexOf('-');
  if (i < 1) return { title: base };
  const artist = cleanArtist(base.slice(i + 1));
  let title = base.slice(0, i).trim();
  const year = yearOf(title);
  title = title.replace(/,?\s*\b(1[4-9]\d{2}|20[0-2]\d)\b\s*$/, '').trim();
  return { title, artist, year };
}
const PARSERS = {
  'Belvedere_수정': dashTitleArtist,
  'Dallas Museum of Art_수정': dashTitleArtist,
  'National Museum, Norway_수정': dashTitleArtist,
  'Thielska Galleriet_수정': dashTitleArtist,
  'wienmuseum_수정': dashTitleArtist,
  'MIA-Minneapolis Institute of Art_수정': dashTitleArtist,
  'J. Paul Getty Museum선별수정': base => {
    const p = base.split('_');
    if (p.length >= 3) return { title: p[0].trim(), year: yearOf(p[1]), artist: cleanArtist(p.slice(2).join('_')) };
    return { title: base };
  },
  'Lenbachhaus_수정': base => {
    const m = base.match(/^\d+_(.+)$/);
    if (!m) return { title: base };
    const i = m[1].indexOf(', ');
    if (i < 0) return { title: m[1] };
    return { artist: cleanArtist(m[1].slice(0, i)), title: m[1].slice(i + 2).trim(), year: yearOf(base) };
  },
  'Munchmuseet Billedarkiv_수정': base => ({ artist: 'Edvard Munch', title: base.replace(/^\d+_/, ''), year: yearOf(base) }),
  '뭉크미술관_수정': base => ({ artist: 'Edvard Munch', title: base.replace(/^\d+_/, ''), year: yearOf(base) }),
  'National Gallery of Art_수정': base => ({
    title: cap(base.replace(/_?\d{4}\.\d+\.\d+.*$/, '').replace(/_/g, ' ').trim()),
  }),
  'National Museum in Krakow선별수정': base => ({ title: base }),
  'Nivaagaard_수정': base => {
    const i = base.indexOf('-');
    if (i < 1) return { title: base };
    let title = base.slice(i + 1).trim();
    const year = yearOf(title);
    title = title.replace(/,?\s*\b(1[4-9]\d{2}|20[0-2]\d)\b\s*$/, '').trim();
    return { artist: cleanArtist(base.slice(0, i)), title, year };
  },
  'The clark_선별수정': base => {
    const i = base.indexOf(', ');
    if (i < 0) return { title: base };
    return { artist: cleanArtist(base.slice(0, i)), title: base.slice(i + 2).trim(), year: yearOf(base) };
  },
  'YALE UNIVERSITY ART GALLERY_수정': base => {
    let m = base.match(/^(.+?\))-(.+)$/);              // "Artist (…)-Title"
    if (m) return { artist: cleanArtist(m[1]), title: m[2].trim() };
    m = base.match(/^(.+)-([^-]+\([^)]*\))$/);          // "Title-Artist (…)"
    if (m) return { title: m[1].trim(), artist: cleanArtist(m[2]) };
    return dashTitleArtist(base);
  },
  'kunstmuseumbasel_수정': base => {
    const m = base.match(/^\d+_\d+-(.+?)_[0-9a-f]{6,}$/);
    if (!m) return { title: base };
    const toks = m[1].split('-');
    if (toks.length <= 3) return { title: cap(toks.join(' ')) };
    return { artist: cap(toks.slice(0, 2).join(' ')), title: cap(toks.slice(2).join(' ')) };
  },
  'musees-reims_수정': base => {
    const i = base.indexOf(',');
    if (i < 0) return { title: base };
    return { artist: cap(cleanArtist(base.slice(0, i)).toLowerCase()), title: base.slice(i + 1).trim(), year: yearOf(base) };
  },
  '슬로바키아 국립 갤러리_선별': base => {
    const p = base.split(/\s+[–—]\s+/);
    if (p.length >= 2) return { artist: cleanArtist(p[0]), title: p.slice(1).join(' – ').trim() };
    return { title: base };
  },
  '슬로바키아 국립 갤러리_선별수정': base => PARSERS['슬로바키아 국립 갤러리_선별'](base),
  '암스테르담 국립미술관_수정': base => {
    const p = base.split(', ');
    if (p.length >= 3 && /^c?\.?\s*\d{4}/.test(p[p.length - 1]))
      return { title: p.slice(0, -2).join(', '), artist: cleanArtist(p[p.length - 2]), year: yearOf(p[p.length - 1]) };
    if (p.length >= 2) return { title: p.slice(0, -1).join(', '), artist: cleanArtist(p[p.length - 1]) };
    return { title: base };
  },
};

const COVER_MAP = {
  '내셔널 갤러리 오브 아트': ['National Gallery of Art'],
  '노르웨이 국립미술관': ['National Museum, Norway'],
  '니가바르 미술관': ['Nivaagaard'],
  '달라스 미술관': ['Dallas Museum of Art'],
  '렌바우하우스': ['Lenbachhaus'],
  '메트포폴리탄': ['메트로폴리탄'],
  '뭉크미술관': ['뭉크미술관', 'Munchmuseet Billedarkiv'],
  '뮤지 데 보종아 드 랭스': ['musees-reims'],
  '미니애폴리스': ['MIA-Minneapolis Institute of Art'],
  '반스 미술관': ['반스 미술관'],
  '벨베데레 미술관': ['Belvedere'],
  '비엔나 미술관': ['wienmuseum'],
  '스웨덴 국립 박물관': ['스웨덴국립미술관'],
  '슬로바키아 국립 박물관': ['슬로바키아 국립 갤러리'],
  '암스테르담': ['암스테르담 국립미술관'],
  '예일 대학교 미술관': ['YALE UNIVERSITY ART GALLERY'],
  '예일센터브리티시아트': ['예일센터브리티시아트'],
  '쿤스트뮤지엄 바젤': ['kunstmuseumbasel'],
  '크라쿠프 국립미술관': ['National Museum in Krakow'],
  '클라크 아트 인스티튜트': ['The clark'],
  '클리블랜드 미술관': ['클리블랜드 미술관'],
  '틸스카 갤러리': ['Thielska Galleriet'],
  '폴게티 미술관': ['J. Paul Getty Museum'],
  '에두아르 마네': ['Édouard Manet'],
  '오귀스트 르누아르': ['Pierre-Auguste Renoir'],
};

async function fetchAllArtworks() {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('gallery_artworks').select('id, image_path, exhibition_id').range(from, from + 999);
    if (error) throw new Error(error.message);
    all.push(...data);
    if (data.length < 1000) break;
  }
  return all;
}

async function main() {
  const { error: le } = await sb.auth.signInWithPassword({ email: 'gallery-admin@wellbianlabs.io', password: ADMIN_PW });
  if (le) { console.error('로그인 실패:', le.message); process.exit(1); }
  console.log('로그인 OK');

  /* ── 1) 메타 교체 ── */
  const arts = await fetchAllArtworks();
  const byKey = new Map(); // "<16자키>" -> artwork
  for (const a of arts) {
    const m = a.image_path.match(/\/([0-9a-f]{16})\.jpg$/);
    if (m) byKey.set(m[1], a);
  }
  console.log(`전체 작품 ${arts.length}건 로드`);
  let updated = 0, noMatch = 0;
  for (const [folder, parser] of Object.entries(PARSERS)) {
    const dir = path.join(EDITED, folder);
    if (!fs.existsSync(dir)) { console.log(`폴더 없음: ${folder}`); continue; }
    const files = fs.readdirSync(dir).filter(f => /\.(jpe?g|png)$/i.test(f));
    let n = 0;
    for (const f of files) {
      const key = md5(folder + '/' + f).slice(0, 16);
      const a = byKey.get(key);
      if (!a) { noMatch++; continue; }
      const meta = parser(stripExt(f));
      const { error } = await sb.from('gallery_artworks').update({
        title: (meta.title || '').slice(0, 300),
        artist: (meta.artist || '').slice(0, 200),
        year: (meta.year || '').slice(0, 40),
      }).eq('id', a.id);
      if (error) console.error(`  meta 실패 [${f}]:`, error.message);
      else { updated++; n++; }
    }
    console.log(`[메타] ${folder}: ${n}건`);
  }
  console.log(`=== 메타 교체 ${updated}건 (미매칭 ${noMatch}) ===`);

  /* ── 2) 시카고 재구축 ── */
  const { data: chiExs } = await sb.from('gallery_exhibitions').select('id, name').in('name', ['시카고뮤지움1', '시카고뮤지움2']);
  for (const ex of chiExs || []) {
    const { data: chiArts } = await sb.from('gallery_artworks').select('image_path, thumb_path').eq('exhibition_id', ex.id);
    const paths = (chiArts || []).flatMap(a => [a.image_path, a.thumb_path]).filter(Boolean);
    for (let i = 0; i < paths.length; i += 100) await sb.storage.from('gallery-art').remove(paths.slice(i, i + 100));
    await sb.from('gallery_exhibitions').delete().eq('id', ex.id);
    console.log(`[시카고] 기존 전시 삭제: ${ex.name} (${paths.length / 2}작품)`);
  }
  const { data: chiEx, error: ce } = await sb.from('gallery_exhibitions').insert({
    name: '시카고미술관', category: '미술관',
    intro: '시카고 미술관(Art Institute of Chicago)은 쇠라의 「그랑드 자트 섬의 일요일 오후」로 대표되는 인상주의·후기인상주의 컬렉션의 성지입니다.',
    published: true,
  }).select().single();
  if (ce) { console.error('시카고 전시 생성 실패:', ce.message); process.exit(1); }
  const normNo = s => { s = String(s).trim(); return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s; };
  const chiFiles = fs.readdirSync(CHICAGO_DIR).filter(f => /\.(jpe?g|png)$/i.test(f)).sort();
  let chiUp = 0, first = null;
  for (const f of chiFiles) {
    try {
      const key = md5('시카고미술관/' + f).slice(0, 16);
      const imagePath = `${chiEx.id}/${key}.jpg`;
      const thumbPath = `${chiEx.id}/thumbs/${key}.jpg`;
      if (!first) first = imagePath;
      const raw = fs.readFileSync(path.join(CHICAGO_DIR, f));
      const buf = await sharp(raw, { limitInputPixels: 1e9 }).rotate()
        .resize(1920, 1080, { fit: 'cover', position: 'attention' }).jpeg({ quality: 90 }).toBuffer();
      const thumbBuf = await sharp(buf).resize(480, 270).jpeg({ quality: 80 }).toBuffer();
      let up = await sb.storage.from('gallery-art').upload(imagePath, buf, { contentType: 'image/jpeg' });
      if (up.error && !/already exists/i.test(up.error.message)) throw new Error(up.error.message);
      up = await sb.storage.from('gallery-art').upload(thumbPath, thumbBuf, { contentType: 'image/jpeg' });
      if (up.error && !/already exists/i.test(up.error.message)) throw new Error(up.error.message);
      let originalPath = `${chiEx.id}/${key}.jpg`;
      let o = await sb.storage.from('gallery-originals').upload(originalPath, raw, { contentType: 'image/jpeg' });
      if (o.error && !/already exists/i.test(o.error.message)) originalPath = null;
      // "1894.1039 - October Day.jpg" → 엑셀 메타
      const m = stripExt(f).match(/^([\d.]+)\s*-\s*(.+)$/);
      const xl = m ? CHICAGO_META[normNo(m[1])] : null;
      const { error } = await sb.from('gallery_artworks').insert({
        exhibition_id: chiEx.id,
        title: xl?.title || (m ? m[2] : stripExt(f)),
        artist: xl?.artist || '',
        year: xl?.year && xl.year !== 'None' ? xl.year : '',
        image_path: imagePath, thumb_path: thumbPath, original_path: originalPath,
      });
      if (error) throw new Error(error.message);
      chiUp++;
    } catch (e) { console.error(`  [시카고] 실패 ${f}:`, e.message); }
  }
  await sb.from('gallery_exhibitions').update({ cover_path: first }).eq('id', chiEx.id);
  console.log(`=== 시카고 재구축: ${chiUp}/${chiFiles.length}장 업로드 ===`);

  /* ── 3) 표지 업로드 ── */
  const { data: exs } = await sb.from('gallery_exhibitions').select('id, name');
  const exByName = new Map(exs.map(e => [e.name, e]));
  let coverN = 0;
  for (const f of fs.readdirSync(COVERS_DIR).filter(f => f.endsWith('.jpg'))) {
    const base = stripExt(f);
    const targets = COVER_MAP[base];
    if (!targets) { console.log(`[표지] 매핑 없음: ${base}`); continue; }
    const buf = fs.readFileSync(path.join(COVERS_DIR, f));
    const coverPath = `covers/${md5(base).slice(0, 12)}.jpg`;
    const up = await sb.storage.from('gallery-art').upload(coverPath, buf, { contentType: 'image/jpeg', cacheControl: '3600' });
    if (up.error && !/already exists/i.test(up.error.message)) { console.error(`[표지] 업로드 실패 ${base}:`, up.error.message); continue; }
    for (const t of targets) {
      const ex = exByName.get(t);
      if (!ex) { console.log(`[표지] 전시 없음: ${t}`); continue; }
      await sb.from('gallery_exhibitions').update({ cover_path: coverPath }).eq('id', ex.id);
      coverN++;
      console.log(`[표지] ${base} → ${t}`);
    }
  }
  console.log(`=== 표지 지정 ${coverN}건 === 전체 작업 완료`);
}
if (require.main === module) main();
module.exports = { PARSERS };
