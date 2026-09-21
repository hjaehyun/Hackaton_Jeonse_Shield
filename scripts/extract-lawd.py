"""Build-time only: extract official legal-district codes without API calls."""
import gzip
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
archive = ROOT / 'research/lawd-original.zip'
with zipfile.ZipFile(archive) as z:
    entry = z.infolist()[0]
    text = z.read(entry).decode('cp949')
    source_timestamp = '-'.join(f'{n:02d}' for n in entry.date_time[:3])
# Parent codes of cities that contain autonomous districts. The real-estate
# transaction API answers totalCount=0 for every one of them; only the district
# codes carry data. Verified against the live API on 2026-09-21 for all 13.
# A structural rule ("trailing 0 with a 4-digit-prefix sibling") is not usable
# here: it misclassifies 43740 영동군 / 43745 증평군, which are separate counties.
PARENT_CITY_CODES = {
    '41110',  # 수원시
    '41130',  # 성남시
    '41170',  # 안양시
    '41190',  # 부천시
    '41270',  # 안산시
    '41280',  # 고양시
    '41460',  # 용인시
    '41590',  # 화성시
    '43110',  # 청주시
    '44130',  # 천안시
    '47110',  # 포항시
    '48120',  # 창원시
    '52110',  # 전주시
}

rows = [line.split('\t') for line in text.splitlines()[1:] if line.strip()]
selected = [(code, ' '.join(name.split())) for code, name, status in rows
            if len(code) == 10 and code.endswith('00000') and status == '존재']
groups = {}
dropped_parents = []
for code, name in selected:
    parts = name.split(' ', 1)
    sido = parts[0]
    groups.setdefault(sido, [])
    # Province rows form group labels, not LAWD_CD options. Sejong is 36110.
    if code[2:5] == '000':
        continue
    if code[:5] in PARENT_CITY_CODES:
        dropped_parents.append(code[:5])
        continue
    groups[sido].append({'code': code[:5], 'name': parts[1] if len(parts) > 1 else sido})
assert set(dropped_parents) == PARENT_CITY_CODES, \
    f'parent-city filter drifted: {sorted(PARENT_CITY_CODES - set(dropped_parents))}'
result = [{'sido': sido, 'items': items} for sido, items in groups.items()]
assert all(group['items'] for group in result)
codes = [item['code'] for group in result for item in group['items']]
assert len(codes) == len(set(codes)) and '36110' in codes
raw = (json.dumps(result, ensure_ascii=False, indent=2) + '\n').encode()
assert len(gzip.compress(raw, mtime=0)) < 100 * 1024
(ROOT / 'public/data/lawd.json').write_bytes(raw)
metadata = {
    'source': 'https://www.code.go.kr/etc/codeFullDown.do',
    'sourcePage': 'https://www.code.go.kr/stdcode/regCodeL.do',
    'downloadMethod': 'POST codeseId=법정동코드',
    'downloadedOn': '2026-09-21',
    'archiveEntryDate': source_timestamp,
    'officialEffectiveDate': '미확인 — ZIP 파일 시각과 시행 기준일은 구분함',
    'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
    'sourceRows': len(rows), 'activeSuffixRows': len(selected),
    'sidoCount': len(result), 'itemCount': len(codes),
    'bytes': len(raw), 'gzipBytes': len(gzip.compress(raw, mtime=0)),
    'sejongCode': '36110',
    'droppedParentCityCodes': sorted(PARENT_CITY_CODES),
    'notes': ['시도 자체 행은 그룹명으로만 사용',
              '자치구를 가진 시의 상위 코드 13개는 제외 — 실거래가 API가 totalCount=0 으로 응답 (2026-09-21 전수 실측)',
              '공백만 정리하며 행정구역 명칭과 코드는 공식 원본을 유지',
              '개편 신설 코드가 정답 — 광주 서구 신 12240 은 355건, 구 29155 는 0건 (2026-09-21 실측)']
}
(ROOT / 'research/lawd-metadata.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(metadata, ensure_ascii=False, indent=2))
