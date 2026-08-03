# -*- coding: utf-8 -*-
"""연번 수정본 ↔ 원본 TIF 이미지 내용 매칭 (수정본 = 원본의 16:9 크롭이라는 성질 이용)
결과: seed/content-matches.json  { "<수정폴더>/<파일>": {"original": "...", "score": 0.9, "title": "...", "artist": "...", } }
"""
import os, re, json, sys
import numpy as np
import cv2
from PIL import Image, ImageFile
ImageFile.LOAD_TRUNCATED_IMAGES = True
Image.MAX_IMAGE_PIXELS = None

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # online gallery/
PAIRS = [
    ('03.수정/스웨덴국립미술관_수정', '01.원본/미술관/스웨덴국립미술관', 'sweden'),
    ('03.수정/예일센터브리티시아트_수정', '01.원본/미술관/예일센터브리티시아트', 'yale'),
]

def load_gray(path, maxside=480):
    im = Image.open(path)
    im.thumbnail((maxside, maxside), Image.BILINEAR)
    g = cv2.cvtColor(np.array(im.convert('RGB')), cv2.COLOR_RGB2GRAY)
    return g

def best_score(orig_g, edit_g):
    """수정본(16:9)이 원본의 풀-가로 또는 풀-세로 크롭이라 가정하고 최적 상관 점수."""
    H, W = orig_g.shape
    best = -1.0
    # 후보 스케일: 크롭 폭이 원본 폭의 60~100%
    for frac in (1.0, 0.9, 0.8, 0.7, 0.6):
        tw = int(W * frac)
        th = int(tw * 9 / 16)
        if tw < 24 or th < 24 or th > H or tw > W:
            continue
        t = cv2.resize(edit_g, (tw, th), interpolation=cv2.INTER_AREA)
        r = cv2.matchTemplate(orig_g, t, cv2.TM_CCOEFF_NORMED)
        best = max(best, float(r.max()))
    # 풀-세로 크롭 후보
    for frac in (1.0, 0.9, 0.8):
        th = int(H * frac)
        tw = int(th * 16 / 9)
        if tw < 24 or th < 24 or th > H or tw > W:
            continue
        t = cv2.resize(edit_g, (tw, th), interpolation=cv2.INTER_AREA)
        r = cv2.matchTemplate(orig_g, t, cv2.TM_CCOEFF_NORMED)
        best = max(best, float(r.max()))
    return best

def parse_sweden(fn):
    base = re.sub(r'\.[^.]+$', '', fn).replace('_', ' ')
    base = re.sub(r'\s*-\s*Nationalmuseum\s*-\s*\d+\s*$', '', base).strip()
    m = re.search(r'\(([^()]+)\)\s*$', base)
    artist = m.group(1).strip() if m else ''
    title = re.sub(r'\s*\([^()]*\)\s*$', '', base).strip()
    title = re.sub(r'\s*NM \d[\d\- ]*$', '', title).strip()
    return title, artist

def parse_yale(fn):
    base = re.sub(r'\.[^.]+$', '', fn)
    parts = [p.strip() for p in base.split(', ')]
    artist = re.sub(r'^(Attributed to|After|Circle of|Follower of)\s+', '', parts[0]).strip()
    title = parts[-1]
    return title, artist

out = {}
for edit_rel, orig_rel, kind in PAIRS:
    edit_dir = os.path.join(ROOT, edit_rel)
    orig_dir = os.path.join(ROOT, orig_rel)
    edits = sorted(f for f in os.listdir(edit_dir) if f.lower().endswith('.jpg'))
    origs = sorted(f for f in os.listdir(orig_dir) if f.lower().endswith(('.tif', '.tiff', '.jpg', '.jpeg', '.png')))
    print(f'[{kind}] 원본 {len(origs)}장 로드 중...', flush=True)
    ogs = {}
    for f in origs:
        try:
            ogs[f] = load_gray(os.path.join(orig_dir, f))
        except Exception as e:
            print('  원본 로드 실패:', f, e, flush=True)
    print(f'[{kind}] 매칭 시작 ({len(edits)}장)', flush=True)
    for ef in edits:
        eg = load_gray(os.path.join(edit_dir, ef), 360)
        scores = []
        for of, og in ogs.items():
            scores.append((best_score(og, eg), of))
        scores.sort(reverse=True)
        top, second = scores[0], scores[1] if len(scores) > 1 else (0, '')
        title, artist = (parse_sweden if kind == 'sweden' else parse_yale)(top[1])
        ok = top[0] >= 0.55 and (top[0] - second[0]) >= 0.03
        out[f'{edit_rel.split("/")[-1]}/{ef}'] = {
            'original': top[1], 'score': round(top[0], 3), 'margin': round(top[0] - second[0], 3),
            'title': title, 'artist': artist, 'confident': ok,
        }
        print(f'  {ef} -> {top[1][:55]} ({top[0]:.2f}/margin {top[0]-second[0]:.2f}) {"OK" if ok else "❓"}', flush=True)

dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'content-matches.json')
json.dump(out, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
conf = sum(1 for v in out.values() if v['confident'])
print(f'=== 매칭 완료: {conf}/{len(out)} 확신 ===', flush=True)
