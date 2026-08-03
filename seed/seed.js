/**
 * 로컬 수정본(03.수정)을 Supabase로 시드 업로드.
 *   node seed/seed.js            # 전체 업로드 (이미 올라간 것은 건너뜀)
 *   ADMIN_PW 환경변수로 관리자 비밀번호 전달
 * 재실행 안전: 파일명 해시 기반 경로라 중복 업로드되지 않음.
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

const ROOT = path.resolve(__dirname, '..', '..');           // online gallery/
const EDITED = path.join(ROOT, '03.수정');
const DB_JSON = path.join(ROOT, 'gallery-studio', 'gallery-db.json');

const sb = createClient(SUPABASE_URL, ANON_KEY);
sharp.cache(false);

const md5 = s => crypto.createHash('md5').update(s).digest('hex');

// gallery-studio 메타 파서 재사용
function autoMeta(filename, folderName) {
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

async function main() {
  // 로그인
  const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PW });
  if (authErr) { console.error('로그인 실패:', authErr.message); process.exit(1); }
  console.log('관리자 로그인 OK');

  // 로컬 gallery-db.json 전시 메타 (이름/소개/공개/카테고리)
  let localDB = { exhibitions: {}, meta: {} };
  try { localDB = JSON.parse(fs.readFileSync(DB_JSON, 'utf8')); } catch {}
  const exMetaByFolder = {};
  for (const ex of Object.values(localDB.exhibitions || {})) {
    exMetaByFolder[path.basename(ex.folder)] = ex;
  }

  const folders = fs.readdirSync(EDITED, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
  console.log(`수정 폴더 ${folders.length}개`);

  // 기존 전시 로드
  const { data: existingExs } = await sb.from('gallery_exhibitions').select('id, name');
  const exByName = new Map((existingExs || []).map(e => [e.name, e]));

  let totalUp = 0, totalSkip = 0, totalErr = 0;
  for (const folder of folders) {
    const local = exMetaByFolder[folder];
    const name = local?.name || folder.replace(/(_수정본?|_?선별\s*수정?|_선별|선별수정)$/g, '').trim();
    // 전시 upsert
    let ex = exByName.get(name);
    if (!ex) {
      const { data, error } = await sb.from('gallery_exhibitions').insert({
        name, category: local?.category || '미술관',
        intro: local?.intro || `${name} 컬렉션의 명화를 감상하실 수 있습니다.`,
        published: local ? !!local.published : true,
      }).select().single();
      if (error) { console.error(`전시 생성 실패 [${name}]:`, error.message); continue; }
      ex = data; exByName.set(name, ex);
    }
    // 기존 작품 경로 (스킵용)
    const { data: existingArts } = await sb.from('gallery_artworks').select('image_path').eq('exhibition_id', ex.id);
    const existingPaths = new Set((existingArts || []).map(a => a.image_path));

    const dir = path.join(EDITED, folder);
    const files = fs.readdirSync(dir).filter(f => /\.(jpe?g|png)$/i.test(f)).sort();
    let coverPath = null;
    for (const f of files) {
      const key = md5(folder + '/' + f).slice(0, 16);
      const imagePath = `${ex.id}/${key}.jpg`;
      const thumbPath = `${ex.id}/thumbs/${key}.jpg`;
      if (!coverPath) coverPath = imagePath;
      if (existingPaths.has(imagePath)) { totalSkip++; continue; }
      try {
        const abs = path.join(dir, f);
        let buf = fs.readFileSync(abs);
        // 1920x1080 JPEG 보장 (아닌 경우 변환)
        const m = await sharp(buf).metadata();
        if (m.width !== 1920 || m.height !== 1080 || !/jpe?g/i.test(m.format)) {
          buf = await sharp(buf, { limitInputPixels: 1e9 }).resize(1920, 1080, { fit: 'cover', position: 'attention' }).jpeg({ quality: 90 }).toBuffer();
        }
        const thumbBuf = await sharp(buf).resize(480, 270).jpeg({ quality: 80 }).toBuffer();
        let up = await sb.storage.from('gallery-art').upload(imagePath, buf, { contentType: 'image/jpeg' });
        if (up.error && !/already exists/i.test(up.error.message)) throw new Error(up.error.message);
        up = await sb.storage.from('gallery-art').upload(thumbPath, thumbBuf, { contentType: 'image/jpeg' });
        if (up.error && !/already exists/i.test(up.error.message)) throw new Error(up.error.message);
        // 메타: 로컬 오버라이드 우선
        const relKey = `03.수정/${folder}/${f}`;
        const override = (localDB.meta || {})[relKey];
        const meta = { ...autoMeta(f, folder), ...(override || {}) };
        const { error } = await sb.from('gallery_artworks').insert({
          exhibition_id: ex.id, title: meta.title || '', artist: meta.artist || '', year: meta.year || '',
          image_path: imagePath, thumb_path: thumbPath,
        });
        if (error) throw new Error(error.message);
        totalUp++;
        if (totalUp % 25 === 0) console.log(`  업로드 ${totalUp}장… (현재: ${name})`);
      } catch (e) {
        totalErr++;
        console.error(`  실패 [${folder}/${f}]:`, e.message);
      }
    }
    // 표지 설정 (로컬 지정 표지가 있으면 해당 파일 키로)
    let cover = coverPath;
    if (local?.cover) {
      const cf = path.basename(local.cover);
      cover = `${ex.id}/${md5(folder + '/' + cf).slice(0, 16)}.jpg`;
    }
    if (cover) await sb.from('gallery_exhibitions').update({ cover_path: cover }).eq('id', ex.id);
    console.log(`[${name}] 완료 (${files.length}장)`);
  }
  console.log(`\n=== 시드 완료: 업로드 ${totalUp}, 스킵 ${totalSkip}, 실패 ${totalErr} ===`);
}
main();
