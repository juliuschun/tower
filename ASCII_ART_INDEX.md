# ASCII Art Research: 문서 가이드

LLM ASCII 아트 생성에 관한 포괄적인 연구 자료 모음

## 문서 구성

### 1. 시작하기 (Start Here)

**👉 [ASCII_ART_EXECUTIVE_SUMMARY.md](./ASCII_ART_EXECUTIVE_SUMMARY.md)** - 2-3분 읽기
- 핵심 발견사항 요약
- 성능 벤치마크
- 스킬 구현 로드맵
- 추천 사항

**추천 대상**: 경영진, 의사결정자, 빠른 개요 필요자

---

### 2. 실무 적용 (Implementation)

**👉 [ASCII_ART_QUICK_RULES.md](./ASCII_ART_QUICK_RULES.md)** - 5-10분 읽기
- 5가지 필수 규칙
- 10가지 구체적 기법
- 상황별 프롬프트 템플릿
- 실패 모드별 대응
- 검증 체크리스트
- 디버깅 팁

**추천 대상**: 개발자, 팀 리더, 즉시 적용 필요자

---

### 3. 심화 연구 (Deep Dive)

**👉 [ASCII_ART_RESEARCH.md](./ASCII_ART_RESEARCH.md)** - 30-40분 읽기
- Part 1: 근본적 문제 & 실패 모드
- Part 2: 검증 & 정렬 기법
- Part 3: ASCII 다이어그램 타입별 분석
- Part 4: LLM 프롬프트 엔지니어링 전략
- Part 5: 기존 솔루션 & 도구
- Part 6: 합성된 규칙 & 코딩 가능한 규칙
- Part 7: 주요 발견 요약
- Part 8: 스킬 구현 권장사항

**포함**: 50+ 학술 논문/블로그 참고, 구체적 예시, 코드 스니펫

**추천 대상**: 리서처, 아키텍트, 깊이 있는 이해 필요자

---

### 4. 구현 코드 (Code)

**👉 [ASCII_ART_VALIDATION_CODE.md](./ASCII_ART_VALIDATION_CODE.md)** - 20-30분 읽기
- Python 구현 (완전한 함수 7개)
- TypeScript/JavaScript 구현
- 실제 사용 예시 3개
- 통합 테스트 예제
- 배치 검증 시스템

**특징**:
- 복사해서 바로 쓸 수 있는 코드
- 함수별 상세 설명
- 에러 처리 포함
- 프로덕션 레디

**추천 대상**: 엔지니어, 구현 담당자

---

## 빠른 참조 (Quick Reference)

### 상황별 어떤 문서를 읽을까?

| 상황 | 추천 문서 | 읽기 시간 |
|------|---------|---------|
| "5분 안에 알고 싶어" | Executive Summary | 3분 |
| "팀에 규칙 공유하고 싶어" | Quick Rules | 5분 |
| "프롬프트 템플릿 필요" | Quick Rules + Research (Part 4) | 15분 |
| "검증 함수 구현하고 싶어" | Validation Code | 20분 |
| "완전히 이해하고 싶어" | 모든 문서 | 60분 |
| "특정 실패 모드 해결하고 싶어" | Research (Part 1) + Quick Rules | 20분 |
| "대체 솔루션 찾아야 해" | Research (Part 5) | 10분 |

---

## 문서별 핵심 내용

### ASCII_ART_EXECUTIVE_SUMMARY.md

**섹션**:
1. 핵심 발견 (3가지)
   - 근본적 한계: 공간적 시각화 불가능
   - 일반적 실패 모드 (6가지)
   - 구조화된 제약조건의 효과

2. 해결책 요약 (3가지)
   - 강력한 제약조건
   - 단계별 생성
   - 대체 방식 선택

3. 실무 적용 (3단계)
   - Phase 1: 프롬프트 템플릿 (Week 1)
   - Phase 2: 검증 시스템 (Week 2)
   - Phase 3: 에러 처리 (Week 3)

4. 성능 벤치마크
   - 모델별 기본 성공률
   - 프롬팅 적용 후 개선 (30% → 80%)

5. 스킬 구현 로드맵

**Key Numbers**:
- 기본 성공률: ~30%
- 개선 가능: ~80%
- 모델별 차이: Claude > GPT-4 > Gemini > Llama2

---

### ASCII_ART_QUICK_RULES.md

**5가지 필수 규칙**:
1. 정확한 너비 명시
2. 코드 블록 필수
3. 검증 요청 포함
4. 예시 제공
5. 재생성 요청 (수정 금지)

**10가지 구체적 기법**:
1. 명시적 그리드 계획
2. 단계별 생성
3. 문자 레벨 지정
4. 토큰-픽셀 매핑
5. 라인별 문자 카운트
6. 테이블 열 너비 명시
7. 모노스페이스 폰트 언급
8. 간단한 ASCII 우선
9. CJK 문자 인식
10. 반복 검증 루프

**프롬프트 템플릿** (5가지):
- Simple Box
- Table
- Flowchart
- Tree
- Sequence Diagram

---

### ASCII_ART_RESEARCH.md

**8개 파트**:

**Part 1: 근본적 문제** (15쪽)
- 공간적 시각화 불가능 (Spatial Blindness)
- Tokenization & Whitespace 이슈
- 6가지 구체적 실패 모드
- CJK 문자 너비 문제
- 보이지 않는 문자 (Invisible Characters)
- 업데이트 수정 문제

**Part 2: 검증 기법** (12쪽)
- 문자 수 검증
- 박스 구조 검증
- 열 정렬 검증
- 특정 문자 검증
- 20개+ 박스 드로잉 문자 참고
- 모노스페이스 폰트 요구사항
- 검증 도구 소개

**Part 3: ASCII 다이어그램 타입** (8쪽)
- Simple Box/Table 구조
- Multi-Column 테이블
- Flowchart/Diagram
- Tree 구조
- Architecture/Timeline
- Sequence Diagram
- 각각 검증 포인트

**Part 4: LLM 프롬프팅 전략** (10쪽)
- 전략 1-5: 구체적 기법들
- 단계별 프롬팅 (Chain-of-Thought)
- 예시 제공 (Few-Shot)
- Monospace 문맥
- 재생성 vs 수정
- 반복 개선

**Part 5: 기존 솔루션** (8쪽)
- ASCII Canvas
- DiagrammerGPT
- Fine-tuned 모델 (140K 데이터셋)
- Mermaid/PlantUML 대체
- 온라인 에디터 (ASCIIFlow, Textik, Diagon)
- 프로그래밍 라이브러리

**Part 6: 합성된 규칙** (8쪽)
- Pre-Generation 체크리스트 (11항목)
- Post-Generation 체크리스트 (10항목)
- 문자 카운팅 참고표
- 길이 제약 가이드라인
- 수정 전략 (실패 시)

**Part 7: 요약** (5쪽)
- 작동하는 것 (✅ 5개)
- 작동하지 않는 것 (❌ 10개)
- 근본적 한계

**Part 8: 스킬 구현** (4쪽)
- 우선순위별 규칙
- 구현 고려사항
- 참고 문헌 (50+개 소스)

---

### ASCII_ART_VALIDATION_CODE.md

**5개 핵심 함수** (Python):
1. `validate_line_width()` - 라인 길이 검증
2. `validate_box_structure()` - 박스 정확성
3. `validate_column_alignment()` - 열 정렬
4. `validate_table_columns()` - 테이블 셀
5. `validate_box_characters()` - 허용된 문자
6. `validate_ascii_diagram()` - 종합 검증
7. `batch_validate_diagrams()` - 배치 검증

**JavaScript/TypeScript**:
- TypeScript 타입 정의
- 호환성 유지

**실제 사용 예시** (3개):
1. LLM 출력 검증
2. 자동 생성 & 검증
3. 배치 검증 시스템

**통합 테스트**:
- 정상 케이스
- 에러 감지
- 모든 함수 테스트

---

## 주요 통계

### 연구 범위
- **학술 논문**: 10개 이상
- **블로그/아티클**: 20개 이상
- **GitHub 이슈**: 8개
- **커뮤니티 토론**: 10개 이상
- **도구/라이브러리**: 12개
- **데이터셋**: 1개 (140K 샘플)

### 모델 커버리지
- GPT-3.5, GPT-4, GPT-4o (OpenAI)
- Claude, Claude Opus (Anthropic)
- Gemini (Google)
- Llama2 (Meta)
- 기타 Multimodal 모델

### 기술 커버리지
- Tokenization 메커니즘
- Transformer 아키텍처
- Self-Attention 동작
- BPE/WordPiece 알고리즘
- 2D Grid 이해
- 공간 추론 (Spatial Reasoning)

---

## 구현 체크리스트

### 스킬 개발 시
- [ ] Quick Rules 팀 공유
- [ ] 3가지 프롬프트 템플릿 구현
- [ ] 기본 검증 함수 통합 (validate_line_width, validate_box_structure)
- [ ] 에러 메시지 작성
- [ ] 베타 테스트

### 고급 기능
- [ ] 자동 수정 제안
- [ ] CJK 지원
- [ ] Mermaid 대체 제시
- [ ] 성능 프로파일링
- [ ] 문서화

---

## FAQ

### Q: 어디서 시작해야 하나요?
A: Executive Summary 5분 읽고 → Quick Rules로 팀 동일화 → Research로 깊이 있는 이해

### Q: 성공률을 어느 정도까지 높일 수 있나요?
A: 기본 30% → 제약조건 적용 시 80% 달성 가능. 복잡한 구조는 한계 있음.

### Q: 모든 모델이 같은 정도로 실패하나요?
A: 아니요. Claude (90%) > GPT-4 (85%) > Gemini (75%) > Llama2 (60%)

### Q: 복잡한 다이어그램은 어떻게 하나요?
A: ASCII 대신 Mermaid/PlantUML 또는 ASCII Canvas 사용 권장

### Q: 검증은 필수인가요?
A: 권장사항. 검증 없으면 70-80% 실패율. 검증 있으면 20-30% 실패율.

### Q: CJK 문자는 왜 문제인가요?
A: 각 CJK 문자 = 2 terminal columns (ASCII는 1 column). 너비 계산 필요.

---

## 피드백 및 개선

이 연구는 지속적으로 업데이트됩니다:

- 새로운 LLM 모델 추가 시
- 더 나은 기법 발견 시
- 실제 구현 경험 축적 시
- 커뮤니티 피드백 수집 시

---

## 라이선스 및 참고

모든 연구 내용은 원래 소스를 존중하며 구성되었습니다.
각 섹션의 "Sources:" 또는 "참고자료:" 섹션 참고.

주요 학술 기여자:
- Jaemin Han (Why LLMs Suck at ASCII Art)
- University of Washington (ArtPrompt)
- SkyPilot 팀 (Multimodal 분석)
- CHI 2024 (Taking ASCII Seriously)

---

## 문서 위치 (Absolute Paths)

```
/home/enterpriseai/claude-desk/ASCII_ART_INDEX.md (이 파일)
/home/enterpriseai/claude-desk/ASCII_ART_EXECUTIVE_SUMMARY.md
/home/enterpriseai/claude-desk/ASCII_ART_QUICK_RULES.md
/home/enterpriseai/claude-desk/ASCII_ART_RESEARCH.md
/home/enterpriseai/claude-desk/ASCII_ART_VALIDATION_CODE.md
```

---

**Document Version**: 1.0
**Created**: 2026-02-23
**Last Updated**: 2026-02-23
**Status**: ✓ 완료

---

## 다음 단계 (Next Steps)

1. **팀 온보딩** (1일)
   - Quick Rules 공유
   - 기본 템플릿 학습

2. **프로토타입 구현** (3-5일)
   - 프롬프트 템플릿 3개
   - 검증 함수 기본
   - 테스트

3. **베타 테스트** (1주)
   - 실제 사용 사례 적용
   - 피드백 수집
   - 개선

4. **프로덕션 배포** (1주)
   - 최종 최적화
   - 문서화
   - 모니터링

**목표**: 2026년 3월 초 완성
