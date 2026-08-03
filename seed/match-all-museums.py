# -*- coding: utf-8 -*-
"""연번 수정본 ↔ 원본 매칭 (전 미술관).
mode=prefix: 번호 접두사 직접 매핑 / mode=content: OpenCV 템플릿 매칭
결과: seed/all-matches.json { "<수정폴더>/<파일>": {original, score, title, artist, year, confident} }
"""
import os, re, json
import numpy as np
import cv2
from PIL import Image, ImageFile
ImageFile.LOAD_TRUNCATED_IMAGES = True
Image.MAX_IMAGE_PIXELS = None

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def clean_artist(s):
    s = re.sub(r'\(.*$', '', s)
    s = re.sub(r'[,\s]*\d{4}\s*[–—-]\s*\d{4}', '', s)
    return re.sub(r'\s{2,}', ' ', s).strip()

def year_of(s):
    m = re.search(r'\b(1[4-9]\d{2}|20[0-2]\d)\b', s)
    return m.group(1) if m else ''

def strip_year_tail(s):
    return re.sub(r',?\s*\b(c\.\s*)?(1[4-9]\d{2}|20[0-2]\d)([–—-]\d{2,4})?\s*$', '', s).strip()

def cap(s):
    return ' '.join(w[:1].upper() + w[1:] if w else w for w in s.split())

def p_dash(base):  # "Title-Artist"
    i = base.rfind('-')
    if i < 1: return {'title': base}
    return {'title': strip_year_tail(base[:i].strip()), 'artist': clean_artist(base[i+1:]), 'year': year_of(base[:i])}

def p_reims(base):  # "ARTIST, Title"
    i = base.find(',')
    if i < 0: return {'title': base}
    return {'artist': cap(clean_artist(base[:i]).lower()), 'title': base[i+1:].strip(), 'year': year_of(base)}

def p_munch(base):
    return {'artist': 'Edvard Munch', 'title': re.sub(r'^\d+_', '', base), 'year': year_of(base)}

def p_nga(base):
    t = re.sub(r'_?\d{4}\.\d+\.\d+.*$', '', base).replace('_', ' ').strip()
    return {'title': cap(t)}

def p_title(base):
    return {'title': base}

def p_lenbach(base):  # "NNNN_Artist, Title"
    m = re.match(r'^\d+_(.+)$', base)
    if not m: return {'title': base}
    rest = m.group(1)
    i = rest.find(', ')
    if i < 0: return {'title': rest}
    return {'artist': clean_artist(rest[:i]), 'title': rest[i+2:].strip(), 'year': year_of(base)}

def p_niva(base):  # "Artist-Title, year"
    i = base.find('-')
    if i < 1: return {'title': base}
    t = base[i+1:].strip()
    return {'artist': clean_artist(base[:i]), 'title': strip_year_tail(t), 'year': year_of(t)}

def p_getty(base):  # "Title_year_Artist (…)"
    p = base.split('_')
    if len(p) >= 3:
        return {'title': p[0].strip(), 'year': year_of(p[1]), 'artist': clean_artist('_'.join(p[2:]))}
    return {'title': base}

def p_yale_univ(base):
    m = re.match(r'^(.+?\))-(.+)$', base)          # "Artist (…)-Title"
    if m: return {'artist': clean_artist(m.group(1)), 'title': m.group(2).strip()}
    m = re.match(r'^(.+)-([^-]+\([^)]*\))$', base)  # "Title-Artist (…)"
    if m: return {'title': m.group(1).strip(), 'artist': clean_artist(m.group(2))}
    return p_dash(base)

def p_basel(base):  # "NN_NNN-slug-words_hash"
    m = re.match(r'^\d+_\d+-(.+?)_[0-9a-f]{6,}$', base)
    if not m: return {'title': base}
    toks = m.group(1).split('-')
    if len(toks) <= 3: return {'title': cap(' '.join(toks))}
    return {'artist': cap(' '.join(toks[:2])), 'title': cap(' '.join(toks[2:]))}

# (수정폴더, 원본폴더, 파서, 모드)
JOBS = [
    ('Thielska Galleriet_수정', '01.원본/미술관/Thielska Galleriet', p_dash, 'content'),
    ('wienmuseum_수정', '01.원본/미술관/wienmuseum', p_dash, 'content'),
    ('musees-reims_수정', '01.원본/미술관/musees-reims', p_reims, 'content'),
    ('Munchmuseet Billedarkiv_수정', '01.원본/미술관/Munchmuseet Billedarkiv', p_munch, 'prefix'),
    ('National Gallery of Art_수정', '01.원본/미술관/National Gallery of Art', p_nga, 'content'),
    ('National Museum in Krakow선별수정', '01.원본/미술관/National Museum in Krakow', p_title, 'content'),
    ('National Museum, Norway_수정', '01.원본/미술관/National Museum, Norway', p_dash, 'content'),
    ('Lenbachhaus_수정', '01.원본/미술관/Lenbachhaus', p_lenbach, 'prefix'),
    ('Nivaagaard_수정', '01.원본/미술관/Nivaagaard', p_niva, 'content'),
    ('J. Paul Getty Museum선별수정', '01.원본/미술관/J. Paul Getty Museum', p_getty, 'content'),
    ('YALE UNIVERSITY ART GALLERY_수정', '01.원본/미술관/YALE UNIVERSITY ART GALLERY', p_yale_univ, 'content'),
    ('kunstmuseumbasel_수정', '01.원본/미술관/kunstmuseumbasel', p_basel, 'content'),
]

def load_gray(path, maxside=440):
    im = Image.open(path)
    im.thumbnail((maxside, maxside), Image.BILINEAR)
    return cv2.cvtColor(np.array(im.convert('RGB')), cv2.COLOR_RGB2GRAY)

def best_score(orig_g, edit_g):
    H, W = orig_g.shape
    best = -1.0
    for frac in (1.0, 0.9, 0.8, 0.7, 0.6):
        tw = int(W * frac); th = int(tw * 9 / 16)
        if tw >= 24 and th >= 24 and th <= H and tw <= W:
            t = cv2.resize(edit_g, (tw, th), interpolation=cv2.INTER_AREA)
            best = max(best, float(cv2.matchTemplate(orig_g, t, cv2.TM_CCOEFF_NORMED).max()))
    for frac in (1.0, 0.9, 0.8):
        th = int(H * frac); tw = int(th * 16 / 9)
        if tw >= 24 and th >= 24 and th <= H and tw <= W:
            t = cv2.resize(edit_g, (tw, th), interpolation=cv2.INTER_AREA)
            best = max(best, float(cv2.matchTemplate(orig_g, t, cv2.TM_CCOEFF_NORMED).max()))
    return best

out = {}
for edit_folder, orig_rel, parser, mode in JOBS:
    edit_dir = os.path.join(ROOT, '03.수정', edit_folder)
    orig_dir = os.path.join(ROOT, orig_rel)
    edits = sorted(f for f in os.listdir(edit_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png')))
    origs = sorted(f for f in os.listdir(orig_dir) if f.lower().endswith(('.tif', '.tiff', '.jpg', '.jpeg', '.png')))
    print(f'[{edit_folder}] 수정 {len(edits)} / 원본 {len(origs)} / {mode}', flush=True)

    if mode == 'prefix':
        # 원본 "NNNN_..." 접두번호 → 수정 "NNNN.jpg" 직접 매핑
        omap = {}
        for of in origs:
            m = re.match(r'^(\d+)_', of)
            if m: omap[m.group(1).lstrip('0') or '0'] = of
        for ef in edits:
            num = re.sub(r'\.[^.]+$', '', ef).lstrip('0') or '0'
            of = omap.get(num)
            if not of:
                out[f'{edit_folder}/{ef}'] = {'original': None, 'score': 0, 'confident': False, 'title': '', 'artist': '', 'year': ''}
                print(f'  {ef} -> 접두번호 매칭 실패', flush=True)
                continue
            meta = parser(re.sub(r'\.[^.]+$', '', of))
            out[f'{edit_folder}/{ef}'] = {'original': of, 'score': 1.0, 'confident': True,
                'title': meta.get('title', ''), 'artist': meta.get('artist', ''), 'year': meta.get('year', '')}
        continue

    ogs = {}
    for f in origs:
        try: ogs[f] = load_gray(os.path.join(orig_dir, f))
        except Exception as e: print('  원본 로드 실패:', f, e, flush=True)
    for ef in edits:
        try:
            eg = load_gray(os.path.join(edit_dir, ef), 340)
        except Exception as e:
            print('  수정본 로드 실패:', ef, e, flush=True); continue
        scores = sorted(((best_score(og, eg), of) for of, og in ogs.items()), reverse=True)
        top = scores[0]; second = scores[1] if len(scores) > 1 else (0, '')
        base = re.sub(r'\.[^.]+$', '', top[1]).rstrip('.')
        meta = parser(base)
        ok = top[0] >= 0.55 and (top[0] - second[0]) >= 0.03
        out[f'{edit_folder}/{ef}'] = {'original': top[1], 'score': round(top[0], 3),
            'margin': round(top[0] - second[0], 3), 'confident': ok,
            'title': meta.get('title', ''), 'artist': meta.get('artist', ''), 'year': meta.get('year', '')}
        flag = 'OK' if ok else '❓'
        print(f'  {ef} -> {top[1][:48]} ({top[0]:.2f}/{top[0]-second[0]:.2f}) {flag}', flush=True)

dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'all-matches.json')
json.dump(out, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
conf = sum(1 for v in out.values() if v['confident'])
print(f'=== 전체 매칭 완료: {conf}/{len(out)} 확신 ===', flush=True)
