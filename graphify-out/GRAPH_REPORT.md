# Graph Report - avalon-board-game-club-manager  (2026-11-22)

## Corpus Check
- 364 files · ~172,968 words
- Verdict: corpus is large enough that graph structure adds value.
- Maintained input coverage is independently checked against scope.json; classifier gaps receive explicit semantic supplementation.

## Summary
- 1969 nodes · 5745 edges · 103 communities (81 shown, 22 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 68 edges (avg confidence: 0.87)
- Semantic token totals: unavailable in the current Codex host session.

## Graph Freshness
- Built from commit: `768bdad7`
- Commit records provenance. Run `node scripts/graphify.mjs status` to check input and artifact content hashes.
- Official AST update is local computation; semantic extraction and six-case review are also required when business meaning changes.

## Community Hubs (Navigation)
- 개인 효용 평가
- 앱 라우팅과 인증
- 면접 지원자 CSV
- 출석 드래그 이동
- 관리자 설정 권한
- 면접 운영 API
- 면접 일정 지정
- Emulator 합성 데이터
- 회원 등록과 복원
- 회원 등록과 복원
- 세션 조원 편집
- 출석 참가자 모델
- 출석 CSV 확인
- Scenario Lab 탐색
- 브라우저 테스트 환경
- 출석 참가자 모델
- 공개 응답 시간
- 면접 운영 API
- 프로젝트 실행 환경
- Graphify 최신성 검증
- 지원자 화면 흐름
- 학기별 출석 통계
- 앱 검증과 실행
- 공통 폼과 모달
- 모임 캔버스 출력
- 면접 완료 재개
- 배정 리비전 정책
- 학기별 출석 통계
- 면접 자동 배정
- 면접 진행 대시보드
- 공통 폼과 모달
- 면접 진행 대시보드
- 면접 자동 배정
- 회원 상세와 메모
- 효용 모의 계산
- 설정과 감사 화면
- 면접 문자 안내
- 개발 도구 의존성
- 세션 조원 편집
- 회원 상세와 메모
- 면접 데이터 구독
- 면접 도메인 타입
- 면접 자동 배정
- 참석자 과거 이력
- TypeScript 검사 설정
- 게임 CSV 검증
- 면접 노트 저장
- 독립 세션 생성
- 면접 이력 내보내기
- 면접 데이터 구독
- 수정 충돌 검증
- 에이전트 작업 절차
- Graphify 후보 파이프라인
- 면접 일정 입력
- 앱 실행 의존성
- 개인 효용 운영값
- 운영 권한과 감사
- Firestore 규칙 검사
- 보안 번들 검사
- 학기별 출석 통계
- 게스트 운영 계약
- 학기별 출석 통계
- 개발 데이터 계약
- Firebase 환경 구성
- 면접 자동 배정
- 관리자 권한 정책
- 합성 한국 날짜
- 모임 캔버스 출력
- 성별 효용 검토
- 에이전트 작업 절차
- 세션 기록과 출석 집계
- 조 인원 구성
- 운영 배포 절차
- 모임 캔버스 출력
- 독립 세션 생성
- 프로젝트 시작 안내
- 로컬 Emulator 실행
- 면접 진행 대시보드
- 지속적 통합 검사
- 한국 날짜 seed
- 지원자 합성 자료
- 조 인원 타입
- 운영 HTML 구성
- CI 검증 절차
- Firebase 운영 대상
- Git 텍스트 정규화
- 이메일 역할 판정
- Graphify 고정 버전
- 출석 CSV 테스트
- 참석자 변환 테스트
- 진단 보고서 테스트
- 진단 실행 보존
- 공통 CSS 테마
- 출석 저장 전검증
- 로컬 출석 왕복
- 학기 선택 회귀
- 출석 초안 fixture
- 면접 시간표 fixture

## God Nodes (most connected - your core abstractions)
1. `react` - 121 edges
2. `vitest` - 89 edges
3. `Member` - 87 edges
4. `lucide-react` - 67 edges
5. `firebase` - 56 edges
6. `addAuditEventToTransaction()` - 47 edges
7. `useAttendanceLogic()` - 42 edges
8. `useInterviewRoundLogic()` - 42 edges
9. `Session` - 42 edges
10. `Game` - 39 edges

## Surprising Connections (you probably didn't know these)
- `Korea date synthetic planning seed` --semantically_similar_to--> `koreaDateKey()`  [INFERRED] [semantically similar]
  scripts/seed-demo.mjs → src/domain/shared/koreaDate.ts
- `Explicit admin and master documents govern access` --semantically_similar_to--> `Master lifecycle belongs to trusted IAM management`  [INFERRED] [semantically similar]
  README.md → docs/admin-access-migration.md
- `Design Lab browser timezone` --conceptually_related_to--> `getLocalDateKey()`  [INFERRED]
  playwright.config.ts → src/domain/attendance/sessionMetadata.ts
- `CaptureFixture()` --indirect_call--> `date()`  [INFERRED]
  tests/capture/harness.tsx → src/domain/matching/personalUtility.test.ts
- `CaptureFixture()` --calls--> `MeetingCanvasTab()`  [EXTRACTED]
  tests/capture/harness.tsx → src/components/MeetingCanvasTab.tsx

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Operational guest identity becomes anonymous session count** — docs_guests_guest_identity, docs_guests_planning_snapshot, docs_guests_anonymous_session, docs_guests_guest_stats_boundary [EXTRACTED 1.00]
- **Operational guest identity becomes anonymous session count** — docs_guests_guest_identity, docs_guests_planning_snapshot, docs_guests_anonymous_session, docs_guests_guest_stats_boundary [EXTRACTED 1.00]
- **Legacy data states retain distinct meanings** — docs_development_attendee_member, docs_development_board_absence, docs_development_schedule_tristate [INFERRED 0.85]
- **Email roles and IAM handover remain separate authorities** — readme_database_roles, docs_admin_access_migration_trusted_master_lifecycle, docs_new_computer_separate_authority [INFERRED 0.85]
- **Portable graph evidence requires content hashes and semantic review** — docs_knowledge_graph_content_freshness, docs_knowledge_graph_portable_allowlist, docs_knowledge_graph_candidate_review, docs_knowledge_graph_six_cases [INFERRED 0.85]
- **Named operational guests become anonymous history** — src_domain_attendance_guests_explicit_guest_identity, src_domain_attendance_sessiongroups_operating_guest_snapshot, src_domain_attendance_sessiongroups_selected_identity_conversion, src_domain_sessions_sessiongroups_anonymous_guest_count_normalization, src_domain_exports_clubcsv_identity_preserving_session_csv [INFERRED 0.95]
- **Shared operational and historical storage** — src_hooks_useattendancelogic_useattendancelogic, src_hooks_usemeetingprogresslogic_usemeetingprogresslogic, src_services_sessionsservice_deletesessionrecord, src_domain_exports_clubcsv_buildsessionscsv, src_domain_stats_getattendanceranking_getattendanceranking [INFERRED 0.95]

## Communities (103 total, 22 thin omitted)

### Community 0 - "개인 효용 평가"
Cohesion: 0.06
Nodes (52): makeGroups(), solve(), CostEvaluationModal(), CostEvaluationModalProps, detailedValues(), EvaluationDialog(), Metric(), ReadingGuide() (+44 more)

### Community 1 - "앱 라우팅과 인증"
Cohesion: 0.06
Nodes (48): react-router-dom, App(), ArchivePage, AttendancePage, GamesPage, InterviewRoundPage, InterviewRoundsPage, MeetingProgressPage (+40 more)

### Community 2 - "면접 지원자 CSV"
Cohesion: 0.07
Nodes (37): ApplicantCsvImportModal(), ApplicantCsvImportModalProps, Summary(), CsvColumnSelect(), CsvColumnSelectProps, ApplicantCsvColumnMapping, ApplicantCsvField, ApplicantCsvPreview (+29 more)

### Community 3 - "출석 드래그 이동"
Cohesion: 0.10
Nodes (34): attendanceButtonBase, attendanceButtonStyles, AttendanceDragAndDrop(), AttendanceDraggableCard(), AttendanceDropZone(), CardProps, DropZoneProps, Disabled dragging preserves nested controls (+26 more)

### Community 4 - "관리자 설정 권한"
Cohesion: 0.10
Nodes (27): vitest, SettingsAdminPanel(), SettingsAdminPanelProps, SettingsExportPanel(), SettingsExportPanelProps, SettingsPage(), buildGamesCsv(), buildMembersCsv() (+19 more)

### Community 5 - "면접 운영 API"
Cohesion: 0.06
Nodes (12): useInterviewRoundLogic(), addRoundInterviewer(), INTERVIEWER_AUDIT_FIELDS, reactivateRoundInterviewer(), removeRoundInterviewer(), removeScheduleInterviewer(), resolveInterviewChangeRequest(), updateInterviewerAvailability() (+4 more)

### Community 6 - "면접 일정 지정"
Cohesion: 0.11
Nodes (30): react-dom, formatRange(), InterviewScheduleAssignmentModal(), Props, formatDateRange(), InterviewScheduleManagement(), Props, scheduleLabel() (+22 more)

### Community 7 - "Emulator 합성 데이터"
Cohesion: 0.05
Nodes (29): applicantDefinitions, applicantRecords, attendeeMembers, attendees, availabilityBySchedule, closedAvailability, closedDates, closedSlots (+21 more)

### Community 8 - "회원 등록과 복원"
Cohesion: 0.13
Nodes (30): eligibleSelectedApplicant(), Field(), MemberRegistrationModal(), MemberRegistrationPanel(), Metric(), Props, RegistrationTab, TabButton() (+22 more)

### Community 9 - "회원 등록과 복원"
Cohesion: 0.10
Nodes (26): papaparse, sonner, collectAuditChanges(), DormantSortableMember, sortDormantMembers(), AsyncActionFeedback, AsyncActionResult, AsyncActionStatus (+18 more)

### Community 10 - "세션 조원 편집"
Cohesion: 0.11
Nodes (22): cleanString(), findMember(), ImportedSession, parseSessionCsvRows(), splitNames(), games, members, mergeSessionGroups() (+14 more)

### Community 11 - "출석 참가자 모델"
Cohesion: 0.11
Nodes (25): MeetingCardStyleModalProps, attendeeMember(), guestRelationWarnings(), isGuest(), attendees, members, now, validateGuestInvitation() (+17 more)

### Community 12 - "출석 CSV 확인"
Cohesion: 0.11
Nodes (27): AttendanceCsvImportModal(), Confirmation binds the reviewed identity snapshot, CSV confirmation column and namesake list share semester labels, partyLabel(), Props, RowStatus(), Summary(), aliases (+19 more)

### Community 13 - "Scenario Lab 탐색"
Cohesion: 0.12
Nodes (30): resolveCompanionRequests(), AttendanceScenarioState, createAttendanceFixture(), createInterviewFixture(), createMembersFixture(), InterviewScenarioState, makeApplicant(), makeAttendee() (+22 more)

### Community 14 - "브라우저 테스트 환경"
Cohesion: 0.07
Nodes (10): Design Lab browser timezone, @playwright/test, headers, projectRoot, projectRoot, projectRoot, projectRoot, preview() (+2 more)

### Community 15 - "출석 참가자 모델"
Cohesion: 0.13
Nodes (23): calculateGroupAverageAttendance(), calculateGroupAverageStudentId(), getReunionWarnings(), AttendanceImportInput, getSizingNotices(), AttendanceMemberDraft, Harness(), mocks (+15 more)

### Community 16 - "공개 응답 시간"
Cohesion: 0.13
Nodes (25): addDaysToDateString(), calculateApplicantTimeWindow(), formatKoreanDate(), getKstDateString(), getSlotDate(), isValidDateString(), isValidTimeString(), PublicTimeWindowResult (+17 more)

### Community 17 - "면접 운영 API"
Cohesion: 0.15
Nodes (30): getAssignmentScheduleImpact(), addAuditEventToTransaction(), createInterviewRound(), applyConcreteInterviewScheduleChange(), assignApplicantsToInterviewSchedule(), assignRoundInterviewerToSchedule(), createInterviewSchedule(), deleteInterviewSchedule() (+22 more)

### Community 18 - "프로젝트 실행 환경"
Cohesion: 0.08
Nodes (28): engines, node, name, private, type, clsx, eslint, @eslint/js (+20 more)

### Community 19 - "Graphify 최신성 검증"
Cohesion: 0.12
Nodes (22): inventory(), walk(), Maintained text input inventory, roots, slash(), artifactHashes(), artifacts, atomic() (+14 more)

### Community 20 - "지원자 화면 흐름"
Cohesion: 0.10
Nodes (23): ApplicantFormModal(), applicantToDraft(), emptyDraft(), Props, ApplicantJourney(), BADGE_CLASS, InterviewRoundDeleteModal(), ApplicantRow() (+15 more)

### Community 21 - "학기별 출석 통계"
Cohesion: 0.17
Nodes (23): ArchiveLineChart(), AttendanceTrendChart(), chartPresentation, NewcomerTrendChart(), StagnationChart(), TrendChartProps, ArchiveExpandedChartModal(), ArchiveExpandedChartModalProps (+15 more)

### Community 22 - "앱 검증과 실행"
Cohesion: 0.06
Nodes (31): scripts, build, build:staging, check, clean, demo, demo:reset, demo:seed (+23 more)

### Community 23 - "공통 폼과 모달"
Cohesion: 0.15
Nodes (20): lucide-react, motion, react, ConfirmDeleteModal(), ConfirmDeleteModalProps, GameFilters(), GameFiltersProps, GameForm() (+12 more)

### Community 24 - "모임 캔버스 출력"
Cohesion: 0.14
Nodes (19): archivedLabel(), MeetingVersionsPanel(), DailyPlanning, calculateGridPositions(), generateDrinkOrderText(), koreaDateKey(), Harness(), mocks (+11 more)

### Community 25 - "면접 완료 재개"
Cohesion: 0.19
Nodes (22): filterInterviewApplicants(), getApplicantJourney(), prepareInterviewCompletion(), prepareInterviewReopen(), canAppearInInterviewProgress(), canAppearInSchedule(), canAppearInSelection(), getInterviewProgressStatus() (+14 more)

### Community 26 - "배정 리비전 정책"
Cohesion: 0.12
Nodes (18): getApplicantAssignmentRevision(), isActiveAssignment(), prepareScheduleResetTransition(), prepareWithdrawalTransition(), applyOptimisticAssignment(), assignmentIdentity(), rollbackOptimisticApplicant(), isInterviewRevisionConflict() (+10 more)

### Community 27 - "학기별 출석 통계"
Cohesion: 0.21
Nodes (16): getSemester(), getAvailableArchiveSemesters(), dailyAttendance(), getAttendanceRanking(), getAttendanceTrend(), getGameMmi(), getNewcomerTrend(), getStagnationIndex() (+8 more)

### Community 28 - "면접 자동 배정"
Cohesion: 0.15
Nodes (26): addEdge(), AutoAssignmentApplicant, AutoAssignmentExisting, AutoAssignmentFailure, AutoAssignmentFailureReason, AutoAssignmentInput, AutoAssignmentInterviewer, AutoAssignmentMode (+18 more)

### Community 29 - "면접 진행 대시보드"
Cohesion: 0.18
Nodes (22): ApplicantDetailModalProps, Props, reasonLabel, assignmentTime(), InterviewerDashboard(), isOperationalApplicant(), Metric(), Props (+14 more)

### Community 30 - "공통 폼과 모달"
Cohesion: 0.16
Nodes (17): MemberFilters(), MemberFiltersProps, MemberForm(), MemberFormProps, MemberList(), MemberListProps, MembersPage(), PageHeader() (+9 more)

### Community 31 - "면접 진행 대시보드"
Cohesion: 0.16
Nodes (20): round, DECISION_BUTTON_STYLES, getSelectionDecisionButtonClass(), SelectionDecision, copyText(), DecisionButton(), DecisionButtonProps, RATING_STYLES (+12 more)

### Community 32 - "면접 자동 배정"
Cohesion: 0.14
Nodes (25): addDays(), addMinutesToSlot(), AffectedScheduleResponse, assertPositiveInteger(), AssignmentScheduleImpact, AssignmentScheduleImpactItem, assignmentsOverlap(), AvailabilityResponse (+17 more)

### Community 33 - "회원 상세와 메모"
Cohesion: 0.11
Nodes (17): firebase, original, app, auth, FirestoreErrorInfo, googleProvider, OperationType, CREATE (+9 more)

### Community 34 - "효용 모의 계산"
Cohesion: 0.18
Nodes (17): compareAssignments(), evaluateAssignment(), EXAMPLE_PARAMETERS, key(), protectUtilities(), saturation(), stringOrder(), syntheticMembers() (+9 more)

### Community 35 - "설정과 감사 화면"
Cohesion: 0.14
Nodes (20): AuditRow(), SettingsAuditPanel(), AUDIT_ACTION_LABELS, AUDIT_CATEGORY_LABELS, AuditActionCode, AuditCategory, AuditChange, AuditEvent (+12 more)

### Community 36 - "면접 문자 안내"
Cohesion: 0.14
Nodes (18): ApplicantDetailModal(), copyText(), formatTimestamp(), getAssignmentParts(), getStoredAssignmentParts(), addMinutesToTime(), InterviewRoundFormModal(), roundToDraft() (+10 more)

### Community 37 - "개발 도구 의존성"
Cohesion: 0.08
Nodes (24): devDependencies, eslint, @eslint/js, eslint-plugin-react-hooks, firebase-admin, @firebase/eslint-plugin-security-rules, @firebase/rules-unit-testing, firebase-tools (+16 more)

### Community 38 - "세션 조원 편집"
Cohesion: 0.12
Nodes (16): @dnd-kit/core, @dnd-kit/utilities, CoreData, DndHandlers, DraggableMember(), DroppablePool(), GroupActions, ModalControl (+8 more)

### Community 39 - "회원 상세와 메모"
Cohesion: 0.20
Nodes (16): GroupGamesEditModal(), GroupGamesEditModalProps, MemberProfileContent(), MemberProfileModal(), MemberProfileModalProps, SessionList(), SessionListProps, SessionsPage() (+8 more)

### Community 40 - "면접 데이터 구독"
Cohesion: 0.14
Nodes (13): getRoundScheduleStatus(), getSurveyStatus(), InterviewRoundsPage(), mocks, round, schedule(), stamp(), InterviewRoundCounts (+5 more)

### Community 41 - "면접 도메인 타입"
Cohesion: 0.16
Nodes (19): Props, AssignmentProposalWrite, CompleteInterviewInput, INTERVIEW_LINK_ORIGIN, InterviewRoundDraft, InterviewRoundExportRecords, InterviewScheduleDraft, AttendeeId (+11 more)

### Community 42 - "면접 자동 배정"
Cohesion: 0.18
Nodes (20): activeApplicant(), Bot(), CompactStatus(), confirmationCurrent(), DraggableScheduleCard(), DroppableScheduleCell(), halfHourBucket(), INTERVIEWER_THEMES (+12 more)

### Community 43 - "참석자 과거 이력"
Cohesion: 0.19
Nodes (17): Explicit identity and legacy lookup boundary, Explicit ID and legacy-prefix fallback tests, buildGroupCostContext(), attendee(), member(), session(), timestamp(), calculateAgeVarianceCost() (+9 more)

### Community 44 - "TypeScript 검사 설정"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, allowJs, exactOptionalPropertyTypes, experimentalDecorators, isolatedModules, jsx, lib (+12 more)

### Community 45 - "게임 CSV 검증"
Cohesion: 0.16
Nodes (11): GameFormProps, GameCsvImport, parseGameCsv(), recommendedPlayerRange(), Tests invalid CSV rows reject all games with original row numbers, createGameFormData(), GameFormData, Tests permit a positive bound paired with unspecified zero (+3 more)

### Community 46 - "면접 노트 저장"
Cohesion: 0.13
Nodes (12): Tests pending flush locks close and failure retains notes and blocks action-needed transition, EMPTY_NOTE, NoteDraft, NoteSaveState, serialize(), Tests delayed failed applicant A saves and stale subscriptions cannot alter B, Harness(), interviewer (+4 more)

### Community 47 - "독립 세션 생성"
Cohesion: 0.18
Nodes (10): nextSessionName(), resolveDailySessionId(), ResolveDailySessionIdInput, getDefaultSessionName(), getLocalDateKey(), getTodaySessionMetadata(), isSingleDocumentId(), hasInterviewRoundNotes() (+2 more)

### Community 48 - "면접 이력 내보내기"
Cohesion: 0.19
Nodes (16): applicationValue(), ASSIGNMENT_STATUS_LABELS, assignmentColumns(), buildInterviewCsvRows(), CsvRow, formatRating(), formatSlot(), formatTimestamp() (+8 more)

### Community 49 - "면접 데이터 구독"
Cohesion: 0.18
Nodes (10): useInterviewRoundData(), subscribeInterviewAccess(), subscribeInterviewApplicants(), subscribeInterviewChangeRequests(), subscribeRoundInterviewers(), subscribeRoundScheduleInterviewers(), getInterviewLink(), getInterviewRoundExportRecords() (+2 more)

### Community 50 - "수정 충돌 검증"
Cohesion: 0.25
Nodes (14): normalizeApplicantNumber(), assertExpectedRevision(), assertExpectedUpdatedAt(), InterviewRevisionConflictError, timestampMillis(), APPLICANT_AUDIT_FIELDS, applicantAuditView(), createInterviewApplicant() (+6 more)

### Community 51 - "에이전트 작업 절차"
Cohesion: 0.12
Nodes (15): Restore one coherent verified Graphify bundle, Candidate extraction is sealed and independently reviewed, Content and artifact hashes determine graph freshness, Graphify runtime is pinned to graphifyy0.9.84, Only seven reviewed Graphify artifacts are shared, Six source-backed verification cases guard meaning, Graphify is supplementary to source tests and Rules, Host semantic token totals may be unmeasured (+7 more)

### Community 52 - "Graphify 후보 파이프라인"
Cohesion: 0.24
Nodes (7): ast(), build(), load(), portable(), save(), scan(), seal()

### Community 53 - "면접 일정 입력"
Cohesion: 0.26
Nodes (14): addDays(), dateFromKey(), datesInRange(), dateWeekName(), InterviewScheduleFormModal(), scheduleToDraft(), suggestedInterviewScheduleDraft(), SurveyDateTimeCard() (+6 more)

### Community 54 - "앱 실행 의존성"
Cohesion: 0.13
Nodes (15): dependencies, clsx, @dnd-kit/core, @dnd-kit/utilities, firebase, html-to-image, lucide-react, motion (+7 more)

### Community 55 - "개인 효용 운영값"
Cohesion: 0.14
Nodes (13): Ambiguous mentions require an explicit candidate choice, Bounded movable companion-pair exchanges supplement individual search, Diagnostic schema and model identifiers describe data meaning, Search diagnostics stay in screen memory with anonymous local IDs, Recorded search samples are not global assignment percentiles, Same and other gender utility use saturating exponentials, Companion matching uses full names and Korean short names literally, Global relative protection precedes request attenuation (+5 more)

### Community 56 - "운영 권한과 감사"
Cohesion: 0.14
Nodes (4): All unlisted document paths deny reads/writes, isMasterAdmin requires stored role master, DailyPlanning snapshots append-only versions with server time and caller email; updates denied, Registered operators manage members/games/sessions/attendees/DailyPlannings/interviews

### Community 57 - "Firestore 규칙 검사"
Cohesion: 0.16
Nodes (9): @firebase/rules-unit-testing, baseline, current(), probe(), results, rules, InterviewFixtureOptions, seedInterviewFixture() (+1 more)

### Community 58 - "보안 번들 검사"
Cohesion: 0.15
Nodes (10): distDirectory, forbiddenFiles, forbiddenMarkers, pending, projectRoot, textExtensions, violations, button() (+2 more)

### Community 59 - "학기별 출석 통계"
Cohesion: 0.24
Nodes (8): getParticipationHistory(), ParticipationHistory, compareSemesters(), getActiveMembersAtSemester(), getNewbieMembersAtSemester(), isMemberActiveAtSemester(), parseSemester(), members

### Community 60 - "게스트 운영 계약"
Cohesion: 0.17
Nodes (4): Optional guest opt-in/name/drink columns with validated preview and atomic roster replacement, guestCount absent zero; nonnegative safe integer normalization, Dashboard/canvas shows names like members; session list uses anonymous individual tags, DailyPlanning retains guest attendee identity/name/drink/inviter snapshot

### Community 61 - "학기별 출석 통계"
Cohesion: 0.28
Nodes (9): ArchiveWidgetPopularGamesProps, ARCHIVE_DIFFICULTY_RANGES, matchesArchiveGameFilters(), games, members, session, getCorePlayers(), getPopularGames() (+1 more)

### Community 62 - "개발 데이터 계약"
Cohesion: 0.17
Nodes (11): Missing boardMemberIds differs from explicit empty array, PNG export uses Blob URLs with delayed revocation, Resolve companion ambiguity with explicit local choices, Attendance CSV confirmation binds current member identities, Diagnostics omit real identity and do not rerun search, Pages hooks domain services have distinct responsibilities, check excludes separate Rules and browser suites, scheduleId undefined null and real ID are different (+3 more)

### Community 63 - "Firebase 환경 구성"
Cohesion: 0.18
Nodes (12): 합성 Demo Firebase 연결, 운영 Firebase 앱 연결, Staging Firebase 앱 연결, Demo Emulator 구성, 운영 구성 내 Firestore Emulator 설정, 운영 Firebase 배포 구성, Staging Firebase 배포 구성, 지원자 회차·면접관·시각 인덱스 (+4 more)

### Community 64 - "면접 자동 배정"
Cohesion: 0.30
Nodes (10): AutoAssignmentPanel(), slotLabel(), candidatesForVacatedSlot(), ReassignmentApplicant, ReassignmentInterviewer, ReassignmentRecommendation, recommendReassignment(), slotMinutes() (+2 more)

### Community 65 - "관리자 권한 정책"
Cohesion: 0.18
Nodes (10): Missing invalid unreadable admin roles grant no access, Recover valid role documents or reviewed Rules through IAM, All client admin document updates are denied, Admin identity is the trimmed lowercase email document ID, Master clients create and delete ordinary admins only, Public interview token rules remain a separate boundary, Existing admins need valid IDs and roles without forced full schema migration, Self document get is allowed for role resolution (+2 more)

### Community 66 - "합성 한국 날짜"
Cohesion: 0.20
Nodes (11): completedNotes, daySchedules(), interviewerProfiles, kstDate(), kstDateKey(), kstParts(), makeSchedule(), members (+3 more)

### Community 67 - "모임 캔버스 출력"
Cohesion: 0.29
Nodes (6): html-to-image, captureBoard(), attendees, CaptureFixture(), groups, members

### Community 68 - "성별 효용 검토"
Cohesion: 0.40
Nodes (8): evaluateGenderLayout(), GENDER_REVIEW_SIZES, genderUtility(), PREVIOUS_GENDER_PARAMETERS, REVIEW_CURVES, reviewCurve(), reviewGenderComposition(), reviewGenderSuite()

### Community 69 - "에이전트 작업 절차"
Cohesion: 0.22
Nodes (8): Refresh Graphify only at a completed verified milestone, ECC installation uses native Codex plugin lifecycle, Direct work with limited official Graphify delegation, Preserve staged unstaged and untracked work, Select verification for the changed boundary, Source tests Rules and maintained docs govern implementation, Use synthetic local scenarios for verification, Only explicit dev:prod connects local development to production

### Community 70 - "세션 기록과 출석 집계"
Cohesion: 0.22
Nodes (8): Attendee IDs must convert to stored member IDs, DailyPlannings and sessions are distinct documents, Every session is an independent ID-based record, Attendance newcomer and stagnation timelines union members per local day, Ranking and member CSV count independent sessions, Manual session naming is not globally reserved, Session CSV preserves IDs groups and board snapshots, Concurrent starts serialize through the date DailyPlanning

### Community 71 - "조 인원 구성"
Cohesion: 0.22
Nodes (8): Operator group count stays fixed, Manual placements constrain per-group capacity lower bounds, Explicit companion preference outranks inferred utility, Companion requests do not trigger capacity recalculation, Existing reunion warnings differ from personal reunion evaluation, Group size policy is a lexicographic comparison, Deterministic size-vector and group-ID tie breaking, Request board and protected personal utility compare lexicographically

### Community 72 - "운영 배포 절차"
Cohesion: 0.22
Nodes (8): Register a normalized master through trusted IAM then verify login, CSV exports are operational analysis and selective transfer, Hosting Rules and indexes are separate deployment boundaries, Duplicate admin additions preserve existing roles and timestamps, Production named DB staging default DB and local labs are separate, Interview workflow is short-lived with external application originals, Hosting rollback does not rollback Rules or Firestore data, Staging verification follows changed functionality

### Community 73 - "모임 캔버스 출력"
Cohesion: 0.42
Nodes (6): MeetingDashboardTabProps, getMemberPlayedGames(), prng(), Reason, RecMode, recommendGames()

### Community 74 - "독립 세션 생성"
Cohesion: 0.42
Nodes (8): isRequestSelections(), defaultDraft(), drafts, emptySelections, isDraft(), readDraft(), storageKey(), useAttendanceDraft()

### Community 75 - "프로젝트 시작 안내"
Cohesion: 0.25
Nodes (7): Members games meetings sessions and interviews, Current source comes from main, Emulator Design Lab uses real hooks services and Rules, Default development resets synthetic Emulator data, Tracked guides suffice for a new computer, Production bundles exclude Scenario fixtures, Scenario Lab renders fixture UI without Firebase

### Community 76 - "로컬 Emulator 실행"
Cohesion: 0.39
Nodes (5): findJava(), firebaseCli, normalizeJavaHome(), projectRoot, runEmulators()

### Community 77 - "면접 진행 대시보드"
Cohesion: 0.52
Nodes (4): Info(), InterviewersPanel(), RosterInfo(), countActiveInterviewerSchedules()

### Community 78 - "지속적 통합 검사"
Cohesion: 0.40
Nodes (4): Browser failure artifacts are retained seven days, CI runs lint types unit graph Rules build and browser suites, CI verifies main pushes and pull requests, CI uses Node22 and Java21

### Community 79 - "한국 날짜 seed"
Cohesion: 0.50
Nodes (3): dailyPlanning, planningDateKey, todayKey

### Community 80 - "지원자 합성 자료"
Cohesion: 0.67
Nodes (3): applicantApplication(), buildApplicant(), sentMessage()

## Knowledge Gaps
- **496 isolated node(s):** `name`, `private`, `type`, `dev`, `dev:prod` (+491 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 679 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **22 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ScenarioShell()` connect `Scenario Lab 탐색` to `앱 라우팅과 인증`?**
  _High betweenness centrality (0.001) - this node is a cross-community bridge._
- **What connects `name`, `private`, `type` to the rest of the system?**
  _496 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `개인 효용 평가` be split into smaller, more focused modules?**
  _Cohesion score 0.05775803144224197 - nodes in this community are weakly interconnected._
- **Why does `ScenarioContent()` connect `Scenario Lab 탐색` to `공통 폼과 모달`?**
  _High betweenness centrality (0.000) - this node is a cross-community bridge._
- **Should `앱 라우팅과 인증` be split into smaller, more focused modules?**
  _Cohesion score 0.05563093622795115 - nodes in this community are weakly interconnected._
- **Should `면접 지원자 CSV` be split into smaller, more focused modules?**
  _Cohesion score 0.06826241134751773 - nodes in this community are weakly interconnected._
- **Should `출석 드래그 이동` be split into smaller, more focused modules?**
  _Cohesion score 0.0966183574879227 - nodes in this community are weakly interconnected._

## Project verification boundary

Semantic extraction used the current Codex session. Exact input/output token totals are unavailable; library counters of 0 do not mean no LLM cost. This graph contains current source relationships plus inferred document concepts. Source/tests/Rules remain authoritative.

## Extraction limits

The exported graph retains 5901 relation links; endpoint-pair analysis contains 5745 directed pairs. Raw extraction diagnostics report 100 unresolved endpoint references, 47 external references, 8 self-loop candidates and 156 same-endpoint collapses (3 exact duplicates). These are extraction limits, not proof that all source relationships are represented. Source and tests must supplement graph queries. Unchanged semantic source evidence was reused only with matching content hashes.
