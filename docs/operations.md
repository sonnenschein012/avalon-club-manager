# 운영·인수인계

## 환경과 연결 대상

아래 값은 저장소의 `.firebaserc`, `firebase*.json`, Vite 설정 기준입니다. 실제 배포 상태를 조회한 기록은 아닙니다.

| 환경 | 실행/빌드 | Firebase 프로젝트 | Firestore | Hosting |
| --- | --- | --- | --- | --- |
| 운영 | `dev:prod`, `build` | `gen-lang-client-0205444206` | `ai-studio-cb68814f-9f80-4e46-95cd-4725aa93e8cb` | target `avalondgu-site` → site `avalondgu` |
| staging | `dev:staging`, `build:staging` | `avalon-manager-staging` | `(default)` | site `avalon-manager-staging` |
| Emulator Design Lab | `dev`, `design-lab` | `demo-avalon-manager` | 로컬 127.0.0.1:8080 | 배포 없음 |
| Scenario Lab | `scenario-lab` | 연결 없음 | 연결 없음 | 배포 없음 |

Vite가 `@firebase-config`를 모드별 `firebase-applet-config*.json`에 연결합니다. 운영과 staging은 서로 다른 데이터베이스입니다. `npm run dev`는 로컬 Emulator를 실행하고 합성 데이터를 초기화합니다. `npm run dev:prod`만 운영 Firebase에 연결합니다. Vite를 직접 실행해도 기본 development 모드는 로컬 Emulator에 연결되며 Emulator가 없으면 운영으로 우회하지 않습니다.

Design Lab의 Auth는 127.0.0.1:9099, Emulator UI는 127.0.0.1:4000입니다. 관리자는 로컬 계정으로 자동 로그인하고, 공개 면접 링크는 비로그인 상태로 실행합니다. seed/reset 스크립트는 고정된 로컬 프로젝트와 호스트만 허용합니다.

## 배포

Node.js 22와 저장소에 고정된 Firebase CLI를 사용합니다. Firebase 로그인/프로젝트 권한은 운영자가 별도로 준비합니다.

```bash
npm ci
# staging은 변경 기능에 해당하는 테스트만 제한적으로 실행
# 앱 코드만 변경한 경우
npm run build:staging
npm run deploy:staging:hosting
# 규칙/인덱스도 변경한 경우에는 위 두 명령 대신
# npm run deploy:staging
```

`deploy:staging`은 staging 빌드 → staging Rules/인덱스 → staging Hosting 순서입니다. 확인 주소는 [staging 앱](https://avalon-manager-staging.web.app)입니다. 기존 `avalon-manager-stg-260813` 사이트는 현재 설정의 대상이 아닙니다.

스테이징은 검증용 환경이므로 배포마다 전체 `npm run check`를 실행하지 않습니다. 변경 기능과 직접 관련된 검사만 최소 범위로 실행하고, 배포에는 staging 빌드·번들 분리 검사와 변경 화면 확인만 수행합니다. 규칙·인덱스 변경 시에는 해당 경계 검사를 추가합니다.

운영 배포는 검토한 변경 범위에 따라 명시적으로 실행합니다.

```bash
npm run build
npx firebase deploy --project gen-lang-client-0205444206 --config firebase.json --only hosting:avalondgu-site
# 규칙/인덱스를 변경했을 때
npm run test:rules
npx firebase deploy --project gen-lang-client-0205444206 --config firebase.json --only firestore
```

각 빌드는 같은 `dist/`를 사용하므로 배포 직전에 해당 환경으로 다시 빌드하세요. 면접 데이터 계약이나 공개 접근을 바꾸면 앱과 `firestore.rules`를 함께 검토합니다. `firebase.json`의 named database를 기본 데이터베이스로 잘못 바꾸지 마세요.

일반 빌드는 `index.html`만 포함합니다. `demo`/`scenario` 빌드는 Vite에서 거부하며, 빌드 뒤 `verify:production-bundle`은 Scenario Lab 진입점·fixture·가짜 사용자 표식이 운영 번들에 없는지 검사합니다.

CI는 main push/PR에서 lint, 타입, 단위 테스트, 규칙 테스트, 운영 빌드와 Emulator Design Lab의 Playwright 시나리오를 실행합니다. CI가 자동 배포하지는 않습니다. 배포 후에는 변경한 관리 화면과 공개 면접 링크를 확인합니다. Hosting 이전 버전으로 되돌리는 작업은 Firestore 데이터/규칙을 되돌리지 않습니다.

## 데이터 보관과 복구

- 설정의 회원/게임/세션 CSV는 AI와 대화할 때 분석·정리할 자료를 제공하고, 새 사이트 등으로 필요한 업무 정보를 이전하기 위한 출력입니다. 문서 ID, 관리자, 계획, 모든 면접 문서까지 복원하는 전체 백업은 현재 기능의 목적이 아닙니다.
- 이전할 때는 회원과 게임을 먼저 가져온 뒤 세션을 가져옵니다. 세션은 대상 명부의 이름·닉네임과 게임명을 이용해 연결을 다시 구성합니다. 현재 운영에서 회원은 학번을 입력해 등록하며, 게임 이미지를 입력하거나 표시하는 UI는 없습니다.
- 면접은 보통 2주 이내, 길어야 3주 정도 사용하는 업무입니다. 진행 중인 면접 상태의 사이트 간 이전·전체 복구와 과거 면접 상세 기록의 앱 내 재사용은 현재 요구 범위에 포함하지 않습니다. 지원서 원본은 외부에서 관리하며, 선발 기록은 면접 상세 기록과 별개로 취급합니다.
- 면접 회차의 CSV는 분석·정리에 활용할 지원자별 기록/이력을 포함하지만 자동 전체 복구 도구는 아닙니다. 공개 응답 링크는 bearer token이므로 로그나 공유 문서에 남기지 않습니다.
- 원본 데이터 전체의 복원이 별도로 필요해지면 보존 범위, 대상 데이터베이스, 접근 권한과 복원 절차를 정합니다. 원본 export/import는 별도 기능으로 검토하며, 현재 CSV의 완성 조건으로 요구하지 않습니다. 이 저장소는 운영 데이터 백업을 포함하지 않습니다.
- Emulator seed 데이터는 합성 데이터입니다. `demo:reset`은 로컬 데이터를 지우고 다시 구성하며, 운영 데이터 이관 용도로 사용하지 않습니다.

## 접근 권한을 넘길 때

1. Firebase 프로젝트/Hosting, GitHub 저장소, Google 로그인 설정의 관리자를 확인합니다. 접근 권한은 각 서비스에서 부여하며 비밀 값을 저장소에 기록하지 않습니다.
2. 새 운영자의 정규화한 이메일을 `admins` 문서 ID로 등록하고 `role: "master"`를 지정한 뒤 로그인을 확인합니다.
3. 현재 소스의 `checkAdminStatus`와 Rules는 `admins` 문서의 유효한 역할만 인정하며 bootstrap 이메일 예외를 제공하지 않습니다. 마스터 생성·승격·강등·삭제는 IAM 권한이 있는 Firebase Console 등에서 수행합니다. 일반 웹 클라이언트는 일반 관리자 생성·삭제만 가능하고 관리자 문서 수정은 모두 거부합니다. 소스와 환경별 배포 상태가 다를 수 있으므로 [관리자 권한 관리](admin-access-migration.md)의 정책과 확인 절차를 따릅니다.
4. 화면의 관리자 편집 모드 토글은 UI 조작 방지 장치입니다. 실제 접근 권한은 Firebase Authentication과 Firestore 규칙이 결정합니다.

설정 화면의 관리자 추가는 새 이메일에만 일반 운영자 권한을 생성합니다. 이미 등록된 이메일은 중복 안내 후 저장하지 않으므로 마스터/일반 운영자의 기존 권한과 생성 시각을 유지합니다. 서버 트랜잭션에서 기존 문서를 확인하며 동시에 추가해도 덮어쓰지 않습니다. 마스터 권한 지정은 위 인수인계 절차를 따릅니다.

일반 운영자의 설정 화면은 관리자 목록을 요청하지 않으며 등록·삭제 패널도 표시하지 않습니다. 역할을 Console에서 변경한 뒤에는 재로그인 또는 페이지 새로고침으로 화면을 갱신합니다. 실제 데이터 요청의 허용 여부는 Rules가 판단합니다.

## 변경과 개발 재개

현재 소스는 GitHub의 main에서 받습니다. 새 작업은 main에서 별도 브랜치로 시작하고 변경한 경계에 맞는 테스트를 실행합니다. CI는 검사만 수행하며 앱을 자동 배포하지 않습니다.

배포는 staging 확인 후 운영에 별도로 수행합니다. 환경별 빌드와 Hosting·Rules 배포를 구분하고 배포 후 변경 화면과 공개 면접 링크를 확인합니다. 저장소의 파일만으로 실제 운영 배포 상태를 확정하지 않습니다.

## 전시 운영 전환

전시 공개 사이트는 `firebase.exhibition.json`의 Hosting target `avalon-exhibition`으로 분리합니다. 운영 프로젝트의 매핑은 저장소의 `.firebaserc`에 정의되어 있습니다. Firebase에서 실제 사이트가 등록된 것을 확인한 뒤 해당 target만 배포합니다. 운영 앱의 `avalondgu-site`는 기존 설정에서 관리합니다. 관리 화면은 같은 설정의 `avalon-exhibition-admin` target으로 분리합니다. 두 사이트가 운영 프로젝트에 등록돼 있어야 하며, Google 로그인에 사용하는 Firebase Auth 승인 도메인에 관리자 사이트를 등록합니다.

1. 합성 데이터로 세션 생성·수정·삭제, 이름 조회 및 동료별 게임을 검증합니다. 운영 연결 전에는 스테이징 빌드와 비로그인 접근을 확인합니다.
2. Firebase 콘솔에서 기존 DB와 Spark 한도, 두 새 사이트의 실제 ID와 공유 Hosting 사용량을 확인합니다. 기존 프로젝트에서는 운영 앱과 전시가 한도를 공유합니다.
3. 승인 후 Firestore 규칙을 운영 앱과 전시의 새 빌드보다 먼저 적용합니다. 운영 기록 저장 트랜잭션은 운영 데이터만 처리합니다. 전시 관리자 화면이 열릴 때 원본을 대조하고 변경을 반영합니다. 장애 시 전시 설정을 비공개로 저장하면 공개 조회가 차단됩니다. 전시 데이터 묶음은 교체될 때 이전 묶음의 공개 접근이 닫힙니다. 교체된 게시 묶음과 이전 계산이 남긴 묶음은 관리자가 접속한 동안 자동 정리합니다. 비공개 전환만으로는 현재 보존 중인 묶음을 삭제하지 않습니다.
4. 실제 운영 데이터를 처음 반영하기 전에 전시 기간과 게임 매핑을 검토합니다. 원본과 전시가 다르면 전시 관리자 화면에서 오류 단계와 코드를 확인하고 필요 시 다시 반영을 요청합니다.

공개 빌드의 압축 추정치는 JS/CSS 합계 약 100 KB이고, 핀은 평균 약 122 KB, 최대 약 1.33 MB입니다. 핀 12개를 평균 크기로 가정한 전송량은 약 1.47 MB이며 여기에는 글꼴·배경·Firestore 응답이 포함되지 않습니다. 실제 동시 방문 및 브라우저 캐시 적중률을 포함한 운영 사용량은 별도 확인이 필요합니다.

### 운영 배포 명령

Firebase CLI에 공동 운영 계정으로 로그인하고 프로젝트와 사이트 목록을 확인합니다. 사이트가 아직 없다면 승인한 ID로 생성합니다. 이미 해당 프로젝트에 있는 사이트는 기존 ID를 사용합니다. 여기의 두 이름은 운영진이 선택한 주소입니다.

```bash
npx firebase login
npx firebase hosting:sites:list --project gen-lang-client-0205444206
# 각 사이트가 아직 없을 때만 생성
npx firebase hosting:sites:create avalon-collection --project gen-lang-client-0205444206
npx firebase hosting:sites:create avalon-collection-admin --project gen-lang-client-0205444206
```

Firebase Console의 Authentication 승인 도메인에 `avalon-collection-admin.web.app`을 추가하고 프로젝트의 Spark 상태를 확인합니다. 저장소 루트에서 운영용 빌드를 만든 뒤 규칙, 기존 운영 앱, 두 전시 사이트 순서로 배포합니다.

```bash
npm ci
npm run build
npm run exhibition:build
npm run exhibition:admin:build
npx firebase deploy --project gen-lang-client-0205444206 --config firebase.json --only firestore
npx firebase deploy --project gen-lang-client-0205444206 --config firebase.json --only hosting:avalondgu-site
npx firebase deploy --project gen-lang-client-0205444206 --config firebase.exhibition.json --only hosting:avalon-exhibition,hosting:avalon-exhibition-admin
```

관리 사이트에서 전시 ID `avalon`을 열어 처음에는 비공개로 기간과 핀 매핑을 저장합니다. 브라우저에서 관리자 로그인과 기존 운영 앱을 확인한 뒤 전시를 공개합니다. 공개 후 대표 기록의 이름 조회, 날짜, 동료별 게임과 핀 설명을 확인합니다.
