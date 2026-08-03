/** content-matches.json(이미지 매칭 결과)을 DB 메타에 반영. confident=true만 적용. */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const crypto = require('crypto');
const md5 = s => crypto.createHash('md5').update(s).digest('hex');
const ADMIN_PW = process.env.ADMIN_PW;
if (!ADMIN_PW) { console.error('ADMIN_PW 필요'); process.exit(1); }
const sb = createClient('https://cdlmkleujbxzrunudtvu.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNkbG1rbGV1amJ4enJ1bnVkdHZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNzMzOTgsImV4cCI6MjA5MzY0OTM5OH0.G26w_yE4ErRXCsHmWPphN4TccVmiivdd5OoPjv2dPdo');
const MATCHES = JSON.parse(fs.readFileSync(__dirname + '/' + (process.env.MATCH_FILE || 'content-matches.json'), 'utf8'));

(async () => {
  const { error: le } = await sb.auth.signInWithPassword({ email: 'gallery-admin@wellbianlabs.io', password: ADMIN_PW });
  if (le) throw new Error(le.message);
  // 전체 작품 로드 (페이지네이션)
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('gallery_artworks').select('id, image_path').range(from, from + 999);
    if (error) throw new Error(error.message);
    all.push(...data);
    if (data.length < 1000) break;
  }
  const byKey = new Map();
  for (const a of all) {
    const m = a.image_path.match(/\/([0-9a-f]{16})\.jpg$/);
    if (m) byKey.set(m[1], a);
  }
  let ok = 0, skip = 0, miss = 0;
  for (const [relKey, v] of Object.entries(MATCHES)) {
    if (!v.confident) { skip++; console.log('보류(불확실):', relKey, '->', v.original.slice(0, 50), v.score); continue; }
    const key = md5(relKey).slice(0, 16);
    const a = byKey.get(key);
    if (!a) { miss++; continue; }
    const year = v.year || (v.title.match(/\b(1[4-9]\d{2}|20[0-2]\d)\b/) || [])[1] || '';
    const { error } = await sb.from('gallery_artworks').update({
      title: v.title.slice(0, 300), artist: v.artist.slice(0, 200), year,
    }).eq('id', a.id);
    if (error) console.error('실패:', relKey, error.message);
    else ok++;
  }
  console.log(`=== 적용 ${ok}건 / 보류 ${skip}건 / DB미매칭 ${miss}건 ===`);
})();
