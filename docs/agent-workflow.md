# 에이전트 작업 방식

이 프로젝트는 React 19·TypeScript·Vite와 Firebase Authentication/Firestore를 사용하는 단일 웹앱입니다. ECC는 작업에 맞는 스킬을 선택하는 보조 도구로 사용합니다. 저장소의 AGENTS.md, [개발 가이드](development.md), [운영 가이드](operations.md), 소스·테스트·Rules를 기준으로 실행하고 ECC 예제의 명령·프레임워크를 그대로 도입하지 않습니다.

## 세션 시작과 작업 크기

1. README와 변경 기능에 해당하는 개발·운영 문서를 읽습니다.
2. `git status --short --branch`, `git diff`, `git diff --cached`로 기존 작업을 확인합니다. untracked 파일도 관련 범위에서 읽고, 이번 변경과 기존 변경을 구분합니다. 현재 checkout을 기본으로 사용합니다.
3. `node scripts/graphify.mjs status` 후 query/path/explain/affected로 탐색을 좁히고 실제 import·호출·저장 컬렉션·규칙·테스트를 확인합니다. stale 그래프의 누락은 영향 없음의 근거가 아닙니다.
4. 수정 전에 기대 동작, 영향 범위와 이를 증명할 검증을 짧게 정합니다. 이미 승인된 범위의 가역적인 로컬 작업은 계속 진행합니다.

| 작업 크기 | 진행 방식 |
| --- | --- |
| 문구·문서·국소 스타일 | 관련 원문 확인 → 직접 수정 → 링크/표시/diff 확인. 별도 계획 파일이나 구현을 그대로 따라 쓰는 테스트는 만들지 않습니다. |
| 한 기능의 동작 변경 | 기대 동작과 회귀 사례 정리 → 관련 테스트 재현/추가 → 구현 → 해당 경계 검증. 계획은 대화에 짧게 남깁니다. |
| 여러 기능·저장 형식·권한 변경 | 직접·간접 소비자와 호환성부터 확인 → 변경 순서·복구 방법 정리 → 구현 → 관련 단위/Rules/브라우저 검증. 지속되는 결정만 기존 docs에 반영합니다. |

직접 작업을 기본으로 합니다. ECC 스킬에 일반적인 에이전트 역할 예시가 있어도 자동 위임하지 않습니다. 사용자의 요청 또는 공식 Graphify 의미 분석·독립 검토 절차에서만 에이전트를 사용하며, Graphify 동시 작업자는 최대 두 명입니다.

## ECC 스킬 선택

해당 작업에 필요한 행만 선택하고 실행 전에 그 스킬의 SKILL.md를 읽습니다. 아래는 플러그인의 스킬 식별자이며, 특정 PC의 캐시 경로를 저장소에 고정하지 않습니다.

| 상황 | ECC 스킬 | 이 프로젝트에서 확인할 경계 |
| --- | --- | --- |
| 여러 화면·데이터의 영향 분석 | `ecc:change-impact` | 페이지 → hook → domain/service, 같은 Firestore 컬렉션을 읽는 간접 소비자, Rules와 내보내기 |
| React 화면·상태 변경 | `ecc:react-patterns` | 기존 컴포넌트/hook 책임, 구독 해제, 비동기 작업 취소, 오류/로딩 상태. Vite SPA에 맞춰 사용 |
| TypeScript 타입·변환 변경 | `ecc:typescript-patterns` | `src/types.ts`, 저장 타입과 화면 타입, CSV 및 legacy 값의 의미 |
| 폼·모달·탭 접근성 | `ecc:frontend-a11y` | label, 키보드, 포커스 제한·복원, 오류 안내와 모바일 조작 |
| 컴포넌트·hook 회귀 | `ecc:react-testing` | 기존 Vitest/jsdom 테스트 방식, 사용자 동작·비동기 성공/실패·충돌 검증 |
| 브라우저 동작·반응형 | `ecc:e2e-testing` | 기존 Playwright 설정과 합성 fixture, Scenario Lab/Emulator Design Lab 구분 |
| 인증·공개 링크·권한 | `ecc:security-review` | `src/lib/firebase.ts`, `firestore.rules`, 공개 면접 서비스, 토큰·관리자 경계와 Emulator 규칙 테스트 |
| 기능 완료·PR 전 검증 | `ecc:verification-loop` | 아래 검증 표에서 해당 경계 선택, 실제 실행 결과와 미실행 항목 구분, 최종 diff 검토 |

스킬 예제에 나오는 Next.js/RSC, SQL, Jest, MSW, 별도 테스트 라이브러리나 일괄 coverage 기준을 적용하려고 의존성·설정을 추가하지 않습니다. 기존 도구로 증명할 수 없는 요구가 있을 때 도입 필요성을 먼저 판단합니다. ECC가 없는 환경에서는 같은 저장소 절차와 명령으로 작업합니다.

## 검증 선택

Windows PowerShell에서는 `npm.cmd`를 사용합니다. macOS/Linux에서는 `npm`으로 바꿉니다. 검사 범위는 수정 전에 정하고, 새 변경이나 실패가 없으면 통과한 검사를 반복하지 않습니다.

| 바뀐 경계 | 검증 |
| --- | --- |
| 문서·작업 지침 | 로컬 링크·명령·원문과의 일치, `git diff --check`. 앱 빌드는 필요하지 않습니다. |
| TS/React 코드 | `npm.cmd run lint`, `npm.cmd run typecheck`와 해당 단위 테스트. 예: `npm.cmd exec -- vitest run src/services/sessionsService.test.ts` |
| 도메인·저장 변환 | 해당 단위 테스트에 정상/빈 값/과거 형식/실패 사례를 포함. 공유 컬렉션의 다른 소비자도 검토 |
| 화면·반응형·합성 fixture | `npm.cmd run scenario-lab:test` 또는 관련 Playwright spec. 실제 변경 화면·상태·viewport 확인 |
| hook/service와 실제 화면 연결 | `npm.cmd run design-lab:test` 또는 관련 spec. 로컬 Emulator의 합성 데이터만 사용 |
| Firestore 규칙·권한·공개 접근 | `npm.cmd run test:rules` 및 관련 서비스/공개 화면 검증 |
| 이미지 추출 | `npm.cmd run test:capture`. 기기 에뮬레이션과 실제 iOS Safari 확인을 구분 |
| Vite·진입점·의존성·배포 번들 | `npm.cmd run build` (번들 격리 검사 포함). 관련 환경 스크립트는 `node --test scripts/dev-environment.test.mjs` |
| 여러 경계의 앱 변경을 종합 확인 | `npm.cmd run check`. Rules·브라우저 검사는 포함되지 않으므로 해당할 때 별도 실행 |

규칙/Emulator 검증은 Java 21, 브라우저 검증은 해당 Playwright 브라우저가 필요합니다. 실행하지 못한 검사는 이유와 남은 확인 항목을 보고합니다. staging 배포 검증의 범위와 순서는 operations.md를 따릅니다. 전체 check를 모든 작업의 필수 단계로 만들지 않습니다.

## 데이터·실행 환경 경계

데이터 변경 시 개발 가이드의 attendee/member ID 변환, `boardMemberIds` 부재/빈 배열, 모임 계획/확정 세션, `scheduleId`의 undefined/null/ID 구분을 확인합니다. 구조가 비슷해도 서로 다른 업무 규칙은 유지합니다.

UI 시안은 `npm.cmd run scenario-lab`에서 확인합니다. 실제 인증·구독·저장·규칙은 `npm.cmd run dev` 또는 `npm.cmd run design-lab`의 Emulator에서 확인하며 시작 시 합성 데이터가 초기화됩니다. `dev:prod`는 운영 연결이므로 로컬 테스트에 사용하지 않습니다. 면접·출석 등 운영 자료를 fixture로 가져오지 않습니다.

## 완료와 공유

- 실제 변경 파일, 해결한 동작, 실행한 검사 결과와 남은 한계를 짧게 보고합니다. 로컬 검사 성공을 배포 환경 확인 완료로 표현하지 않습니다.
- 기존 staged/unstaged/untracked 작업과 이번 diff를 함께 검토합니다. 사용자 작업을 자동 commit/stash/reset하지 않습니다.
- Graphify는 [지식 그래프 운영](knowledge-graph.md)의 완료 이정표·후보 검증 절차로 갱신합니다. 진행 중인 다른 변경까지 포함한 의미 검토가 끝나지 않았으면 stale 상태와 남은 갱신을 명시하고, 검증된 공유 묶음을 덮어쓰지 않습니다.
- 배포는 operations.md에 따른 별도 작업입니다. 작업 방식·문서·그래프 설정만 바꾸었다면 앱 배포는 필요하지 않습니다.

## Codex의 ECC 설치 관리


설치·업데이트가 필요하면 `ecc:configure-ecc`에 따라 Codex native plugin lifecycle을 사용합니다. 이미 제공되는 스킬을 프로젝트에 복사하거나 Claude용 hook 프로필을 Codex에 적용하지 않습니다. 이 작업 방식은 AGENTS.md의 연결과 이 문서로 적용하며, 전역 권한·개인 설정·자동 학습·자동 실행 hook을 추가하지 않습니다.
