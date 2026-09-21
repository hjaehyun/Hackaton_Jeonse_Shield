# 9/21 작업 보고서 — 전세방패

작성 기준: 2026-09-21. 실제 실거래가·법령 API를 호출하지 않는다는 승인된 권장안을 적용했습니다. 아래에서 로컬 디버그 라우트 응답과 국토교통부 원격 API 응답을 구분합니다.

## 1. 실거래가 API 응답 원문

### 1-1. 전월세 (`/api/debug/sample?kind=rent`)

HTTP 상태: 실제 실거래가 API는 미확인(호출하지 않음). 로컬 임시 라우트는 404 Not Found로 비활성화를 확인했습니다.
x-cors-check 헤더 값: 실제 API는 미확인. 비활성 로컬 라우트에는 해당 헤더가 없습니다.

<item> 1건 원문 (가공 없이 그대로):
```xml
미확인 — 실제 API를 호출하지 않아 받은 원문이 없습니다.
```

### 1-2. 매매 (`/api/debug/sample?kind=trade`)

HTTP 상태: 실제 실거래가 API는 미확인(호출하지 않음). 로컬 임시 라우트는 404 Not Found로 비활성화를 확인했습니다.
x-cors-check 헤더 값: 실제 API는 미확인. 비활성 로컬 라우트에는 해당 헤더가 없습니다.

<item> 1건 원문 (가공 없이 그대로):
```xml
미확인 — 실제 API를 호출하지 않아 받은 원문이 없습니다.
```

### 1-3. 필드명 판정

전월세 응답의 태그명은 미확인이다. 영문 / 한글 / 혼재 여부를 추측하지 않았다.
매매 응답의 태그명은 미확인이다. 영문 / 한글 / 혼재 여부를 추측하지 않았다.

| 의미 | 전월세 실제 태그명 | 매매 실제 태그명 |
|---|---|---|
| 건물명 | 미확인 | 미확인 |
| 전용면적 | 미확인 | 미확인 |
| 보증금 | 미확인 | (해당없음) |
| 월세 | 미확인 | (해당없음) |
| 거래금액 | (해당없음) | 미확인 |
| 층 | 미확인 | 미확인 |
| 법정동 | 미확인 | 미확인 |
| 계약년 | 미확인 | 미확인 |
| 계약월 | 미확인 | 미확인 |

에러 응답이 있었다면 원문:
```
실제 API 에러 응답: 미확인 — 원격 요청하지 않음.
로컬 디버그 비활성화 응답 원문:
{"error":"DEBUG_DISABLED","message":"디버그 라우트는 비활성화되어 있습니다."}
```

## 2. 배포 환경 조사 결과

| 항목 | 결과 |
|---|---|
| 시크릿 주입 방법 | `gsk hosted secret_put --help`에서 호스팅 시크릿 등록 기능을 확인. 로컬은 `.dev.vars`의 env 바인딩 방식. 실제 키 주입은 미실행. `gsk hosted secret_list`로 등록된 시크릿 0개 확인. |
| `wrangler secret put` 동작 여부 | 미확인 — 사용자 개인 CF 계정 경로가 아닌 Genspark 호스팅 경로를 선택했으며 실제 키도 제공되지 않음. 대신 호스팅 전용 명령 지원을 확인. |
| `c.env.DATA_GO_KR_KEY` 로 읽힘 | 실제 키는 미확인. 단위 테스트에서 테스트용 가짜 env 값 전달과 비활성화/키 미설정 방어 분기를 확인. |
| D1 생성 가능 여부 | 로컬 생성 및 `SELECT 1 AS binding_ok` → 1 확인. 프로덕션 생성 및 `gsk hosted d1_query`의 SELECT 1 → 1 확인. 사용자 테이블/뷰/인덱스 각 0개. |
| D1 `database_id` | `b0f9e541-9ed1-4943-9a0e-75b934815f64`. `gsk hosted d1_schema` 및 리소스 메타데이터에서 실제 ID를 확인한 뒤 설정에 기록. 관리 DB 이름은 `ee28b90e-b6b6-441a-be3e-dc934c68e7a5-db`. |
| `kv_namespaces` 없이 배포 검증 통과 | 통과. 설정에 해당 필드 없음. 로컬 빌드·실행 및 Genspark Publish preflight와 Workers for Platform 배포 성공. D1/ASSETS 바인딩 확인. |
| 배포 URL 형태 | `https://ee28b90e-b6b6-441a-be3e-dc934c68e7a5.vip.gensparksite.com` — Genspark 제공 도메인, workers.dev 아님. 미리보기는 `https://3000-ihlbg1hmigujreasfv672-3c7ff1b5.sandbox.novita.ai`. |
| 정적 파일 서빙 설정 | Vite Pages 빌드가 `public/`을 `dist/`로 복사. `pages_build_output_dir: ./dist`. `/`는 Hono에서 네이티브 `c.env.ASSETS.fetch`로 처리, 그 외 정적 파일은 Pages 빌드 라우트 제외 목록으로 직접 서빙. `/`, `/app.js`, `/data/lawd.json` 응답과 브라우저 실행 확인. |
| `nodejs_compat` 필요 여부 | 현재 구현은 불필요. 플래그 없이 로컬 빌드·라우트·브라우저 테스트와 프로덕션 배포·health 응답 통과. |

추가 확인:
- Worker 런타임과 프론트엔드에는 `process.env`, Node 내장 모듈, Express, XML 파서가 없습니다. 빌드/테스트/데이터 추출은 샌드박스 전용 도구이며 Workers 런타임에 번들하지 않습니다.
- 계산과 정렬은 브라우저에서 고정 목업에 수행합니다. 서버 CPU 10ms 달성 여부를 별도로 계측하지 않았으며 지연시간과 CPU 시간을 혼동하지 않습니다.
- D1 캐시·테이블·로그인·결과 저장은 구현하지 않았습니다.
- 초기 `gsk hosted worker_get`은 이 프로젝트에 기존 Worker가 없다고 응답했습니다. 이후 승인된 최초 배포·최종 재배포를 완료했고, 공개 사이트의 `/api/health`는 HTTP 200입니다.
- 공개 사이트에서도 rent/trade 디버그 라우트 모두 HTTP 404와 DEBUG_DISABLED를 확인했습니다. 실제 국토교통부 API 요청이 아닙니다.
- 실제 발급 ID만 사용했고, DB 재생성·Worker 삭제·초기화 옵션은 사용하지 않았습니다.

배포 중 발생한 에러가 있으면 원문:
```
최초 프로덕션 배포: 에러 없이 완료. Publish preflight passed 및 Workers for Platform deployment completed 확인.
최종 수정본 재배포: 승인 후 에러 없이 완료.
Current Version ID: 8d8dcb62-f833-49a2-868f-e06477723ff2
공개 사이트에서 브라우저 36개 검사 통과 및 정적 파일 5개의 로컬 빌드 일치 확인.

프로덕션 파일 비교 중 Python urllib 요청 오류(curl로 재검증 완료):
urllib.error.HTTPError: HTTP Error 403: Forbidden

로컬 정적 파일 처리 중 발생한 에러(수정 완료):
ReferenceError: __STATIC_CONTENT_MANIFEST is not defined

원인: 구형 Hono Workers 정적 파일 helper가 KV manifest를 요구함.
수정: 현재 Pages/Hosted 환경의 네이티브 ASSETS.fetch 사용.
재검증: GET / 및 정적 자원 HTTP 200, 브라우저 오류 0.

사전 조사 명령 오류(실제 배포 오류와 구분):
error: required option '--kind <kind>' not specified

Check the project kind, name, operation, and project ID.

[ERROR] HTTP 400: {"detail":{"code":"developer_project_required","message":"Bind a Developer v2 project."}}

위 Developer v2 프로젝트 조사 명령은 현재 프로젝트에서 사용할 수 없었음.
프로젝트를 임의로 생성·전환하지 않고 현재 프로젝트의 hosted 명령으로 진행함.
```

## 3. 법정동코드 데이터

| 항목 | 값 |
|---|---|
| 원본 출처 / 기준일자 | 행정표준코드관리시스템 `https://www.code.go.kr/stdcode/regCodeL.do`, 전체 다운로드 `https://www.code.go.kr/etc/codeFullDown.do`에 `codeseId=법정동코드` POST. 수집일 2026-09-21. ZIP 내부 파일 시각 2026-09-17 09:09:30. 공식 시행 기준일은 미확인(파일 시각과 구분). |
| 시도 개수 | 16개 그룹 — 내려받은 원본의 존재 상태를 따름. |
| 시군구 총 개수 | 선택 항목 269개. 53,387행 중 존재·뒤5자리00000인 284행에서 시도 자체 15행을 그룹 제목으로 분리. 세종 36110은 선택 항목 유지. 상위 시와 하위 구가 함께 포함되어 일반적인 자치단체 개수와 다름. |
| 세종특별자치시 포함 여부 | 포함. `sido: 세종특별자치시`, `code: 36110`, `name: 세종특별자치시`. |
| 제주·강원 특별자치도 표기 | 원본의 `제주특별자치도`, `강원특별자치도` 그대로 사용. `전북특별자치도`도 원본 표기 유지. |
| 파일 크기 (원본 / gzip) | 최종 `lawd.json` 20,192 bytes / gzip 2,428 bytes. gzip 100KB 미만. 다운로드 원본 ZIP은 413,346 bytes. |

`lawd.json` 샘플 (앞 2개 시도만):
```json
[
  {
    "sido": "서울특별시",
    "items": [
      {
        "code": "11110",
        "name": "종로구"
      },
      {
        "code": "11140",
        "name": "중구"
      },
      {
        "code": "11170",
        "name": "용산구"
      },
      {
        "code": "11200",
        "name": "성동구"
      },
      {
        "code": "11215",
        "name": "광진구"
      },
      {
        "code": "11230",
        "name": "동대문구"
      },
      {
        "code": "11260",
        "name": "중랑구"
      },
      {
        "code": "11290",
        "name": "성북구"
      },
      {
        "code": "11305",
        "name": "강북구"
      },
      {
        "code": "11320",
        "name": "도봉구"
      },
      {
        "code": "11350",
        "name": "노원구"
      },
      {
        "code": "11380",
        "name": "은평구"
      },
      {
        "code": "11410",
        "name": "서대문구"
      },
      {
        "code": "11440",
        "name": "마포구"
      },
      {
        "code": "11470",
        "name": "양천구"
      },
      {
        "code": "11500",
        "name": "강서구"
      },
      {
        "code": "11530",
        "name": "구로구"
      },
      {
        "code": "11545",
        "name": "금천구"
      },
      {
        "code": "11560",
        "name": "영등포구"
      },
      {
        "code": "11590",
        "name": "동작구"
      },
      {
        "code": "11620",
        "name": "관악구"
      },
      {
        "code": "11650",
        "name": "서초구"
      },
      {
        "code": "11680",
        "name": "강남구"
      },
      {
        "code": "11710",
        "name": "송파구"
      },
      {
        "code": "11740",
        "name": "강동구"
      }
    ]
  },
  {
    "sido": "전남광주통합특별시",
    "items": [
      {
        "code": "12110",
        "name": "목포시"
      },
      {
        "code": "12130",
        "name": "여수시"
      },
      {
        "code": "12150",
        "name": "순천시"
      },
      {
        "code": "12170",
        "name": "나주시"
      },
      {
        "code": "12190",
        "name": "광양시"
      },
      {
        "code": "12210",
        "name": "동구"
      },
      {
        "code": "12240",
        "name": "서구"
      },
      {
        "code": "12270",
        "name": "남구"
      },
      {
        "code": "12300",
        "name": "북구"
      },
      {
        "code": "12330",
        "name": "광산구"
      },
      {
        "code": "12710",
        "name": "담양군"
      },
      {
        "code": "12720",
        "name": "곡성군"
      },
      {
        "code": "12730",
        "name": "구례군"
      },
      {
        "code": "12740",
        "name": "고흥군"
      },
      {
        "code": "12750",
        "name": "보성군"
      },
      {
        "code": "12760",
        "name": "화순군"
      },
      {
        "code": "12770",
        "name": "장흥군"
      },
      {
        "code": "12780",
        "name": "강진군"
      },
      {
        "code": "12790",
        "name": "해남군"
      },
      {
        "code": "12800",
        "name": "영암군"
      },
      {
        "code": "12810",
        "name": "무안군"
      },
      {
        "code": "12820",
        "name": "함평군"
      },
      {
        "code": "12830",
        "name": "영광군"
      },
      {
        "code": "12840",
        "name": "장성군"
      },
      {
        "code": "12850",
        "name": "완도군"
      },
      {
        "code": "12860",
        "name": "진도군"
      },
      {
        "code": "12870",
        "name": "신안군"
      }
    ]
  }
]
```

추출 과정에서 애매했던 케이스와 처리 방법:
- 시도 행도 뒤 5자리가 00000이지만 지역 선택 항목이 아니라 그룹 제목으로 사용했습니다.
- 세종은 하위 시군구 없이 존재하는 `3611000000`을 `36110` 선택 항목으로 유지했습니다.
- 수원시/수원시 장안구 등 상위 시와 하위 구가 모두 필터에 맞으므로 임의로 삭제하지 않고 함께 유지했습니다. 실제 실거래가 API에서 각 코드 지원 여부는 미확인입니다.
- 부천시 구 명칭 등의 끝 공백은 정리했습니다. 코드·명칭 자체는 바꾸지 않았습니다.
- 공식 원본에 `전남광주통합특별시`, 인천광역시 제물포구·영종구·서해구·검단구 등이 존재 상태로 있어 그대로 반영했습니다. 과거 17개 시도 목록을 덮어쓰지 않았습니다.
- 추출 스크립트, 원본 ZIP, SHA-256 및 개수·크기 메타데이터를 `research/`와 `scripts/extract-lawd.py`에 보존했습니다. 다운로드 응답의 쿠키는 저장소에 남기지 않도록 가렸습니다.

## 4. 생성된 파일 트리

```
/home/user/webapp/
├── .env.example
├── .gitignore
├── LICENSE
├── README.md
├── REPORT.md
├── artifacts/
│   ├── browser-results.json
│   ├── browser-test-output.txt
│   ├── landing-1440-full.png
│   ├── landing-1440.png
│   ├── landing-360-full.png
│   ├── landing-360.png
│   ├── local-browser-results.json
│   ├── production-browser-results.json
│   ├── production-browser-test-output.txt
│   ├── production-verification.json
│   ├── result-1440-full.png
│   ├── result-1440.png
│   ├── result-360-full.png
│   ├── result-360.png
│   ├── result-insufficient-360-full.png
│   ├── result-insufficient-360.png
│   ├── unit-tests.txt
│   ├── wizard-1440-full.png
│   ├── wizard-1440.png
│   ├── wizard-360-full.png
│   ├── wizard-360.png
│   └── wizard-viewport.png
├── ecosystem.config.cjs
├── package-lock.json
├── package.json
├── pnpm-workspace.yaml
├── public/
│   ├── app.js
│   ├── data/
│   │   └── lawd.json
│   ├── index.html
│   ├── lib/
│   │   └── ratio.js [빌드 생성·Git 제외]
│   ├── shield.svg
│   └── style.css
├── research/
│   ├── lawd-download-headers.txt
│   ├── lawd-metadata.json
│   └── lawd-original.zip
├── scripts/
│   ├── extract-lawd.py
│   └── prepare-assets.mjs
├── src/
│   ├── index.js
│   └── lib/
│       └── ratio.js
├── tests/
│   ├── browser.mjs
│   ├── ratio.test.js
│   └── routes.test.js
├── tsconfig.json
├── vite.config.ts
└── wrangler.jsonc
```

`public/lib/ratio.js`는 `src/lib/ratio.js`를 빌드 시 복사하는 생성 파일입니다. `node_modules/`, `dist/`, `.wrangler/` 및 비밀 환경변수 파일은 Git에 포함하지 않습니다. 코드 위치는 `/home/user/webapp/`이고 브랜치는 `main`입니다.

## 5. 완료 기준 점검

| 항목 | 결과 | 비고 |
|---|---|---|
| 로컬에서 세 화면이 모두 열림 | 통과 | Chromium 실브라우저에서 랜딩·입력·결과 확인. |
| 360px 폭에서 가로 스크롤 없음 | 통과 | 360/390/768/1440px에서 document/body 너비가 viewport와 같음. |
| 위저드 3스텝 → 결과 화면 도달 | 통과 | 이전/다음, 필수 입력 검사, 정보 수정 및 재진단 확인. |
| 목업 표본 2건 → "표본 부족 — 판정 불가" 표시됨 | 통과 | 59㎡로 2건, 120㎡로 0건. 비율·게이지·가격 통계·보증금 마커 미표시. 입력값과 표본 수는 표시. |
| `ratio.js` 경계값 테스트 통과 (0/2/5건, 59.9/60/79.9/80) | 통과 | 단위·라우트 테스트 총 20개 통과. 추가 69.9/70/120, ±10% 경계, 입력 불변성·유효성도 확인. |
| `wrangler.jsonc` 에 `kv_namespaces` 없음 | 통과 | 주석 포함 제거. D1 1개만 선언. |
| 소스에 API 키 문자열 없음 | 통과 | 실제 API 키 없음. 예시 변수, 무결성 해시, API URL은 아래 검사에 탐지됨. |
| 푸터에 출처·면책 문구 표시됨 | 통과 | 세 화면 공통 고정 푸터와 결과 본문에 표시. 실제 푸터 높이만큼 하단 여백을 확보. |
| 디버그 라우트 삭제 여부 | 미삭제 — 승인된 비활성 유지 | 키가 있어도 ENABLE_API_DEBUG가 true가 아니면 404. 실제 필드명 검증 완료 후 삭제 예정. |

브라우저 결과는 로컬 `artifacts/local-browser-results.json`의 36개 검사와 프로덕션 `artifacts/production-browser-results.json`의 동일 36개 검사 모두 통과입니다. 외부 네트워크 요청 0, 페이지 오류 0, 입력 HTML 실행 방지, 체크 상태 비저장, 시군구 선택 초기화, 세종 코드, 지역 파일 로딩 실패 안내까지 확인했습니다. Safari/실물 휴대폰 검증은 미확인입니다.

키 노출 검사 실행 결과:
```
$ git grep -nE "serviceKey=|DATA_GO_KR_KEY=|[A-Za-z0-9+/]{40,}" -- . ':!*.md'
.env.example:1:DATA_GO_KR_KEY=여기에_공공데이터포털_서비스키
artifacts/production-verification.json:6:    "sha256": "330a090e4f228320173f37de087ce7ce5342d5e1a7d3736d33500aaadb11a6f1"
artifacts/production-verification.json:12:    "sha256": "6811109477296f159d0fde71c4962adb9d2b817c66312e66f253f12d68ce5962"
artifacts/production-verification.json:18:    "sha256": "ad1c14db292e6dee65bf126d0fbde03137bfa613f68f90a84bfdee6fc8dde4dc"
artifacts/production-verification.json:24:    "sha256": "484cf6c0f8a177236f60b480d85b356c19a18a878a54c8fab4e567e6130ac627"
artifacts/production-verification.json:30:    "sha256": "b70cce064bb85e2f60677309e37ac8d9c422b224e90ac37840a0676d3375627a"
package-lock.json:22:      "integrity": "sha512-jxQYkj8dSIzc0cD6cMMNdOc1UVjqSqu8BZdor5s8cGjW2I8BjODt/kWPVdY+u9zj3ms75Q5qaZgnxUad83+eAg==",
package-lock.json:32:      "integrity": "sha512-ECxObrMfyTl5bhQf/lZCXwo5G6xX9IAUo+nDMKK4SZ8m4Jvvxp52vilxyySSWh2YTZz8+HQ07qGH/2rEom1vDw==",
package-lock.json:48:      "integrity": "sha512-ufFpLi2+WIuifZOiW38N8hzcX1tqfCqxYWgRC3tgT78TzjxUiBPcSkNdwv8dxeQ9xApwQh3BnQiFhfzq67umew==",
package-lock.json:65:      "integrity": "sha512-rbdal3kspPfG5O55I9IVHdBv2SH6UJMh66JkmdLIXuN2oS6WYctP226hKQJIme8mLW7XebRjL+ZnVbVES2SrkQ==",
package-lock.json:82:      "integrity": "sha512-t981nh4Ol5mjzkH6x7x7Oev/UVmF5n3zjm07btl58BxJ1IgUSUPW0XJz07DR7rWss/EmGey7UlRMUM0qRcWkvg==",
package-lock.json:99:      "integrity": "sha512-3nW87yjIxhchhI7ZqbeQsy0Rfzw+7aZVADN/iDF0v1JOH3IxGsExEGGWYB+nQQQG4rUvnBlRTFT4WG21mVB02Q==",
package-lock.json:116:      "integrity": "sha512-S3j07o3yMK0gzyEX+oM4/QmdtGdLxTK0mNYkQMZRjO98PjWr55TPiEkwfwcnfUNxnl6bI53MlHp1x5ZWOBg/JA==",
package-lock.json:133:      "integrity": "sha512-IchNf6dN4tHoMFIn/7OE8LWZ19Y6q/67Bmf6vnGREv8RSbBVb9LPJxEcnwrcwX6ixSvaiGoomAUvu4YSxXrVgw==",
package-lock.json:146:      "integrity": "sha512-Xz4Tpyki7XyrpbUK1jR1AhdAdaXyhhY4lZ3neLodmhpuWfy2PAQN5B46sAiU4liOXGLkHypn/qU+jvfWSCYYLA==",
package-lock.json:157:      "integrity": "sha512-Svl7tq8k/08+p6CXPpRjQ1fKX+1odH/BQbb48fV6fj3CWHhsoIOoY87w1oHXm0qEpkIK3ZfVgp0hed3XBXzXMQ==",
package-lock.json:174:      "integrity": "sha512-0k2F129Xdio1TdJfzJ8sy1Q47vUD2NnwdhiAf7drUN1EBTfPf4hsFCtmMgu/6m8JSzsBrlmVjudMBQqOfG8usQ==",
package-lock.json:191:      "integrity": "sha512-34EGEbCIAgosYz6goLcopX6Mo7NyGv9tfwEM2/7Ce2VcVRk568iSvniGWcUXIy7wEDR1wzolcxcriFVrWYcwBg==",
package-lock.json:208:      "integrity": "sha512-dbwY7ltSMDWsRatcRpCnES4F+im88OCUgGZjy52shC7GqHRE/cYlxNbB4Z4UpJswpcc4Qxd2oE/ufM0p61IKng==",
package-lock.json:225:      "integrity": "sha512-TZbWkQY7kvTAXbXUT7uVACR5cMHsDiSz9z7ZKAX/RTq/WJEk3QyRr0wZpNhBDX+/0CtdqUIJlOiodQcta6tY3Q==",
package-lock.json:242:      "integrity": "sha512-zfdzgK9ACBNZLI/CyHTOx81SyNbM6YXn7rxSgX97VjyiPl9W1i4Ka4fgKECEoFCKGpvBj5qArWIGgQjOwkgskQ==",
package-lock.json:259:      "integrity": "sha512-wG2EA8ENdEI0qhkSZMjfqrdY+ziCYCPMmtZjjIwOmXFjmyzEHn+UUxk5of+SYsjtfs3VpnlC7QLzSI5hY/rOAw==",
package-lock.json:276:      "integrity": "sha512-i7dZ9vQgnvSCzi/rYCXNgtF/U+eKZNJBzu3eTQbRgHnM7tNSizLOkRFAl3qzVc/Op/u5YkHHa4pf/3DOYHthLQ==",
package-lock.json:293:      "integrity": "sha512-qVXBOHQS+d5Y722GwJzJUtOLlX7km3CraOaGormF1pDtPd2C/l1SHRPgjLunLGe51Sh5YYWKMFDyV4SxgMQYTQ==",
package-lock.json:310:      "integrity": "sha512-yHs+0uc8+nvEAfAfxrWQKK5peSNzBc4PegcMO0EJ2hT71uA7vB8Ihg2e77R2P7SG5uYjPbHlLLmve4LLLRCf0g==",
package-lock.json:327:      "integrity": "sha512-d1z4ZuP0ajrfz/FhGT4vv278rX8KnPPJx8i5+AtK7TYbx9Le9F1hyzurZpkEyjkGa9dUGhQow4C1NmeGvqxN2w==",
package-lock.json:344:      "integrity": "sha512-M5sRjUVZrkm1OAPR3dlOYzNmN+loZKGVi1VUQGrwuqLcbR6qeAz+famMhjASeH3YVKvZz+zT1jlh/keC3Rj/lg==",
package-lock.json:361:      "integrity": "sha512-mRObBZeHh2OxcBFPWE/FjylkRgZdYuiTR3vaTozquCGOH14iP9oN4x4Ge81CoIDYQrXmIxpFumJBu5MtZpnQJQ==",
package-lock.json:378:      "integrity": "sha512-slScBsMAb3GFDcdrCgLwZtPYRoH2H/youv10QiZyRjmsP48fznoveWytSgCI/R0ZcUgpc0ZhIUEx6LHts8yrfQ==",
package-lock.json:395:      "integrity": "sha512-kw0owk1o0GFETUJyW0jc0G4Yzs0BHZn0JDZ8JRT088vjJYX777BAs1fDGxAC+q831qOs2DTC96mNsG2opdfyyQ==",
package-lock.json:412:      "integrity": "sha512-/lAIjX8aYFRByhh6L5rYtPEDRqa9de/4V/juOXcta5frjvzXO4/sqEtyytse0g3zZFuWu5cDN0MkLz2qRDD2Ag==",
package-lock.json:429:      "integrity": "sha512-u/anNYF2mmVOEDwLtnQ1wOr3EZ9sTNGLWrsYGYwHWzGA3Si84IOkHXlbWTD1NB+9/1lcnweYKO54uhxZydNzfA==",
package-lock.json:446:      "integrity": "sha512-oks0DYbLwWMmaakTsCb+zL4E+aHRVLom9IJZOAthMQEPiQmydXHkziYEsGYRx0uNV/IjEKGAV941JzH02pflqw==",
package-lock.json:463:      "integrity": "sha512-aeL6lAnN89Hz43Mlh1G8ARasbuoYvSITDEx0tHh5b7jJnHcssqgjy9Yx430GDpmCa6OyrKoS0aNRjKundRizGg==",
package-lock.json:480:      "integrity": "sha512-MEFJe5C3R8pwXdZ5Y21oo6m7ePiS0d9pWucn99O/wvyJZChoIQKrQDxKrGeW8F5+T0okTHesAmDeiHDTIq0V/Q==",
package-lock.json:497:      "integrity": "sha512-i/ZLIOafE0Z8cI/XANJAixoJL/uRAoS2xOA3rb0xN+KK0K177cMAsQYkzHtBrtMXAKuAc7HGgcWiZ/sRC1Nxgw==",
package-lock.json:514:      "integrity": "sha512-ge+Z7EXFNt2BO1oAMsVpiQ8EwndV9i1xXerAeTIK7AtPs3bKFXQM7nlRxDSIUIMeueR1CNXxqztLzdNeReKBJg==",
package-lock.json:531:      "integrity": "sha512-BEjgtECkL3vY+SaSQ6nzVfiALUeFxpawyp8Jmf5PtYhf1Ug40N1h/hxlhts+f1FvSvarEigdxS3BlSMI2PJLcQ==",
package-lock.json:548:      "integrity": "sha512-lCv9eK/H6ZJWbE7bh2nw54CZ9M2nupBxJcTsdk/QQnWkdSjKGuxmmH8/GWrlT1eMmZfn4dGcCjRte397WqfQXA==",
package-lock.json:565:      "integrity": "sha512-zvb/mB2bSCoJOpoCBgYKKpX6YM6mJBlBUVUtVj41DlZJVEB6/0CKlRYxP5wWl1C1ILiCoAU5wZZ4q1P3qeS6Eg==",
package-lock.json:582:      "integrity": "sha512-bm4Mowrv+GXMlpWX++EcXw/iLyd1o3+bJkC2DkWXYVvgZCqD/bSj9ctZeAMC3cIxgjRVR2Dufaiu4YPxr5gW1A==",
package-lock.json:599:      "integrity": "sha512-dSneS5qhiauZWGDCeK4o695Xd9nUNjviSZCMQrj10eetr8Uln1ucn6bbphOM6UynAMMtNIzZNSpL9vnASJwrPQ==",
package-lock.json:612:      "integrity": "sha512-EQJmFL7G+71MXZQ/mmywNl4qW6DSyjTdC30cq7mlDS451a1/jE86old0M2DCWzNGCO50sv7CzQDYkz4L5dq5VQ==",
package-lock.json:625:      "integrity": "sha512-OlcWoXjNogKiJhVwV/ftMK87UcsJmIBfmImSdI4e8to/ZdwNHrW9ddKw2OGHjXI5/uS2RaZr+2y+l8T9VFbCmw==",
package-lock.json:655:      "integrity": "sha512-Td76q7j57o/tLVdgS746cYARfSyxk8iEfRxewL9h4OMzYhbW4TAcppl0mT4eyqXddh6L/jwoM75mo7ixa/pCeQ==",
package-lock.json:665:      "integrity": "sha512-Uhfl4V4lhP2nbUVF9+hyH1+luj86f1gUFeo8ALYxFoULoU+G87D43BfeMP8XHsk9boxAnCY/bf2EHwhA7MuGsA==",
package-lock.json:688:      "integrity": "sha512-hWniXY3bG5qKpkKrAwPe4y+VTPmf086YQAnkxWh7uA1YrlRouWGa0M0Mxj3ZjnXFkv7/TD1bTy9lGUK26vRvWw==",
package-lock.json:711:      "integrity": "sha512-lIsKw/BU+kjB4eZjxrYrZmwOJYi3Ajrv66iAlBmUPyKc3HpnloevB1g3wxGD9P/5BbQ1brBGl65VRRrCvQDEqA==",
package-lock.json:731:      "integrity": "sha512-suTBPTDGrI9WodccaDdwZItTSaBYASlBk1NSfElSHrUfzu3szG6lvIF58+WiFvnfzuK8ZBFS5zE00PxqxnRiPg==",
package-lock.json:748:      "integrity": "sha512-FVJZ5mITMobmXIz/hPDTw0EintTW5H3WfrxwLqEqjiIihlu+hVRyGrFQ60xl0Lxn7Bt3zdpevPaQi0HEzqz9fw==",
package-lock.json:765:      "integrity": "sha512-3rbU4vqXXc3hY/OiXdl52xZvT0F1yEngWfvqudtPJg/KkyiaQw2DRsFrNzpmLvfavbwOq3qXn36GP8obHRULQA==",
package-lock.json:782:      "integrity": "sha512-0DaL0A6Xu6sQSQFwe4iVCrKWU2cCTItnRsYsCdxAMm9NF6twAA9BKnoqy4hqz4+azQ0JHuA26qiUKsf1XJ/v5A==",
package-lock.json:799:      "integrity": "sha512-cdn1OvUBwsXhbC0zSzJnNzf5MZ/mTrobawDvNXBTxe8VtqKAm0sRuEY2Evzovb/w9JMk4TvRxqt1mekSuJz64w==",
package-lock.json:816:      "integrity": "sha512-HjPVx7yKz+0lqdhDlTw1tt90wamBoxhiXpvl1XZpJLiHH4RCJ5yDTqH+VlYPv2fwFs89JFw4c1IexYOcQUi4IQ==",
package-lock.json:833:      "integrity": "sha512-neWLh+3yCNThxnfy3c4BbVBeGgt9aftno+XbT56iK28RgeDs3UOFWviLWlUu0bArYVYJaFDK+RRohbicUNCm8Q==",
package-lock.json:850:      "integrity": "sha512-4vKmvAst9nrowcqquKFAyZJUDolUaIp8uRiN0mWFguJ1IplC9/pitXtlnnlU4aa/eJw3J7i67V+pwUL+wZGdsA==",
package-lock.json:867:      "integrity": "sha512-Y9kQaLMuNoB0bPYOOdcZMaseNrFpPodIWWMrx+CZyydf2xn68j9WYc6sWWRrDwNkzCQjKYfc68L7jKjGlHMibw==",
package-lock.json:884:      "integrity": "sha512-fj8Mv0HHfD1Rr+4I68+3agJynxDWtBFgicTbSOb9Bke6pIwzGcJ+RX/yHjmiEGFMCavY/dxvem7MyNaJF+wDiw==",
package-lock.json:901:      "integrity": "sha512-7OAS8gI0EReKGVN2HssHlM6umJgxF5VI3xN0p9FA91p/YO+ou5hiNghLdZ5BEHztwaaK5+bLKRf8x/o2L2nk9A==",
package-lock.json:924:      "integrity": "sha512-De4jpEnAU8Hd5oT0j1G3uL4ZvTuipVMn7YC6vPaJhy6/7EwEae0SVAoBrUMYQbkLGDm85taVWwuPc1a44LTzCQ==",
package-lock.json:947:      "integrity": "sha512-2oYZJeIl4kCcMGk4ouZVjnkCtFrpQFlNEtJ6GbxzhHQchwH0NH/qEb9ykmOl29dqwMq+JhFdZn+1ak2FKhI9fQ==",
package-lock.json:970:      "integrity": "sha512-cPbNChoRURAWdebDIHSenxRpgEdy7JkPydSnUxRm9VvKD7m0/xVaR/8Fzlu81pk5nHEvHH87UZUA7cTtwnbJSA==",
package-lock.json:993:      "integrity": "sha512-RY0JFY8Fd6RonCBtHz+DvadaPkXDSI1AUn6yWL9TipqkZ1vY8w8evqdgyDFnkm4/K1ve1TvZiaePP5oSd4+WVQ==",
package-lock.json:1016:      "integrity": "sha512-9qvvEAuk8k89TfWUoX2htWjbAMX8p+NxCppjpcg5k6xMsjhBQPTsoIh36h9Qde4WRuGpJeYnOjdosDn/cnv+OA==",
package-lock.json:1039:      "integrity": "sha512-KB5jxpfWQTr0nc3xdHtWChdbifHrBGsd2SM62Eyxrl8afikm+f5qGBU75SJIZBT/S1MC8XyacdlXBMSWq6OURA==",
package-lock.json:1062:      "integrity": "sha512-f+eZJZIQNEEd26RPSW+76chwOf1XtA2Y/O+5ocVyLliHkeih3e+jhLVBdNTd2rS3IbNXK8+ug93Vf5ZXtF5Lxg==",
package-lock.json:1085:      "integrity": "sha512-zQnl4Kwp7Q6NHsENtU2T/00Zi+w3AQNwz3+UaTyVBy2FpXrzXzGjndpK61onhZjRtRpQXxCTeqw19bVyXOh7jA==",
package-lock.json:1102:      "integrity": "sha512-ESfNkywmCfPNyaZjxooddJQiQ+l/nTpGEOGthxiLnIHXC/CmcBixnfwUleX9mCz9ovrUUvKMap/pm8RYbzfwaA==",
package-lock.json:1122:      "integrity": "sha512-iNdlBX9gLVvqe2I3uIJSIKTq6wckP/DYxZtcqxm09x5Gi24DnFBmPAWZmr60ZyYMG0xlzo6goG3670ar+RXvRw==",
package-lock.json:1142:      "integrity": "sha512-kqRsbaa5CS6KHlpxnN7WhE6vAAugXyZButpRdvDWetlv6Qv4N9WTcrWzF7tXfB9T7MsoadqdI8hmwLq6UlLvtw==",
package-lock.json:1162:      "integrity": "sha512-XtmnYhBcrORsJ4XJngyzr/EWP0hRZLAZRFaApdKuviyqF78+ylxh2y06ZmtULAMOnObJ3ucpN0AcwSWnMowTRg==",
package-lock.json:1182:      "integrity": "sha512-bRISgCIjP20/tbWSPWMEi54QVPRZExkuD9lJL+UIxUKtwVJA8wW1Trb1jMs1RFXo1CBTNZ/5hpC9QvmKWdopKw==",
package-lock.json:1192:      "integrity": "sha512-T7jf+5zgsZHwNJ4lvQ7/aezbyk0nNX+zJVWpmHA7VYsEx7a7qr5Rg5IbtJFqkgze5Y2sruq1RUY8Q837Od7iFw==",
package-lock.json:1199:      "integrity": "sha512-3Belt6tdc8bPgAtbcmdtNJlirVoTmEb5e2gC94PnkwEW9jI6CAHUeoG85tjWP5WquqfavoMtMwiG4P926ZKKuQ==",
package-lock.json:1210:      "integrity": "sha512-rDS5/31E9HfPl/CIzGrn0DOlvBbXFseQ5URJ9sYMfstbKLD/c6Gm9vmRzRGDdAXyOIL4zmO37lc9RIwYqVruZw==",
package-lock.json:1220:      "integrity": "sha512-oxMK4vllB9RK5NQ2l1pq1IfOf2AvnEuj/vYGDj0H2nMtmtZpKtCwt/l00GEO6xjGfpBNAvjovvYdCm50dRQkpQ==",
package-lock.json:1236:      "integrity": "sha512-H9xkIdFswbS8n1d6vmRd8+c10t2Qe+rZITbbDHHkQixH5+2x1FDGmi/0K+WgWiqQFKPSlIYB7jlH6Kpfn6Fleg==",
package-lock.json:1246:      "integrity": "sha512-NBdYIb90J7LfOI32dOewKI1r7wnkiH6m920puQ3qHUeZkxNkQiFnXVWoE6YtFSv6QOiPPf7ys6i+HWWecDz7sw==",
package-lock.json:1258:      "integrity": "sha512-dCED+QRChTVatE9ibtoaxc+WkdzOSjYTKi/+uacHWIsfodVfpsueo3+DKpgU5Px8qXjgmXkSvhXvSCz3fnP9lw==",
package-lock.json:1265:      "integrity": "sha512-tNISae1QEf/vkb3xkRcjV5SEdzPE97We5IVaa2Z8jSszQPZ8U60B/YCYpw4QI7VidYsBtKavczXf+DyDs9WGxw==",
package-lock.json:1282:      "integrity": "sha512-YC8YsI30o606GTZi0VyzYlsDKFP8W61i/QzayHDkLbNEz/IShqAmTa+hsJRj13xTHA0H+6fk4b2UmGn+Q/cMlg==",
package-lock.json:1299:      "integrity": "sha512-IwhlH3qK5urrY8hZiEgGkHKEFN901p/p2bjxCxJlr4GyNnF7wYpUvK+Y43uaRYuC4hpfjzbR3SJC3arX1jGvmw==",
package-lock.json:1316:      "integrity": "sha512-XxpJfVzFh+jilRxIXUqcfYAYcunIc/XEzIizsOL1fcJee5Sf7H3mH8WlLmfHfluz5amqR88QQo9izKtmMlavAw==",
package-lock.json:1333:      "integrity": "sha512-kSfvhmgeWyfkbT3p/1s5vSgboogoah2zkm9fX2zjg2hHxSV7T4KhMWRUUaRk4OXNqoD3QAUeRqLcs1aZOK4U1g==",
package-lock.json:1350:      "integrity": "sha512-1RVzG17pxqbTfYLC352JlLt6kKLG+6Hr30n8DlIJqsnV5luUDd2Qdx9Ayw1Cabfyb1K9k0jXEZ7evxkRoT+uiw==",
package-lock.json:1367:      "integrity": "sha512-BXqPvZ2drqVD+/Z8UpKwcs4Mp7grM+eGFku4CAEKrEtcbAsUpzREphK1sogCRZGreVPiMkiiBtw0n3TPteuqvw==",
package-lock.json:1384:      "integrity": "sha512-11vWvo8YDwLzukt27J3aYDWU+gg2P7J+ZOmiJ0hkF5BXZDW7pVya7r40MXDy6ya0i9KamoENSVKIugvJNgFXIA==",
package-lock.json:1401:      "integrity": "sha512-a1tijMkdwsIARtc0F39ApURROkf3NwqinI6TOiSSWCTR7dT96dffNvMUtDHnq64wKNTIZOIlzKrFvvFUznJiyw==",
package-lock.json:1418:      "integrity": "sha512-x6SQNdAvv4c3hWqTMaWuawzMX9myaCs/yEmlGsxJzkdClnHW7FbrjQuSiRDhuSYzEYoEMhsaJy9qHG/XNemJPQ==",
package-lock.json:1435:      "integrity": "sha512-9s0AZ8BFK5/n7B/TBoa2yJE3gI3KURrbXcPBlsAsvjU4VeJKgE90y1YtNxyEUIcHPQkg6/yfF3qihUrcM/Kf0Q==",
package-lock.json:1452:      "integrity": "sha512-P7VWAmV+WdJluH7ovnRGoiv2i8To7GAZ+kGzfGup635cyL7SyYl3lSUaA3Gp5THf0n/Co5EyEqb2zbqq+nMOHQ==",
package-lock.json:1469:      "integrity": "sha512-1qixtsE4BK8h+yS3BfmZ09UhA7O/N4IACva6YBr7EBvCJraByTuRcgOTaiA62Tm0vey3UcKXLOaoGHtYmNGEVg==",
package-lock.json:1486:      "integrity": "sha512-ok8IQjcEPs1AKZfuEUznVBrJw+gK4soq+bx8b1X2XoMqVClarc1q5JDmVtWXY1xfr6ZuHTAsPXHTgTrqKTZeww==",
package-lock.json:1503:      "integrity": "sha512-Ip2mXoU0hM0boq3Rf+ekuT653OROSo6aSYcPT1VHE4q52KvyxgFkQgrgb/IEsxOuvQ2fZZbs8khJAyCEPM24/g==",
package-lock.json:1520:      "integrity": "sha512-2j9bGt5Jh8hj+vPtgzPtl72j0yRxHAyumoo6TNfAjsLB04UtpSvPbPcDcBMxz7n+9CYB0c1GxQFxYRg2jimqGw==",
package-lock.json:1527:      "integrity": "sha512-P1Cz1dWaFfR4IR+U13mqqiGsLFf1KbayybWwdd2vfctdV6hDpUkgCY0nKOLLTMSoRd/jJNjtbqzf13K8DCCXQw==",
package-lock.json:1540:      "integrity": "sha512-qeW2e1l78afw8VhRPfPQ1Gjj+KU5XFQ/OFV5ti6eTa9bruO7mJyZtA4vw0ofqmA3tKCkROE9xLk3VZoeRc98nw==",
package-lock.json:1547:      "integrity": "sha512-3oSeUO0TMV67hN1AmbXsK4yaqU7tjiHlbxRDZOpH0KW9+CeX4bRAaX0Anxt0tx2MrpRpWwQaPwIlISEJhYU5Pw==",
package-lock.json:1554:      "integrity": "sha512-F1+K8EbfOZE49dtoPtmxUQrpXaBIl3ICvasLh+nJta0xkz+9kF/7uet9fLnwKqhDrmj6g+6K3Tw9yQPUg2ka5g==",
package-lock.json:1561:      "integrity": "sha512-uZbew1NqdmPDTMJ8ah1y+b+9QEJrfkXFk3RcTQw3X0jW/xRUvFKsg1CfQdSYGdTbXZWExtU3J3ccxtnfw1Fi0g==",
package-lock.json:1571:      "integrity": "sha512-ei8Aos7ja0weRpFzJnEA9UHJ/7XQmqglbRwnf2ATjcB9Wq874VKH9kfjjirM6UhU2/E5fFYadylyhFldcqSidQ==",
package-lock.json:1585:      "integrity": "sha512-Btj2BOOO83o3WyH59e8MgXsxEQVcarkUOpEYrubB0urwnN10yQ364rsiByU11nZlqWYZm05i/of7io4mzihBtQ==",
package-lock.json:1595:      "integrity": "sha512-5qucVt2XcuGMcEGgWI7i+yZpmpByQ8J1lHhcL7PwqCwu9FPP3VUXzT4ltHe5i2z9dePwEHcDVOAfSnHsOlCXRA==",
package-lock.json:1605:      "integrity": "sha512-HrJrvZv5ayxBzPfwphOoNzkzOIIlifzk0KJrGK2c8R4+LKpMtpYLQeUdjnwjWv/LZlkH2laZk+4w78pi99D4Vw==",
package-lock.json:1647:      "integrity": "sha512-tIbYtZbucOs0BRGqPJkshJUYdL+SDH7dVM8gjy+ERp3WAUjLEFJE+02kanyHtwjWOnwrKYBiwAmM0p4kLJAnXg==",
package-lock.json:1665:      "integrity": "sha512-5xoDfX+fL7faATnagmWPpbFtwh/R77WmMMqqHGS65C3vvB0YHrgF+B1YmZ3441tMj5n63k0212XNoJwzlhffQw==",
package-lock.json:1680:      "integrity": "sha512-/Gng7NfoykZl2pjukW5Z6+8Yxm3BPRf86GTbQnt0SbySkvax4fyL4H3HhY1cCpBGmiW9XDRFzRV+CXK2W8QudQ==",
package-lock.json:1689:      "integrity": "sha512-o+NO+8WrRiQEE4/7nwRJhN1HWpVmJm511pBHUxPLtp0BUISzlBplORYSmTclCnJvQq2tKu/sgl3xVpkc7ZWuQQ==",
package-lock.json:1699:      "integrity": "sha512-WkUDrojuJs0xkgGf2udWxa3yGBRxPtxUkB79i6aCZLRgc7PM8fZe9TosfPDcvEpQZbuFASnHYmRLBLUbmLOIIA==",
package-lock.json:1729:      "integrity": "sha512-gEpRTalKdosp4Bb8qWtc2iOgE5SeIHlpS1up9bFq2wAyYhl1UdTObYiHe98zEM9SQvSoqQZ1IQD0JNpg3Ml5pg==",
package-lock.json:1750:      "integrity": "sha512-Sciaz8eenNTKn9b3t7+xr0ipTp9YxKQY4npwQ3mrRuL0BAVHBLyZxofhaKBAVtzmtRZ/zTyo0/to4B1uWG/Djg==",
package-lock.json:1771:      "integrity": "sha512-Z5UPAxzrjlWNNyGy6i65cJzzvgJ5D3T6wMvs+gWpY9d7qRhANrxqAp6LhxIgZhWEw18RfJTGcRxjuLIBr+m8XQ==",
package-lock.json:1792:      "integrity": "sha512-QQM/Ti/hQajJwCY+RiWuCZ9sdtI/XQk7nDK5vC8kkdwixezOlDgvDx7+RT+QjK6FcFT4MpsuoBnHIo/O3StRRg==",
package-lock.json:1813:      "integrity": "sha512-N7FVBe6iS24MlM6R/4RBTxGhQheZGs7tiQ9U32UtF75NzP5Q7xWPRqLBCKxlRQRk3rY1jCIPLzx7WzOhuUIRLQ==",
package-lock.json:1834:      "integrity": "sha512-j2v/itmy4HlNxlc6voKXYgBqNi0Ng2LShg4z7GufpEgs05P+2suBVyi9I6YHq5uoVFx9ETin3eCEhLVyXGQnKg==",
package-lock.json:1855:      "integrity": "sha512-yiO5ROMuYQgXbC60yjZU5CYSFZGKXL0HFATXt9mHJn1+zW55oCtMI9NfcVhYLMFDL7gV7oBPon/EmMMGg2OvtQ==",
package-lock.json:1876:      "integrity": "sha512-ar+Ju7LmcN0Jo4FpL4hpFybwNG9/3A/Br5KW2n2jyODg3MEZXaDYADdemoNS+BDNfMgKvylJLj4S5tyRActuAg==",
package-lock.json:1897:      "integrity": "sha512-RYiYbkokw0trfKqqzfF55lginwEPrD3OJDfTuJzFs1MK6iFnDenaz1fqLLtX4ITG3OktJQXOeTaw1awrBAlZPw==",
package-lock.json:1918:      "integrity": "sha512-1K+MPfLSFVpphzpdbfkhlWk6wBrTObBzS2T6db10PNOZgR9GoVsAWzwNyuhUYYbTp23j+4RrncfujZ4uAzXvwA==",
package-lock.json:1939:      "integrity": "sha512-OlEICDx/Xl0FqSp4bry8zFnCvGpig3Gl4gCquvYwHuqJKEC1+n9NgDniFvqHGmMv1ZkqDJrDqKKSykTDX+ehuA==",
package-lock.json:1960:      "integrity": "sha512-NpZyBR+h/nonVA/YO/+1/UJpIl8lTwCgpFPVp/KVzAhb8JuCRImPDfyrft040659Zna1RS3Lt2pzTs5Vwy5QSA==",
package-lock.json:1978:      "integrity": "sha512-OBwBN9AL4dqmETlpS2zasx+vTeWclWzkblfZk7KTA5j3jeOONz/tRCnZomUyvNg83wL5Zv9Ss6HMJXAgL8R2Yg==",
package-lock.json:1994:      "integrity": "sha512-Y2tUNy4ouw6tq5oDSKeQYGOyhkUBhNOcGV/02KC+6kd9eDGqdZd++mjMiIDilrBYvjEnCYvVtsuHCuP+okSfug==",
package-lock.json:2013:      "integrity": "sha512-Yhpw4T9C6hPpgPeA28us07OJeqZ5EzQTkbfwuhsUg0c237RomFoETJgmp2sa3F/41gfLE6G5cqcYwznmeEeOlQ==",
package-lock.json:2020:      "integrity": "sha512-WUjGcAqP1gQacoQe+OBJsFA7Ld4DyXuUIjZ5cc75cLHvJ7dtNsTugphxIADwspS+AraAUePCKrSVtPLFj/F88w==",
package-lock.json:2027:      "integrity": "sha512-xceH2snhtb5M9liqDsmEw56le376mTZkEX/jEb/RxNFyegNul7eNslCXP9FDj/Lcu0X8KEyMceP2ntpaHrDEVA==",
package-lock.json:2034:      "integrity": "sha512-qcJu88Q2IWqJsDD529JKMdwGm/dvInW4HvQnRwiH9JtihJvzGOscDtHE3x1pBKeUOTysQ8kVmLnJ2kJu7yhcGA==",
package-lock.json:2047:      "integrity": "sha512-+7ziBLidS4NaNCdt57SUDT+wYmmd5fmiQejUic/kb+YsYSCPyOOE9sebzMjNmQrsnNpDJqd4WHvV/8lfKfUDUg==",
package-lock.json:2063:      "integrity": "sha512-rYCsBF/M5HjUch52bbtVONEFjv6Xu8sm8h72dNlR5bzIE1fvC/bxgspzkjSfU+MweEMmPM8KJebG6nnyxo5mCg==",
package-lock.json:2076:      "integrity": "sha512-RRuzqDtt5Y9h3quz5hWhK+TPnsmVs6WwSU6LkJMeY4HstUEDuYTG8UJSdawMRzmzAtV+KEoG8N3Qg2qLy5vM/A==",
package-lock.json:2105:      "integrity": "sha512-hx/Pv0N1haXRb11qkfnK5MXB/iqr7i0yjWQqmO9uHqZpBgQSqzc8UsSnEpalsh+j1I8qQ2CkXAkJC8Br3dKSlg==",
package-lock.json:2139:      "integrity": "sha512-Y7/KDsb8LjooZpwaqGyulO6DQlksgCncchHGk+sZIY4SBvUocMBEFH5Ur1fI4dV+Jvl0w6cjvucaIi40puRioA==",
package-lock.json:2152:      "integrity": "sha512-n++8XWcj+jCOr2IOl7h8LbKnGBDY4aPbmprMONBNFdn0ImXqpGVv5zliDs0V9HbmbCQLpbuo2ej9rAoOQTvMDA==",
package-lock.json:2202:      "integrity": "sha512-UXWMKhLOwVKb728IUtQPXxfYU+usdybtUrK/8uGE8CQMvrhOpwvzDBwj0QhSL7MQc7vIsISBG8VQ8+IDQxpfQA==",
package-lock.json:2212:      "integrity": "sha512-SS+jx45GF1QjgEXQx4NJZV9ImqmO2NPz5FNsIHrsDjh2YsHnawpan7SNQ1o8NuhrbHZy9AZhIoCUiCeaW/C80g==",
package-lock.json:2225:      "integrity": "sha512-wXR/dYpcqKmfWpEdZjiKJOwCNFndD0DMnrW/cYjVGttEkBfVgcLFHoNrlj47mjOVic9yyNu65alsgF4NQyTa2g==",
package-lock.json:2242:      "integrity": "sha512-oJFu94HQb+KVduSUQL7wnpmqnfmLsOA/nAh6b6EH0wCEoK0/mPeXU6c3wKDV83MkOuHPRHtSXKKU99IBazS/2w==",
package-lock.json:2250:      "integrity": "sha512-IDxfleLmmbSskfWSUATiN1nfn2rDuvnMOqb5CWR92iIfojA0Ud+ulOAAEQ57LPr9rWmsreUyf5lwyao+7GNNVw==",
package-lock.json:2260:      "integrity": "sha512-i7qRCmY42zmCwnYlh9H2SvLEypEFGye5iRmEMKjcGi7zk9UquigRjFtTLz0TYqr0ZGLZhaMHl/foy1bZR+Cwlw==",
package-lock.json:2270:      "integrity": "sha512-lhZBVvEHefgE+HQZC9O7EBJgCU/nVzFNl7vkS4RE0APtWLP02/8QVIkQtzBxPquh7lq5/78NHipTj7ODQ6XuyQ==",
package-lock.json:2348:      "integrity": "sha512-k072RxsZfRz2cnyAq1Titt+0VpNfnFizSXUkT3r15CDJECBfBXj6JeKK0Bk5CrBLAHGP+dvOHjI//TP7GHXDEw==",
package-lock.json:2369:      "integrity": "sha512-65JbYVGSt0XpPH8O/y6pNuS0t+AvvwVv+VRPbqYsNI5NMF9oFiJxVoS5GYU47ooamF9ucSXWvGyQ6QnAtXLgRA==",
package-lock.json:2405:      "integrity": "sha512-Vsp28b7DRcimFQvrqu2Wek3z1iYxDCWqHYB8Qsnk/S4RfaCQzPGPyBNuVjJV3cd6UiKtUtp6sNM77gWvzcCH+g==",
package-lock.json:2427:      "integrity": "sha512-rLfVLB4FgQneDr0dv1oddCVZmKjcJ6yX6mS4pU82Mq/Dt9a3cLZQ62pDBL4AUO+uVrCvtWz3ZFUL2HFAFJ/BXQ==",
package-lock.json:2441:      "integrity": "sha512-ho7XuGjLaJ2hWHoK8yFnsUGy2Y5uDpqSTq1FkHLK4/oqKtyUU1AFbOOxY4IpC9f0fTLjwYbslUz0Po5BpD1wrA==",
research/lawd-metadata.json:8:  "sha256": "44b96f4a86ad102057463a05aae8842f1d706d3e9e69d2dfc409023bf75ca56b",
src/index.js:29:    ? 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev'
src/index.js:30:    : 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent';
```

검사 해석: 148개 매칭은 `.env.example`의 자리표시자 1개, `package-lock.json` 무결성 해시 139개, 원본 ZIP SHA-256 1개, 프로덕션 자원 검증 SHA-256 5개, 공개 API 경로 2개입니다. 실제 키 탐지가 아니며, 원문 매칭을 숨기지 않았습니다. 런타임 소스의 금지 모듈·`process.env`·KV 필드 검사 결과는 매칭 없음. 환경 파일 `.dev.vars`, `.env`, `.env.production`은 Git ignore 적용 확인.

## 6. 화면 스크린샷

랜딩 / 위저드 / 결과 리포트 3장:
- 랜딩: `artifacts/landing-360.png`
- 위저드: `artifacts/wizard-360.png`
- 결과: `artifacts/result-360.png`

추가 자료:
- 표본 부족: `artifacts/result-insufficient-360.png`
- 데스크톱: `artifacts/landing-1440.png`, `artifacts/wizard-1440.png`, `artifacts/result-1440.png`
- 전체 문서: 위 각 파일명의 `-full.png` 버전. 고정 푸터는 전체 문서 스크린샷에서 뷰포트 높이 위치에 나타납니다. 실제 기기에서는 항상 화면 하단에 고정됩니다.
- 최종 스크린샷은 공개 프로덕션 URL에서 재촬영했습니다. 자동 캡처 도구는 개발용 Playwright/Chromium이며 런타임 의존성이 아닙니다.

## 7. 임의 판단한 것

사용자에게 사전 설명하고 승인받은 항목과 구현 세부 결정을 모두 기록합니다.

| 항목 | 지시서 | 실제 구현 | 이유 |
|---|---|---|---|
| 배포 설정 | Workers main/assets 예시와 미발급 D1 ID | 승인받은 Pages 빌드 구조로 조정, 실제 ID 발급 전 생략 | 현재 Genspark 호스팅·미리보기 지원 구조를 따름. |
| 거래 분포 | 개요는 전월세, 상세는 매매 | 승인받은 매매 거래 분포 사용 | 더 구체적인 작업 3을 기준으로 통일. |
| 디버그·키 검증 | 오늘 목업 + 실제 키 주입 조사 | 승인받아 기본 비활성, 실제 키 미등록·실제 API 미호출 | 임의 외부 조회·키 소비 방지. |
| 사분위수 | 25/75% 표시 + 보간 금지 | 승인받아 Q1/Q3 nearest-rank, 중위가는 예제 방식 유지 | 관측값 기반, 짝수 중위가 규칙 보존. |
| 목업 표기 | 목업 구현 | 승인받아 입력·결과·랜딩·푸터에 실제 조회가 아님을 명시 | 임의 입력 단지의 실거래 결과로 오인 방지. |
| 정적 서빙 | assets 디렉터리 예시 | Pages 네이티브 ASSETS.fetch 사용 | 구형 KV manifest 정적 helper는 런타임 오류가 있어 승인된 설정 조정 범위에서 수정. |
| 빌드 잔여물 | 명시 없음 | Hono 빌드 플러그인 옵션 `emptyOutDir: true` 적용 | 삭제한 템플릿 CSS가 dist에 남지 않도록 보장. |
| 파일 추가 | 기본 구조 | 빌드·추출·테스트 스크립트, 원본/메타데이터, SVG 아이콘, 스크린샷·검사·보고서 추가 | 공용 모듈 배포, 재현성 및 산출물 증빙. |
| 시도 자체 행 | 뒤5자리00000 필터 | 시도는 그룹 제목으로만, 세종 36110 예외 유지 | 출력 형식의 시도/시군구 구분을 적용. |
| 하위 구가 있는 시 | 뒤5자리00000 필터 | 상위 시와 하위 구 모두 유지, 구 명칭에 시 이름 포함 | 임의 코드 삭제·이름 충돌 방지. 실제 API 지원은 미확인. |
| 고정 목업 표본 | 구체적 값 없음 | 가상 단지 84㎡ 주변 12건 + 59㎡ 주변 2건, 120㎡ 0건 안내 | 충분/부족/없음 케이스를 실제 위저드에서 재현. 실제 단지와 매칭하지 않음. |
| 월세 해석 | 월세 입력, 0이면 전세 | 월세가 있으면 안내하고 보증금 비율만 비교, 월세 환산 없음 | 환산율을 임의로 가정하지 않음. |
| 숫자 표시 | 큰 전세가율 % | 소수 첫째 자리까지 버림, 판정은 원래 값 | 반올림으로 59.99가 60.0처럼 보이는 경계 불일치 방지. 화면에 표시 방식 명시. |
| 100% 초과 | 게이지 0~100 | 숫자는 실제 비율 유지, 게이지 마커만 100에서 제한 | 위험 수치가 축에 맞춰 줄어드는 오류 방지. |
| 유효성 검사 | 단계별 검사 | 양수 면적·보증금, 0 이상 정수 월세, 유한수 검증·면적 소수2자리 | NaN/Infinity·음수·빈값·단위 오류 방지. ±10% 경계에는 부동소수 오차만 보정. |
| 안전 표시 | 안전/보통/주의/위험 | 지정 라벨·정확한 판정 색상값과 기준 유지, 보증금 반환 보장 아님 안내 | 매매 비율만으로 권리관계 안전성을 단정하지 않음. |
| 판례 카드 | 목업 자리만 | 실제 판례 아님을 표시, 가짜 사건번호·가짜 조문 내용 없음 | 허위 법률 근거 방지. |
| 고정 푸터 | 출처·면책 고정 | ResizeObserver로 푸터 실제 높이만큼 하단 여백 확보 | 모바일과 확대에서도 마지막 콘텐츠까지 스크롤 가능. |
| 보안·오류 처리 | 시크릿 노출 금지 | 키 포함 URL/예외 로깅 금지, 파라미터 검사, 타임아웃, XSS 방지·CSP, 디버그 no-store | 비활성 라우트라도 추후 확인 시 안전한 기본값 적용. |
| README | 뼈대만 | 소개·실행·출처·스크린샷 항목에 현재 상태·검증·주의점을 간단히 기재 | 내일 이어 작업할 수 있도록 실제 구현 상태를 남김. |
| 문서 문자 손상 | 전세��율/거��금액 | 전세가율/거래금액으로 복원 | 문맥상 명백한 깨진 문자만 정정. |

## 8. 막힌 것 / 내일로 넘기는 것

| 항목 | 상태 | 막힌 지점 |
|---|---|---|
| Genspark 프로덕션 배포 | 최종 배포·검증 완료 | 공개 URL·D1 ID·관리 DB 조회 확인. 최종 정적 파일 5개가 로컬 빌드와 바이트 단위로 일치. |
| 실제 API 키 주입 | 미확인·승인된 보류 | 실제 키 미제공. 안전한 시크릿 입력 수단 사용 필요. |
| 전월세/매매 XML 및 필드명 | 미확인·내일 작업 | 오늘 호출하지 않기로 승인. 영문/한글을 추측하지 않음. |
| 디버그 라우트 삭제 | 내일 확인 후 삭제 | 지금은 비활성 상태로 준비만 완료. 공개 환경에서 활성화하지 말 것. |
| 법정동 원본 시행 기준일·개별 코드 API 지원 | 미확인 | 다운로드 파일 시각과 코드 존재 상태만 확인. API 조회는 하지 않음. |
| 실제 API·정규화·XML 파싱 | 미구현 | 내일 필드명 확인 후 착수. |
| 법령·판례·LLM 요약 | 미구현 | 오늘 범위 밖. 자리표시자만 제공. |
| D1 캐시 | 미구현 | 바인딩 검증만 완료, 캐시 설계·구현은 내일 이후. |
| 자동완성·로그인·저장·지도·아파트 외 유형 | 미구현 | 지시서의 오늘 하지 말 것에 따라 제외. |
| 실물 휴대폰·Safari·프로덕션 CPU 계측 | 미확인 | Chromium 모바일 뷰포트만 자동 검증. |

## 9. 한 줄 요약

공식 법정동코드와 목업 3개 화면·계산·표본 부족 방어·20개 단위/라우트 테스트·36개 브라우저 검사를 완료했으며, Genspark 최종 배포·D1 연결·공개 사이트 동일 테스트를 확인했으며, 내일 실제 API 키·필드명 확인부터 시작할 수 있습니다.
