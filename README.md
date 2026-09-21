# 전세방패 (Jeonse Shield)

전월세 계약 전 3분 셀프 위험 진단 서비스의 1일차 목업입니다. 현재 결과는 실제 지역·단지 조회 결과가 아니며 실제 계약 판단에 사용할 수 없습니다.

## 실행 방법

```sh
npm ci
npm run build
pm2 start ecosystem.config.cjs
npm test
node tests/browser.mjs
```

로컬 주소: http://localhost:3000
브라우저 테스트 최초 준비: `npx playwright install --with-deps chromium`

## 기술 스택

Hono / 순수 JavaScript / Vite Pages 빌드 / Cloudflare Workers / 직접 그린 SVG. Node 내장 모듈은 빌드·테스트 도구에서만 사용하며 Worker와 프론트엔드에서는 사용하지 않습니다. 차트·UI 라이브러리와 외부 폰트·이미지 요청은 없습니다.

## 완료 기능과 사용법

1. 랜딩의 ‘내 계약 진단하기’를 선택합니다.
2. 시도 → 시군구 → 단지명 → 전용면적·보증금·월세를 입력합니다.
3. 목업 전세가율, 매매 거래 분포, 체크리스트 및 법률 정보 자리표시자를 확인합니다.

시연용 면적: 84㎡는 12건, 59㎡는 2건, 120㎡는 0건입니다. 가상 거래는 고정되어 있습니다. 보증금·월세는 만원 단위이며 월세를 전세로 환산하지 않습니다. 표본 3건 미만은 비율·매매 통계·마커를 숨깁니다. 분포 Q1/Q3은 nearest-rank이고 중위가는 짝수 표본의 중앙 두 값 평균입니다.

## 진입 경로

- `/#home`: 랜딩
- `/#diagnosis`: 3단계 입력
- `/#result`: 입력을 완료한 현재 탭의 목업 결과. 새로고침하면 입력 상태가 사라져 홈으로 돌아갑니다.
- `/data/lawd.json`: 정적 법정동코드
- `/api/health`: 목업 실행 상태
- `/api/debug/sample?kind=rent|trade&lawdCd=11110&ym=202607`: 기본 비활성화(404). 별도 승인 후 로컬에서만 키·플래그를 설정하여 확인하고, 실제 필드명 확인이 끝나면 삭제할 임시 라우트입니다.

## 데이터 구조 및 출처

- 거래: `{ name, area, price }`, 가상 단일 단지, 14건. 매매 `price`는 만원.
- 법정동: `[{ sido, items: [{ code, name }] }]`. 공식 원본 53,387행에서 필터링하여 16개 시도 그룹·269개 선택 항목. 시도 자체 행은 그룹 제목이며, 세종 36110 포함. 하위 구가 있는 시의 상위 코드도 지시서 규칙에 따라 유지했습니다.
- 공식 원본: https://www.code.go.kr/stdcode/regCodeL.do — 2026-09-21 수집, ZIP 내부 파일 시각 2026-09-17. 개별 코드 시행 기준일은 미확인.
- 재생성: `python scripts/extract-lawd.py`. 원본과 메타데이터는 `research/`.
- 예정 API: 국토교통부 아파트 전월세/매매 실거래가(https://www.data.go.kr), 법제처 국가법령정보 공동활용(https://open.law.go.kr).
- 오늘 실거래가·법령 API 호출 없음. D1은 바인딩 조사만 하고 캐시·테이블·결과 저장은 구현하지 않습니다. 입력과 체크 상태는 화면 메모리에서만 사용하며 서버·localStorage·sessionStorage에 저장하지 않습니다.

## 배포 상태 및 설정

- 프로덕션: https://ee28b90e-b6b6-441a-be3e-dc934c68e7a5.vip.gensparksite.com
- 미리보기: https://3000-ihlbg1hmigujreasfv672-3c7ff1b5.sandbox.novita.ai
- Genspark Workers for Platform 최초 배포 완료. 공개 health 응답 200 및 D1 SELECT 1 → 1 확인. 최종 수정본 반영 상태는 `REPORT.md` 참조.
- 관리 Worker 이름: `ee28b90e-b6b6-441a-be3e-dc934c68e7a5`.
- 관리 D1 이름: `ee28b90e-b6b6-441a-be3e-dc934c68e7a5-db`, 실제 ID `b0f9e541-9ed1-4943-9a0e-75b934815f64`. 사용자 테이블·뷰·인덱스는 0개.
- `wrangler.jsonc`: Pages 빌드 출력 `dist`, D1 바인딩 `DB` 1개. KV와 Node 호환 플래그 없음.
- 정적 파일: 빌드 시 `public/`을 `dist/`로 복사, Pages 및 Hosted의 네이티브 `ASSETS.fetch`로 서빙. KV manifest 기반의 구형 Workers static helper는 사용하지 않음. Hono 빌드 옵션 `emptyOutDir: true`로 오래된 출력 정리.
- 시크릿: 로컬은 무시되는 `.dev.vars`의 env 바인딩. 호스팅은 `gsk hosted secret_put` 지원을 확인했지만 실제 키 주입·읽힘은 미확인. 호스팅 시크릿 목록 0개 확인. 키는 프론트엔드·소스·설정에 넣지 않음.

## 미구현 및 다음 단계

실제 API와 XML 필드명 검증, 정규화, 법령·판례 조회, LLM 요약, D1 캐시, 단지 자동완성은 내일 이후 범위입니다. 로그인·결과 저장·지도·아파트 외 주택은 오늘 구현하지 않습니다. 우선 실제 키와 제한된 디버그 검사 승인 후 필드명을 확정하고 임시 라우트를 삭제해야 합니다.

## 스크린샷

`artifacts/landing-360.png`, `artifacts/wizard-360.png`, `artifacts/result-360.png`에 모바일 캡처가 있습니다. `1440` 버전은 데스크톱, `-full` 버전은 전체 문서 캡처입니다. 고정 푸터는 실제 화면 하단에 고정되며 전체 문서 캡처에서는 뷰포트 높이 위치에 나타납니다.

## 검증과 보고서

단위·라우트 20개 통과. Chromium 360/390/768/1440px의 브라우저 검사 36개 통과. 가로 넘침·입력 검사·표본 부족·월세·100% 초과·체크리스트·XSS·세종·네트워크 오류를 검증했습니다. 사용자 지정 9개 항목 보고서, 첫 2개 시도 JSON, 키 노출 검사 전체 원문은 `REPORT.md`에 있습니다. 상세 증빙은 `artifacts/`를 참조하세요.

MIT License. 본 서비스는 참고용 정보이며 법률 자문이 아닙니다.
