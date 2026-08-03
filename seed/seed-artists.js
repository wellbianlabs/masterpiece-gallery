/**
 * 작가 원본(01.원본/작가/세계편)을 Supabase로 시드 업로드.
 *   - 표시용: 1920x1080 자동 크롭(attention) + 480px 썸네일 → gallery-art (공개)
 *   - 원본: 원본 파일 그대로 → gallery-originals (비공개, 관리자만)
 *   ADMIN_PW='...' node seed/seed-artists.js
 * 재실행 안전: 파일명 해시 기반 경로라 이미 올라간 작품은 건너뜀.
 */
const { createClient } = require('@supabase/supabase-js');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SUPABASE_URL = 'https://cdlmkleujbxzrunudtvu.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNkbG1rbGV1amJ4enJ1bnVkdHZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNzMzOTgsImV4cCI6MjA5MzY0OTM5OH0.G26w_yE4ErRXCsHmWPphN4TccVmiivdd5OoPjv2dPdo';
const ADMIN_EMAIL = 'gallery-admin@wellbianlabs.io';
const ADMIN_PW = process.env.ADMIN_PW;
if (!ADMIN_PW) { console.error('ADMIN_PW 환경변수를 설정하세요'); process.exit(1); }
const KEEP_ORIGINALS = process.env.SKIP_ORIGINALS !== '1';

const ROOT = path.resolve(__dirname, '..', '..');
const ARTISTS_DIR = path.join(ROOT, '01.원본', '작가', '세계편');

const sb = createClient(SUPABASE_URL, ANON_KEY);
sharp.cache(false);
const md5 = s => crypto.createHash('md5').update(s).digest('hex');

const ARTIST_INTROS = {
  'Vincent van Gogh': '강렬한 색채와 소용돌이치는 붓질로 후기인상주의를 대표하는 네덜란드의 화가. 「별이 빛나는 밤」, 「해바라기」 등 불멸의 걸작을 남겼습니다.',
  'Pierre-Auguste Renoir': '빛과 살결의 화가로 불리는 프랑스 인상주의의 거장. 따뜻한 색채로 일상의 행복한 순간을 담아냈습니다.',
  'Édouard Manet': '전통과 근대를 잇는 프랑스 근대 회화의 아버지. 「올랭피아」, 「풀밭 위의 점심식사」로 미술사의 전환점을 만들었습니다.',
  'Gustav Klimt': '황금빛 장식과 관능적 곡선으로 빈 분리파를 이끈 오스트리아의 거장. 「키스」로 세기말 빈의 미학을 완성했습니다.',
  'Alfred Sisley': '하늘과 물의 표정을 좇은 순수 풍경화가. 인상주의 창립 멤버 중 가장 서정적인 풍경을 남겼습니다.',
  'John Singer Sargent': '에드워드 시대 상류사회의 초상을 우아하게 담아낸 미국 출신의 초상화 거장입니다.',
  'Giovanni Boldini': '벨 에포크 파리 사교계의 화려함을 역동적인 붓질로 그린 이탈리아의 초상화가입니다.',
  'Carl Larsson': '스웨덴 가정의 따뜻한 일상을 수채로 담아 북유럽 라이프스타일의 원형을 만든 국민화가입니다.',
  'John Atkinson Grimshaw': '달빛 젖은 빅토리아 시대의 밤거리를 그린 영국의 야경 화가입니다.',
  'Thomas Moran': '옐로스톤과 그랜드캐니언의 장엄함을 화폭에 담아 미국 국립공원 탄생에 기여한 풍경화가입니다.',
  'Jean Béraud': '벨 에포크 파리의 거리와 카페, 사교계를 세밀하게 기록한 프랑스 풍속화가입니다.',
  'Albert Edelfelt': '핀란드 사실주의의 아버지. 파리에서 활동하며 북유럽의 빛을 프랑스 살롱에 알렸습니다.',
  'Carl Holsøe': '고요한 실내 정경의 시인. 덴마크 실내화 전통을 대표하는 화가입니다.',
  'Carl Reichert': '반려동물의 표정을 사랑스럽게 포착한 오스트리아의 동물화가입니다.',
  'Charles Courtney Curran': '꽃과 여성, 여름 햇살을 서정적으로 그린 미국 인상주의 화가입니다.',
  'Daniel Ridgway Knight': '프랑스 전원의 농촌 여성들을 목가적으로 그린 미국 화가입니다.',
  'David James': '파도의 움직임을 전문으로 그린 영국의 해양화가입니다.',
  'Eugène Galien-Laloue': '벨 에포크 파리의 거리 풍경을 구아슈로 생생하게 기록한 프랑스 화가입니다.',
  'Frédéric Houbron': '19세기 말 파리의 일상을 독특한 기법으로 담은 프랑스 화가입니다.',
  'Frédéric Soulacroix': '비단과 레이스의 질감을 극사실로 그려낸 살롱 회화의 대가입니다.',
  'Henryk Siemiradzki': '고대 그리스·로마의 장대한 서사를 그린 폴란드 아카데미즘의 거장입니다.',
  'Jens Juel': '덴마크 황금기 이전 초상화의 기틀을 놓은 18세기 덴마크 궁정화가입니다.',
  'Josef Lauer': '꽃과 정물의 화가. 비더마이어 시대 빈의 정물화 전통을 대표합니다.',
  'Julius Leblanc Stewart': '파리 사교계의 우아한 연회를 그린 미국 출신 화가입니다.',
  'L.A. Ring': '덴마크 상징주의와 사실주의를 잇는 화가. 농촌의 삶을 담담하게 기록했습니다.',
  'Marsden Hartley': '미국 모더니즘의 개척자. 대담한 색면으로 메인 주의 풍경을 그렸습니다.',
  'Santiago Rusiñol': '카탈루냐 모데르니스메를 이끈 스페인 화가. 정원 풍경 연작으로 유명합니다.',
  'Sir John Lavery': '아일랜드 출신의 초상·풍경화가. 글래스고 보이즈의 일원으로 활동했습니다.',
  'Tina Blau': '오스트리아 분위기 인상주의를 대표하는 여성 풍경화가입니다.',
  'Barend Cornelis Koekkoek': '네덜란드 낭만주의 풍경화의 왕자로 불린 19세기 거장입니다.',
};

function parseTitle(filename) {
  const base = filename.replace(/\.[^.]+$/, '').replace(/\.$/, '');
  let title = base, year = '';
  const ym = base.match(/(1[4-9]\d{2}|20[0-2]\d)/);
  if (ym) year = ym[1];
  title = base
    .replace(/\s*\(?\b(1[4-9]\d{2}|20[0-2]\d)\b\)?\s*/g, ' ')
    .replace(/^[\d\s.,_-]+/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s{2,}/g, ' ').trim() || base;
  return { title, year };
}

// 간단 동시성 풀
async function pool(items, limit, fn) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PW });
  if (authErr) { console.error('로그인 실패:', authErr.message); process.exit(1); }
  console.log('관리자 로그인 OK / 원본 보관:', KEEP_ORIGINALS ? 'ON' : 'OFF');

  const folders = fs.readdirSync(ARTISTS_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
  console.log(`작가 폴더 ${folders.length}개`);

  const { data: existingExs } = await sb.from('gallery_exhibitions').select('id, name, cover_path');
  const exByName = new Map((existingExs || []).map(e => [e.name, e]));

  let totalUp = 0, totalSkip = 0, totalErr = 0;
  for (const folder of folders) {
    const artistName = folder.replace(/\s*\([^)]*\)\s*$/, '').trim();
    let ex = exByName.get(artistName);
    if (!ex) {
      const { data, error } = await sb.from('gallery_exhibitions').insert({
        name: artistName, category: '작가',
        intro: ARTIST_INTROS[artistName] || `${artistName}의 작품 세계를 감상하실 수 있습니다.`,
        published: true,
      }).select().single();
      if (error) { console.error(`전시 생성 실패 [${artistName}]:`, error.message); continue; }
      ex = data; exByName.set(artistName, ex);
    } else if (ARTIST_INTROS[artistName]) {
      await sb.from('gallery_exhibitions').update({ intro: ARTIST_INTROS[artistName], category: '작가' }).eq('id', ex.id);
    }
    const { data: existingArts } = await sb.from('gallery_artworks').select('image_path').eq('exhibition_id', ex.id);
    const existingPaths = new Set((existingArts || []).map(a => a.image_path));

    const dir = path.join(ARTISTS_DIR, folder);
    const files = fs.readdirSync(dir).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort();
    let firstPath = null;

    await pool(files, 4, async f => {
      const key = md5('작가/' + folder + '/' + f).slice(0, 16);
      const imagePath = `${ex.id}/${key}.jpg`;
      const thumbPath = `${ex.id}/thumbs/${key}.jpg`;
      if (!firstPath) firstPath = imagePath;
      if (existingPaths.has(imagePath)) { totalSkip++; return; }
      try {
        const abs = path.join(dir, f);
        const raw = fs.readFileSync(abs);
        const buf = await sharp(raw, { limitInputPixels: 1e9 }).rotate()
          .resize(1920, 1080, { fit: 'cover', position: 'attention' })
          .jpeg({ quality: 90 }).toBuffer();
        const thumbBuf = await sharp(buf).resize(480, 270).jpeg({ quality: 80 }).toBuffer();
        let up = await sb.storage.from('gallery-art').upload(imagePath, buf, { contentType: 'image/jpeg' });
        if (up.error && !/already exists/i.test(up.error.message)) throw new Error('art: ' + up.error.message);
        up = await sb.storage.from('gallery-art').upload(thumbPath, thumbBuf, { contentType: 'image/jpeg' });
        if (up.error && !/already exists/i.test(up.error.message)) throw new Error('thumb: ' + up.error.message);
        let originalPath = null;
        if (KEEP_ORIGINALS) {
          const ext = path.extname(f).toLowerCase();
          originalPath = `${ex.id}/${key}${ext}`;
          const o = await sb.storage.from('gallery-originals').upload(originalPath, raw, { contentType: ext === '.png' ? 'image/png' : 'image/jpeg' });
          if (o.error && !/already exists/i.test(o.error.message)) { console.error(`  원본 보관 실패 [${f}]:`, o.error.message); originalPath = null; }
        }
        const { title, year } = parseTitle(f);
        const { error } = await sb.from('gallery_artworks').insert({
          exhibition_id: ex.id, title, artist: artistName, year,
          image_path: imagePath, thumb_path: thumbPath, original_path: originalPath,
        });
        if (error) throw new Error('db: ' + error.message);
        totalUp++;
        if (totalUp % 25 === 0) console.log(`  업로드 ${totalUp}장… (현재: ${artistName})`);
      } catch (e) {
        totalErr++;
        console.error(`  실패 [${folder}/${f}]:`, e.message);
      }
    });
    if (!ex.cover_path && firstPath) await sb.from('gallery_exhibitions').update({ cover_path: firstPath }).eq('id', ex.id);
    console.log(`[${artistName}] 완료 (${files.length}장)`);
  }
  console.log(`\n=== 작가 시드 완료: 업로드 ${totalUp}, 스킵 ${totalSkip}, 실패 ${totalErr} ===`);
}
main();
