---
name: index
description: 위키 지식 인덱스(knowledge-index)와 문서 일자(doc-dates)를 재생성·검증. 인덱스 리빌드, 연관 문서 갱신, 지식지도/그래프 데이터 갱신이 필요할 때 사용.
---

# 지식 인덱스 재생성

프로젝트 루트에 `tools/build_index.py`가 있으면 **프로젝트의 tools/**를 쓰고, 없으면
`${CLAUDE_PLUGIN_ROOT}/tools/`의 동봉 사본을 쓴다.

## 명령

```bash
python3 tools/build_index.py            # data/knowledge-index.<lang>.json 재생성 (결정적 빌드)
python3 tools/build_index.py --check    # 재생성 결과와 파일 일치 확인 — 0이어야 함
python3 tools/build_dates.py            # data/doc-dates.json 재생성 (git 이력 기반, KST 정규화)
```

## 계약 (자세한 것은 tools/schema.md)

- `knowledge-index.<lang>.json` — `schemaVersion: 2`. `docs[].related`는 **계산 필드**(직접 쓰지 말 것): idf 가중 개념 중복(공유 2개↑ 또는 단일 공유 df≤3) + 같은 폴더 보충.
- `doc-dates.json` — `{docs:{name:{c,u}}}` strict ISO 8601 **KST**. 표시는 날짜부만, 정렬은 전체 문자열, 새 글 판정은 `c`.
- **필드 추가 = 하위호환, 의미 변경·제거 = schemaVersion 증가.** 데이터 키 리네임 금지.

## 주의
- 입력은 `tools/doc-entries.<lang>.json` + `list` — 인덱스를 손으로 고치지 않는다(재생성하면 사라짐).
- `build_dates`는 커밋된 파일만 잡는다 — 새 문서는 커밋 → 재생성 → 재커밋 순서.
- 흔치 않은 개념의 df를 3→4로 올리는 엔트리 추가는 옆 문서의 단일-공유 엣지를 끊을 수 있다(경계값 파급).
