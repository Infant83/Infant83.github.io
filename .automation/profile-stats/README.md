# 개인 프로필의 작은 통계

`https://stats.infant83.io/v1/profile`의 전용 Worker와 D1이다. ATRL의 `api.infant83.io` Worker·DB·알림·독자 식별자는 사용하거나 변경하지 않는다. 기존 Cloudflare Web Analytics의 과거 숫자를 가져오거나 추정해 채우지 않는다.

신규 custom domain의 DNS 캐시가 갱신되기 전에는 같은 Worker의 `https://infant83-profile-stats.infant83.workers.dev/v1/profile`을 보조 주소로 사용한다. 두 주소는 같은 DB와 키를 사용한다. 재시도할 때 원래 `eventId`를 유지하면 두 주소를 거쳐도 한 번만 센다. 판본별 preview URL은 비활성화한다.

## 수치의 뜻

- 기간은 오늘을 포함한 최근 **한국 날짜 30일**이다. `periodStart`·`periodEnd`는 이 조회 구간이고, `startedAt`과 같은 값인 `since`는 D1을 처음 초기화한 실제 UTC 시각이다.
- `visitors`는 그 기간 전체에서 난수 브라우저 ID의 keyed hash를 중복 제거한 수다. 일별 고유 수를 더하지 않는다. 사람 수가 아니며 여러 기기·저장소 초기화는 별개 브라우저로 집계될 수 있다.
- `pageviews`는 페이지 로드 이벤트 수다. 영어·한국어 페이지는 같은 브라우저 ID를 공유하고 각 페이지 로드를 집계한다.
- 계약의 `cvDownloads`는 **CV 링크 클릭 수**다. 파일이 끝까지 내려받아졌다는 뜻이 아니므로 화면에는 `CV 보기` 또는 `CV 클릭`으로 표시한다.
- 같은 `eventId`와 브라우저 ID로 재전송하면 한 번만 센다. 재전송용 이벤트 해시는 7일 보관한다. 브라우저당 한국 날짜 하루에 새 이벤트 최대 300개를 허용한다.

기존 방문을 복원하지 않는다. 첫 실제 집계 시작은 `2026-11-27T15:49:08.486Z`(한국 2026-11-28)다. 배포 검증은 운영 GET·거절 요청·개인정보 거부 요청만 사용해 초기 숫자를 만들지 않았다.

## 개인정보와 보관

클라이언트는 `profile.anonymous-visitor.v1`에 `crypto.randomUUID()`로 만든 난수를 저장한다. 저장·재읽기가 불가능하거나 GPC/DNT가 켜졌으면 이벤트 POST를 생략하고 공개 요약 GET만 읽는다. 서버도 `DNT: 1`·`Sec-GPC: 1`의 POST를 집계하지 않는다.

서버는 원 UUID 대신 별도 HMAC 키로 만든 해시만 보관한다. IP·User-Agent·원 referrer·페이지 query·이메일·쿠키는 애플리케이션 통계에 저장하거나 로그로 출력하지 않는다. 브라우저별 일별 해시는 35일, 재전송용 이벤트 해시는 7일 뒤 일일 정리에서 제거하고 일별 합계와 최초 시작 시각은 유지한다. HMAC 키는 Cloudflare의 `secret_text`에 보관한다. 값을 Git·명령 인수·실행 로그에 남기지 않는다. 키를 바꾸면 같은 브라우저의 기간 내 중복 제거가 이어지지 않으므로 일상 배포에서 교체하지 않는다.

## API

`GET /v1/profile` 또는 `GET /v1/profile?periodDays=30`은 다음 필드를 반환한다. 다른 기간·중복 query는 받지 않는다.

```json
{
  "ok": true,
  "periodDays": 30,
  "since": "2026-11-27T15:49:08.486Z",
  "startedAt": "2026-11-27T15:49:08.486Z",
  "periodStart": "2026-10-30",
  "periodEnd": "2026-11-28",
  "timezone": "Asia/Seoul",
  "visitors": 0,
  "pageviews": 0,
  "cvDownloads": 0
}
```

이는 최초 운영 확인 응답의 예다. 날짜와 숫자는 현재 응답을 사용한다. GET은 쿠키를 만들지 않고 30초 동안 캐시할 수 있다.

`POST /v1/profile`은 JSON을 받는다. Origin은 `https://infant83.io`로 제한하며 응답은 캐시하지 않는 같은 요약이다.

```javascript
{ type: "pageview", visitorId: crypto.randomUUID(), eventId: crypto.randomUUID(), page: "en" }
{ type: "cv_download", visitorId: "the-same-browser-uuid", eventId: crypto.randomUUID(), page: "ko", cvLanguage: "en" }
```

예제의 브라우저 ID는 실제 구현에서 동일한 저장 ID를 사용한다. UUID v4·영어/한국어 enum·알려진 필드·JSON body 1KB 한도를 검사한다. 공개 수치는 클라이언트 이벤트를 기반으로 한 브라우저 통계이며 인증된 사람 수나 다운로드 완료 증명이 아니다.

## 개발과 배포

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
npx wrangler whoami
npx wrangler deploy --dry-run --keep-vars --strict --autoconfig=false
npx wrangler deploy --keep-vars --strict --autoconfig=false
```

새 환경은 기존 Wrangler의 지원되는 인증을 재확인한다. 최초 구성에서 전용 D1에 `0001_profile_stats.sql`을 적용하고 `VISITOR_HASH_KEY`를 안전한 secret 입력으로 등록한다. 운영 배포는 기존 키·바인딩을 유지하며 DB를 재초기화하지 않는다. 일일 Cron은 한국 03:23에 해시 보관 기간만 정리한다.

2026-11-28 두 안정 주소를 반영한 검증 판본은 `fd7c421a-03fd-4cd7-b8a7-9f75acfdf18b`이다. 기존 계정·인증을 사용했고 요금제·키 권한을 확대하지 않았다. Miniflare/D1 통합 검사는 동시 재전송, 기간 전체 고유 수, 마지막 일별 허용 슬롯의 경합, KST 날짜 경계, 요청·Origin 제한, GPC/DNT, 저장 필드, 트랜잭션 취소와 보관 정리를 확인한다.

공식 동작 근거: [D1 batch의 원자적 트랜잭션](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch), [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
