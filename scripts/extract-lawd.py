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
rows = [line.split('\t') for line in text.splitlines()[1:] if line.strip()]
selected = [(code, ' '.join(name.split())) for code, name, status in rows
            if len(code) == 10 and code.endswith('00000') and status == '존재']
groups = {}
for code, name in selected:
    parts = name.split(' ', 1)
    sido = parts[0]
    groups.setdefault(sido, [])
    # Province rows form group labels, not LAWD_CD options. Sejong is 36110.
    if code[2:5] == '000':
        continue
    groups[sido].append({'code': code[:5], 'name': parts[1] if len(parts) > 1 else sido})
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
    'notes': ['시도 자체 행은 그룹명으로만 사용', '하위 구가 있는 시의 상위 시 코드도 추출 규칙에 따라 유지',
              '공백만 정리하며 행정구역 명칭과 코드는 공식 원본을 유지', '실거래가 API의 개별 코드 지원 여부는 미확인']
}
(ROOT / 'research/lawd-metadata.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(metadata, ensure_ascii=False, indent=2))
