/** gallery-art 버킷에서 DB(작품/표지)가 참조하지 않는 고아 파일 제거 */
const { createClient } = require('@supabase/supabase-js');
const ADMIN_PW = process.env.ADMIN_PW;
if (!ADMIN_PW) { console.error('ADMIN_PW 필요'); process.exit(1); }
const sb = createClient('https://cdlmkleujbxzrunudtvu.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNkbG1rbGV1amJ4enJ1bnVkdHZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNzMzOTgsImV4cCI6MjA5MzY0OTM5OH0.G26w_yE4ErRXCsHmWPphN4TccVmiivdd5OoPjv2dPdo');

async function listAll(bucket, prefix) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

(async () => {
  const { error: le } = await sb.auth.signInWithPassword({ email: 'gallery-admin@wellbianlabs.io', password: ADMIN_PW });
  if (le) throw new Error(le.message);

  // DB가 참조하는 경로 전부 수집
  const referenced = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('gallery_artworks').select('image_path, thumb_path').range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const a of data) { referenced.add(a.image_path); if (a.thumb_path) referenced.add(a.thumb_path); }
    if (data.length < 1000) break;
  }
  const { data: exs } = await sb.from('gallery_exhibitions').select('cover_path');
  for (const e of exs) if (e.cover_path) referenced.add(e.cover_path);
  console.log('참조 경로:', referenced.size);

  // 버킷 전체 나열 (최상위 폴더들 → 파일 + thumbs)
  const tops = await listAll('gallery-art', '');
  const allPaths = [];
  for (const t of tops) {
    if (t.id) { allPaths.push(t.name); continue; }          // 최상위 파일
    const inner = await listAll('gallery-art', t.name);
    for (const f of inner) {
      if (f.id) allPaths.push(`${t.name}/${f.name}`);
      else {
        const deep = await listAll('gallery-art', `${t.name}/${f.name}`);
        for (const d of deep) if (d.id) allPaths.push(`${t.name}/${f.name}/${d.name}`);
      }
    }
  }
  console.log('버킷 파일:', allPaths.length);
  const orphans = allPaths.filter(p => !referenced.has(p));
  console.log('고아 파일:', orphans.length);
  for (let i = 0; i < orphans.length; i += 100) {
    const { error } = await sb.storage.from('gallery-art').remove(orphans.slice(i, i + 100));
    if (error) console.error('삭제 오류:', error.message);
  }
  console.log('=== 정리 완료 ===');
})();
