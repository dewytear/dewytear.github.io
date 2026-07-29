# 좋아요·조회수 Worker 올리기

GitHub Pages는 정적이라 쓰기가 없다. 좋아요와 "4시간 캐시 없는" 조회수만을 위해
바깥에 아주 작은 쓰기 계층을 둔다. 무료 한도 안이고, 죽어도 위키 본문은 그대로 읽힌다.

**토큰·API 키는 어디에도 필요 없다.** 브라우저 로그인이나 `wrangler login`으로 끝난다.
누가 물어도 계정 비밀번호·API 토큰을 알려 주지 말 것 — 이 문서의 어떤 단계도 그것을
요구하지 않는다.

---

> **선행 조건**: `wrangler.toml`(저장소 맨 위)과 이 `worker/` 디렉터리가 **master에
> 머지돼 있어야** 한다. Cloudflare는 master를 클론하므로 브랜치에만 있으면 설정을
> 찾지 못한다(2026-07-29 첫 배포 실패 원인).

---

## 대표님이 하실 일 — 딱 하나 (D1 만들기)

Cloudflare 빌드 설정은 **아무것도 바꾸지 않는다.** `wrangler.toml`을 저장소 맨 위에
둬서 기본 설정(Root `/`, `npx wrangler deploy`) 그대로 동작하게 해 뒀다.

남은 것은 **데이터를 담을 D1 하나 만들기**뿐이다. 이건 계정 안에서만 되는 일이라
사람 손이 필요하다.

### 1. D1 만들기

[dash.cloudflare.com](https://dash.cloudflare.com) → 왼쪽 **Storage & Databases**
→ **D1 SQL Database** → **Create** → 이름 `dewytear-wiki` → 만들기

### 2. 표 만들기

만든 DB 화면의 **Console** 탭 → [`schema.sql`](./schema.sql) 내용을 전부
붙여넣고 실행. **Tables** 탭에 `counters`가 보이면 된 것이다.

### 3. Database ID 알려주기

**주소창의 URL을 그대로 복사해서 보내면 된다.** 이런 모양이고, 맨 끝이 Database ID다:

```
https://dash.cloudflare.com/<계정>/workers/d1/databases/a1b2c3d4-e5f6-…
                                                        ^^^^^^^^^^^^^^^^ 이것
```

화면에서 **Database ID** 항목을 찾아 복사해도 된다. **하이픈이 있는 UUID**다 —
하이픈 없는 32자리는 Account ID이니 그건 아니다.

### 4. 끝

ID를 `wrangler.toml`에 넣어 커밋하면 **master 푸시 → 자동 배포**로 켜진다.
잘 됐는지는 아래 &ldquo;혼자 확인해 보기&rdquo;로.

---

## B안 — 대시보드에 직접 붙여넣기 (저장소 연결 없이)

저장소를 연결하지 않고 손으로 올리는 경로. 메뉴 이름은 Cloudflare가 종종 바꾼다 —
라벨이 조금 달라도 찾는 대상(D1 / Bindings / Edit Code)이 같으면 그것을 고르면 된다.

### 1. D1 데이터베이스 만들기

1. [dash.cloudflare.com](https://dash.cloudflare.com) 로그인 (무료 계정으로 충분)
2. 왼쪽에서 **Storage & Databases → D1 SQL Database**
3. **Create** → 이름 `dewytear-wiki` → 만들기

### 2. 표 만들기

1. 방금 만든 DB를 열고 **Console** 탭
2. [`schema.sql`](./schema.sql)의 내용을 **그대로 붙여넣고** 실행
3. 성공하면 `counters` 표가 생긴다 (**Tables** 탭에서 확인)

### 3. Worker 만들기

1. 왼쪽에서 **Workers & Pages** → **Create** → **Create Worker**
2. 이름 `dewytear-wiki` → **Deploy** (내용은 곧 갈아엎으니 기본값 그대로)
3. **Edit Code** → 편집기의 내용을 전부 지우고 [`index.js`](./index.js)를 붙여넣기
4. **Deploy**

### 4. D1을 Worker에 연결 (이 단계를 빼면 500이 난다)

1. Worker 페이지 → **Bindings** 탭 (또는 Settings 안)
2. **Add binding** → **D1 database**
3. **Variable name**은 반드시 **`DB`** (대문자 두 글자 — 코드가 `env.DB`로 읽는다)
4. 데이터베이스는 `dewytear-wiki` 선택 → **Add binding**
5. 바인딩을 추가하면 **다시 Deploy**해야 적용된다

### 5. URL 확인해서 알려주기

Worker 페이지 위쪽에 이런 주소가 있다:

```
https://dewytear-wiki.<대표님계정서브도메인>.workers.dev
```

> `workers.dev` 주소가 안 보이면 아직 서브도메인을 안 고른 것이다 —
> Workers & Pages 설정에서 한 번 정해 주면 생긴다.

**이 URL만** 알려 주시면 `app.js`의 `LIKES_API`에 넣어 기능이 켜진다.

---

## 잘 되는지 혼자 확인해 보기 (경로 무관)

브라우저 주소창에 그냥 붙여넣어 본다:

```
https://<위 URL>/v1/totals
```

`{"likes":0,"docs":0}`가 나오면 성공이다. 다른 게 나오면:

| 증상 | 원인 |
|---|---|
| `{"error":"no-db"}` | D1 바인딩이 없다 — `wrangler.toml`의 `[[d1_databases]]` 또는 B안 4단계 |
| `{"error":"server"}` | `schema.sql`을 실행하지 않았다 |
| `{"error":"not-found"}` | 경로 오타 — `/v1/totals` |

---

## C안 — 로컬 CLI로 (wrangler, Node 필요)

```bash
npm i -g wrangler
wrangler login                                   # 브라우저로 인증, 토큰 복사 불필요
wrangler d1 create dewytear-wiki                 # 출력된 database_id를
                                                 #   wrangler.toml에 붙여넣기
wrangler d1 execute dewytear-wiki --remote --file=./schema.sql
wrangler deploy                                  # 끝에 나오는 URL을 알려주기
```

`wrangler.toml`은 **저장소 맨 위**에 있고, 고칠 것은 `database_id` 한 줄뿐이다.
그 ID는 비밀이 아니다(계정 인증 없이는 아무것도 못 한다).

---

## 조회수 이관 — 갈아탈 때 한 번만

조회수를 GoatCounter에서 이 Worker로 옮기는 순간, 이관하지 않으면 **모든 문서가
0으로 리셋된 것처럼 보인다.** 2026년 7월부터 쌓인 수치를 `base` 열에 심어 두고
그 위로 Worker가 증가분을 더하면 숫자가 이어진다.

```bash
python3 worker/seed_views.py > seed.sql          # GoatCounter를 읽어 SQL 생성
```

만들어진 `seed.sql`을 **D1 Console에 붙여넣거나** 아래로 실행한다:

```bash
wrangler d1 execute dewytear-wiki --remote --file=./seed.sql
```

`/counter/<path>.json`은 토큰 없이 읽히는 공개 엔드포인트다. 다만 그 응답도
서버에서 최대 4시간 캐시되므로 여기서 얻는 값은 이관 시점 기준 최대 4시간 이전
수치다 — 한 번 심고 마는 시작값이라 그 정도 오차는 문제가 되지 않는다.

---

## 비용

전부 무료 한도 안이다. 이 위키 규모에서 한도에 닿는 일은 사실상 없다.

| | 무료 한도 | 우리 사용 |
|---|---|---|
| Workers 요청 | 100,000 / 일 | 문서 열 때 1~2회 |
| D1 읽기 | 5,000,000 행 / 일 | 문서 열 때 1행 |
| D1 쓰기 | 100,000 행 / 일 | 조회 1 + 좋아요 누를 때 1 |
| D1 용량 | 5 GB | 문서 수 × 한 행 |

**KV가 아니라 D1인 이유**: KV 무료 쓰기는 **1,000/일**뿐이고(조회수는 페이지뷰마다
쓰기 1회다), 무엇보다 KV는 읽고→더하고→쓰는 사이에 낀 요청이 조용히 유실된다.
D1은 `ON CONFLICT DO UPDATE SET n = n + 1` 한 문장으로 원자적이다.

---

## 알려진 한계 (정직하게)

좋아요 1인 1회는 **브라우저 localStorage 표식**으로만 막는다. 서버는 누가 눌렀는지
**저장하지 않는다** — IP도, 해시도, 쿠키도 남기지 않는다.

- 시크릿창·다른 기기로는 **우회된다**
- 작정하고 `curl`을 도는 사람은 **못 막는다**

알고 고른 것이다. 개인 위키의 좋아요는 부풀려져도 잃는 게 없고, 대신 "쿠키·개인정보
수집 없음"이라는 약속을 그대로 지킬 수 있다. 방어는 그 약속을 깨지 않는 선까지만
한다 — Origin 허용목록, 문서 이름 정규식, 그리고 어디에도 쓰지 않는 아이솔레이트
메모리 스로틀.
