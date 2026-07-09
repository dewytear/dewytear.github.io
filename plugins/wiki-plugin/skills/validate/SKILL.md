---
name: validate
description: 위키 품질 검증 일괄 실행 — validate_all(라우트·문서·i18n·그래프·도식) + PR 게이트(check_worklog·check_cachebuster). 머지 전 점검, ERROR/WARN 해석이 필요할 때 사용.
---

# 위키 검증

프로젝트 루트에 `tools/validate_all.py`가 있으면 **프로젝트의 tools/**를 쓰고, 없으면
`${CLAUDE_PLUGIN_ROOT}/tools/`의 동봉 사본을 쓴다.

## 명령

```bash
python3 tools/validate_all.py                                # 상태 검사 5종 일괄 — ERROR 0가 머지 조건
python3 tools/check_worklog.py --base origin/master          # PR 게이트: Work Log 추가(A) 또는 갱신(M) 동반 확인
python3 tools/check_cachebuster.py --base origin/master      # PR 게이트: ?v 자산 변경 시 index.html ?v 상향 확인
```

## ERROR / WARN 해석

- **ERROR = 머지 불가.** `missing-file`(list 노드의 파일 없음), `orphan-file`(work-log가 list 미등록 — 내비에 안 떠 "안 쌓임"), `broken-link`(`#!route` 대상 없음), `dup-name` 등.
- **WARN = 검토 신호(고치라는 뜻이 아님).** 특히 지식 그래프의 `isolated-doc`·`wrong-cluster`·`generic-concept`는 문서 성격상 자연스러울 수 있다 — **고립 WARN을 없애려 본문에 없는 개념을 넣는 것은 금지**(그래프 왜곡 + 경계값 파급). `worklog-day-split`(일자 폴더 로그 5개↑)은 빅 프레임 병합 검토 신호.
- 보정하지 않는 WARN은 사유를 Work Log에 남긴다.

## 게이트 통과 규칙 요지
- `check_worklog`: 실질 변경이 있으면 work-log 문서를 **추가하거나 기존 주제 로그를 갱신**해야 통과(로깅 전용 변경은 예외).
- `check_cachebuster`: `index.html`이 `?v=`로 로드하는 자산을 고치면 같은 PR에서 그 `?v`를 올려야 통과(재방문 브라우저 캐시 무효화).
