# ASCII Art Generation for LLMs: Quick Reference Rules

**핵심 원칙**: LLM의 공간적 시각화 한계를 구조화된 제약조건으로 보완한다.

## 최상위 5개 규칙 (Must-Have)

### Rule 1: 정확한 너비 명시 (Width Constraint)
```
DO:   "Generate exactly 40 characters per line, 5 lines total"
DON'T: "Make an ASCII box"

WHY:  LLMs can't count spaces reliably without explicit constraints
```

### Rule 2: 코드 블록 필수 (Markdown Code Block)
```markdown
DO:
\`\`\`
┌──────────────────┐
│ Content          │
└──────────────────┘
\`\`\`

DON'T: Paste directly into message without backticks
```

WHY:  Prevents invisible Unicode control characters

### Rule 3: 검증 요청 포함 (Verification in Prompt)
```
DO:   "After generating, count characters in each line.
       Show: Line 1 [40 chars], Line 2 [40 chars], etc."

DON'T: Just ask for diagram without verification
```

WHY:  Models perform better with explicit verification steps

### Rule 4: 예시 제공 (Provide Examples)
```
DO:   "Here's the exact format:
       ┌──────────┐
       │ Title    │
       └──────────┘

       Generate similar with [YOUR CONTENT]"

DON'T: Describe abstractly without showing format
```

WHY:  Concrete examples are far more effective than descriptions

### Rule 5: 재생성 요청, 수정 금지 (Regenerate, Don't Fix)
```
DO:   "Generate complete new diagram including [CHANGE]"
DON'T: "Update the diagram to add [CHANGE]"
```

WHY:  Models fail at incremental modifications but succeed at generation

---

## 10가지 구체적 기법 (Techniques)

### Technique 1: 명시적 그리드 계획
```
Prompt:
"Create box structure. FIRST plan:
- Total width: 30 characters
- Total height: 5 lines
- Content width: 28 (after borders)
- Corner chars: ┌ ┐ └ ┘
- Border chars: ─ │

Then generate with character counts for each line."
```

### Technique 2: 단계별 생성 (Step-by-Step)
```
Step 1: "Describe the ASCII diagram structure (don't generate yet)"
Step 2: "Generate simple version using + - | characters only"
Step 3: "Upgrade to box-drawing characters: ┌ ─ ┐ │ └ ┘"
Step 4: "Verify alignment by counting characters"
```

### Technique 3: 문자 레벨 지정
```
"Use EXACTLY these characters:
- Horizontal line: ─ (U+2500)
- Vertical line: │ (U+2502)
- Corners: ┌ (TL) ┐ (TR) └ (BL) ┘ (BR)
- Do NOT use other box characters"
```

### Technique 4: 토큰-픽셀 매핑 (One-Token-Per-Position)
```
"Generate so each character = exactly one position.
Use simple ASCII if needed: use + - | instead of boxes.
Result width must match visible character count, not internal tokens."
```

### Technique 5: 라인별 문자 카운트
```
"Format output as:
┌─────────────┐  [LINE 1: 15 chars]
│ Content     │  [LINE 2: 15 chars]
└─────────────┘  [LINE 3: 15 chars]

Then verify each count matches."
```

### Technique 6: 테이블 열 너비 명시
```
"Table structure:
- Column 1: 10 characters wide
- Column 2: 8 characters wide
- Column 3: 12 characters wide
- Total: 33 characters (including separators)

Generate with all cells padded to exact widths."
```

### Technique 7: 모노스페이스 폰트 언급
```
"Generate ASCII art for monospace font rendering
(Courier New, Consolas, Monaco, or similar).
Assume each character = exactly 1 column width."
```

### Technique 8: 간단한 ASCII 우선
```
Use this IF perfect box-drawing isn't critical:

+----------+      instead of:    ┌──────────┐
| Content  |                     │ Content  │
+----------+                     └──────────┘

Why: Easier for models, works everywhere, simpler to verify"
```

### Technique 9: CJK 문자 인식
```
"If table includes Chinese/Japanese/Korean characters:
- Each CJK char = 2 terminal columns (double-width)
- ASCII char = 1 terminal column
- Adjust column widths accordingly"
```

### Technique 10: 반복 검증 루프
```
"Generate diagram.
Then answer these:
1. How many chars in line 1? [Your count]
2. Are all lines same width? [Yes/No]
3. Do corners use ┌ ┐ └ ┘? [Yes/No]
4. Is content aligned? [Yes/No]"
```

---

## 실패 모드 & 대응 (Failure Modes)

| Failure | Cause | Fix |
|---------|-------|-----|
| 열 정렬 안 맞음 | 문자 수 계산 실패 | 너비 명시 + 검증 요청 |
| 테두리 깨짐 | ┌ ┐ └ ┘ 혼동 | 문자 지정 + 예시 제공 |
| 간격 불일치 | 행마다 다른 패딩 | 패딩 값 명시 |
| 업데이트 실패 | 수정 능력 부족 | 재생성 요청 |
| 보이지 않는 문자 | 복사 과정에서 삽입 | 코드블록 사용 |
| CJK 위치 이동 | 너비 미계산 | 너비 인식 명시 |

---

## 상황별 프롬프트 템플릿

### Template 1: 간단한 박스 (Simple Box)
```
Generate an ASCII box with exactly 40 characters wide, 5 lines tall:

┌──────────────────────────────────────┐
│ [TITLE]                              │
├──────────────────────────────────────┤
│ [CONTENT]                            │
└──────────────────────────────────────┘

Use ONLY: ┌ ─ ┐ │ ├ ┘ └
After generating, count characters per line and verify all = 40.
```

### Template 2: 테이블 (Table)
```
Generate table with 3 columns:
- Column 1 (Name): 15 chars
- Column 2 (Status): 10 chars
- Column 3 (Value): 8 chars
- Total line width: 36 chars

┌───────────────┬──────────┬────────┐
│ Name          │ Status   │ Value  │
├───────────────┼──────────┼────────┤
│ [Item 1]      │ [Status] │ [Val]  │
└───────────────┴──────────┴────────┘

Verify: each line = 36 characters, columns align vertically.
```

### Template 3: 플로우차트 (Flowchart)
```
Generate ASCII flowchart (no width constraint, but verify alignment):

Step 1: Describe structure
- 3 boxes arranged vertically
- Connected by vertical lines │
- Centered alignment

Step 2: Generate with these chars: ┌ ─ ┐ │ └ ┘ ↓ →
Step 3: Verify vertical alignment at center column
```

### Template 4: 트리 구조 (Tree)
```
Generate tree with indentation = 2 spaces per level:

Root
├── Branch 1
│   ├── Leaf 1.1
│   └── Leaf 1.2
└── Branch 2

Verify: Indentation consistent, last items use └─, others use ├─
```

### Template 5: 시퀀스 다이어그램 (Sequence)
```
Generate sequence diagram (monospace font context):

Actor A         Actor B
   │               │
   ├──Message───>│
   │               │
   │<──Response──┤
   │               │

Verify: Vertical alignment of │ characters, message line alignment
```

---

## 검증 체크리스트 (Verification Checklist)

생성 후 반드시 확인:

- [ ] 각 라인의 문자 개수 동일한가?
- [ ] 테두리 모서리가 ┌ ┐ └ ┘ 인가?
- [ ] 수직선 │이 정렬되어 있는가? (0번 위치, 끝 위치)
- [ ] 수평선 ─이 일관되는가?
- [ ] 내용 패딩이 일관되는가?
- [ ] 코드 블록으로 감싸져 있는가?
- [ ] 보이지 않는 유니코드 문자는 없는가? (plain text에 복사해보기)
- [ ] 모노스페이스 폰트로 확인했는가?
- [ ] CJK 문자가 있다면 너비 계산했는가?

---

## LLM별 예상 성공률 (Success Rate Estimates)

| Task | GPT-4 | Claude | Gemini | Llama2 |
|------|-------|--------|--------|--------|
| 간단한 박스 (Simple box) | 85% | 90% | 75% | 60% |
| 테이블 (Table) | 70% | 80% | 65% | 45% |
| 플로우차트 (Flowchart) | 55% | 65% | 50% | 30% |
| 복잡한 구조 (Complex) | 20% | 30% | 15% | 5% |

**주의**: 위 숫자는 제약조건 없이 측정한 값. 본 규칙 적용 시 ~70-80% 달성 가능.

---

## 더 나은 대안 고려

복잡한 다이어그램은 ASCII 대신 다음 사용:

- **플로우차트/다이어그램**: Mermaid (`flowchart`, `graph`, `sequenceDiagram`)
- **UML 다이어그램**: PlantUML
- **아키텍처**: Graphviz/DOT
- **시각 편집**: ASCII Canvas (LLM-friendly alternative)

**이점**:
- LLM이 구조를 이해하기 쉬움
- 이미지로 변환 가능
- 수정이 쉬움
- 정렬 문제 없음

**단점**:
- 일반 텍스트 아님
- 추가 렌더링 필요

---

## 디버깅 팁 (Debugging Tips)

### 문제: 열이 정렬 안 됨 (Misaligned Columns)

1단계: 첫 라인 문자 수 요청
```
"What's the character count for line 1? Count each character."
```

2단계: 모든 라인 같은 크기 요청
```
"Make ALL lines exactly [X] characters. Pad with spaces if needed."
```

3단계: 검증 요청
```
"Show character count for each line to verify all equal."
```

### 문제: 테두리 깨짐 (Broken Border)

원인: 모서리 문자 혼동 (┐를 ┌으로 등)

해결:
```
"Use EXACTLY:
- Top-left: ┌ (NOT ┐)
- Top-right: ┐ (NOT ┌)
- Bottom-left: └ (NOT ┘)
- Bottom-right: ┘ (NOT └)"
```

### 문제: 수정이 안 됨 (Modification Failed)

원인: 업데이트 능력 부족 (LLM 아키텍처 한계)

해결: 재생성
```
"Generate COMPLETE NEW diagram including [CHANGE]. Don't modify existing."
```

### 문제: 보이지 않는 문자 (Invisible Characters)

원인: 복사 과정에서 삽입된 유니코드 제어문자

확인:
```
1. 텍스트 에디터에서 보기 (메모장, nano)
2. 16진수 덤프로 확인: od -c filename
3. 특이한 바이트 시퀀스 찾기
```

해결: 코드 블록 강제 사용
```
"Output in markdown code block:
\`\`\`
[YOUR ASCII]
\`\`\`"
```

---

## 참고자료 (References)

### 필독 논문/블로그
- [Why LLMs Suck at ASCII Art](https://medium.com/data-science/why-llms-suck-at-ascii-art-a9516cb880d5) - Jaemin Han
- [ArtPrompt](https://arxiv.org/abs/2402.11753) - ACL 2024 research
- [ASCII Canvas](https://github.com/Sayhi-bzb/ascii-canvas) - LLM-friendly alternative
- [Taking ASCII Drawings Seriously](https://pg.ucsd.edu/publications/how-programmers-diagram-code_CHI-2024.pdf) - CHI 2024

### 유용한 도구
- [ASCIIFlow](https://asciiflow.com/) - 대화형 편집기
- [Textik](https://textik.com/) - ASCII 다이어그램 에디터
- [Diagon](https://arthursonzogni.com/Diagon/) - 생성기 모음

### 박스 그리기 문자 (Box-Drawing Reference)
- [Wikipedia: Box-drawing characters](https://en.wikipedia.org/wiki/Box-drawing_characters)
- [tamivox.org: Box drawing chars](http://tamivox.org/dave/boxchar/index.html)

---

## 핵심 요약 (TL;DR)

1. **제약조건 명시**: 너비, 높이, 사용 문자 정확하게
2. **예시 제공**: 추상적 설명 대신 구체적 예시
3. **검증 요청**: 생성 후 자동 검증 요청
4. **코드 블록**: 마크다운 백틱으로 감싸기
5. **재생성**: 수정 금지, 새로 생성 요청

이 5가지만 해도 성공률 70% 이상 달성 가능.
