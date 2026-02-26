# ASCII Art Validation: Code Examples & Implementation

이 문서는 ASCII 다이어그램 검증을 위한 실제 구현 코드를 제공합니다.

## 기본 검증 함수 (Python)

### 1. 라인 길이 검증

```python
def validate_line_width(lines, expected_width):
    """
    모든 라인이 정확히 같은 너비를 가지는지 확인

    Args:
        lines: 문자열 라인 리스트
        expected_width: 예상 너비 (정수)

    Returns:
        (bool, dict): (성공 여부, 상세 정보)
    """
    results = {
        'valid': True,
        'issues': [],
        'widths': {}
    }

    for i, line in enumerate(lines):
        # 줄 끝 개행 제거
        clean_line = line.rstrip('\n')
        actual_width = len(clean_line)
        results['widths'][i] = actual_width

        if actual_width != expected_width:
            results['valid'] = False
            results['issues'].append(
                f"라인 {i}: 너비 {actual_width}, 예상 {expected_width}"
            )

    return results['valid'], results


def validate_all_lines_equal_width(lines):
    """
    모든 라인이 동일한 너비를 가지는지 확인

    Returns:
        (bool, dict): (성공 여부, 상세 정보)
    """
    if not lines:
        return False, {'issues': ['빈 라인 리스트']}

    widths = [len(line.rstrip('\n')) for line in lines]
    expected = widths[0]

    results = {
        'valid': all(w == expected for w in widths),
        'expected_width': expected,
        'actual_widths': {i: w for i, w in enumerate(widths)},
        'issues': []
    }

    for i, w in enumerate(widths):
        if w != expected:
            results['issues'].append(
                f"라인 {i}: {w} 문자 (예상: {expected})"
            )

    return results['valid'], results


# 사용 예시
text = """┌─────────────────┐
│ Title           │
├─────────────────┤
│ Content         │
└─────────────────┘"""

lines = text.split('\n')
valid, details = validate_all_lines_equal_width(lines)
print(f"검증: {valid}")
print(f"상세: {details}")
```

### 2. 박스 구조 검증

```python
def validate_box_structure(lines):
    """
    박스 구조의 정확성 검증

    확인사항:
    - 첫 라인: ┌ ... ┐ 형태
    - 중간 라인: │ ... │ 형태
    - 마지막 라인: └ ... ┘ 형태
    - 내부 가로선: ─ 일관성
    """
    issues = []

    if not lines or len(lines) < 3:
        return False, {'issues': ['최소 3개 라인 필요']}

    # 첫 라인 검증 (상단 테두리)
    first = lines[0]
    if first[0] != '┌':
        issues.append(f"라인 0 시작: '{first[0]}' 대신 '┌' 필요")
    if first[-1] != '┐':
        issues.append(f"라인 0 끝: '{first[-1]}' 대신 '┐' 필요")

    # 중간 라인 검증 (수직 테두리)
    for i in range(1, len(lines) - 1):
        line = lines[i]
        if line[0] != '│':
            issues.append(f"라인 {i} 시작: '{line[0]}' 대신 '│' 필요")
        if line[-1] != '│':
            issues.append(f"라인 {i} 끝: '{line[-1]}' 대신 '│' 필요")

    # 마지막 라인 검증 (하단 테두리)
    last = lines[-1]
    if last[0] != '└':
        issues.append(f"라인 {len(lines)-1} 시작: '{last[0]}' 대신 '└' 필요")
    if last[-1] != '┘':
        issues.append(f"라인 {len(lines)-1} 끝: '{last[-1]}' 대신 '┘' 필요")

    return len(issues) == 0, {'issues': issues}


# 사용 예시
valid, result = validate_box_structure(lines)
if not valid:
    for issue in result['issues']:
        print(f"❌ {issue}")
else:
    print("✓ 박스 구조 정상")
```

### 3. 열 정렬 검증 (테이블용)

```python
def validate_column_alignment(lines, column_positions):
    """
    특정 열 위치에서 문자 정렬 확인

    Args:
        lines: 텍스트 라인 리스트
        column_positions: 확인할 열 위치 리스트 (정수 인덱스)

    Returns:
        (bool, dict): 정렬 상태
    """
    issues = []
    alignment = {}

    for col_idx in column_positions:
        chars_at_column = []
        for line_idx, line in enumerate(lines):
            if col_idx >= len(line):
                issues.append(
                    f"라인 {line_idx}: 열 {col_idx}이 범위 초과"
                )
                continue
            char = line[col_idx]
            chars_at_column.append((line_idx, char))

        alignment[col_idx] = chars_at_column

    return len(issues) == 0, {
        'issues': issues,
        'alignment': alignment
    }


# 사용 예시: 박스의 첫 번째와 마지막 열 확인
valid, result = validate_column_alignment(lines, [0, len(lines[0]) - 1])

# 출력
for col, chars in result['alignment'].items():
    print(f"열 {col}:")
    for line_idx, char in chars:
        print(f"  라인 {line_idx}: '{char}'")
```

### 4. 테이블 셀 너비 검증

```python
def validate_table_columns(lines, column_widths):
    """
    테이블 열 너비 검증

    Args:
        lines: 테이블 라인 리스트
        column_widths: 각 열의 예상 너비 리스트

    예시:
        column_widths = [10, 8, 12]  # 3개 열
    """
    issues = []

    for line_idx, line in enumerate(lines):
        # │로 분할하여 셀 추출
        cells = line.split('│')[1:-1]  # 양쪽 끝 제거

        if len(cells) != len(column_widths):
            issues.append(
                f"라인 {line_idx}: 열 수 {len(cells)}, "
                f"예상 {len(column_widths)}"
            )
            continue

        for cell_idx, (cell, expected_width) in enumerate(
            zip(cells, column_widths)
        ):
            actual_width = len(cell)
            if actual_width != expected_width:
                issues.append(
                    f"라인 {line_idx} 셀 {cell_idx}: "
                    f"너비 {actual_width}, 예상 {expected_width}"
                )

    return len(issues) == 0, {'issues': issues}


# 사용 예시
table_text = """┌──────────┬────────┬────────┐
│ Name     │ Status │ Value  │
├──────────┼────────┼────────┤
│ Item 1   │ OK     │ 100    │
│ Item 2   │ Error  │ 50     │
└──────────┴────────┴────────┘"""

table_lines = table_text.split('\n')
valid, result = validate_table_columns(table_lines, [10, 8, 8])

if valid:
    print("✓ 테이블 열 너비 정상")
else:
    for issue in result['issues']:
        print(f"❌ {issue}")
```

### 5. 특정 문자 검증

```python
def validate_box_characters(lines, allowed_chars):
    """
    ASCII 다이어그램에 특정 문자만 사용되었는지 확인

    Args:
        lines: 텍스트 라인
        allowed_chars: 허용된 문자 세트

    예시:
        allowed = set('┌┐└┘─│├┤┬┴┼ ')  # 박스 문자 + 공백
    """
    invalid_chars = {}

    for line_idx, line in enumerate(lines):
        for char_idx, char in enumerate(line):
            if char not in allowed_chars:
                key = (line_idx, char_idx, char)
                if char not in invalid_chars:
                    invalid_chars[char] = []
                invalid_chars[char].append((line_idx, char_idx))

    if invalid_chars:
        issues = [
            f"허용되지 않은 문자: '{char}' "
            f"위치 {positions}"
            for char, positions in invalid_chars.items()
        ]
        return False, {'issues': issues}

    return True, {'issues': []}


# 사용 예시
allowed = set('┌┐└┘─│├┤┬┴┼ ')
valid, result = validate_box_characters(lines, allowed)

if not valid:
    for issue in result['issues']:
        print(f"❌ {issue}")
```

---

## 종합 검증 함수 (All-in-One)

```python
def validate_ascii_diagram(text, expected_width=None,
                          expected_height=None,
                          diagram_type='box'):
    """
    ASCII 다이어그램 종합 검증

    Args:
        text: 다이어그램 텍스트
        expected_width: 예상 너비 (옵션)
        expected_height: 예상 높이 (옵션)
        diagram_type: 'box', 'table', 'flowchart', 'tree'

    Returns:
        dict: 종합 검증 결과
    """
    lines = text.strip().split('\n')
    results = {
        'valid': True,
        'issues': [],
        'warnings': [],
        'stats': {
            'line_count': len(lines),
            'widths': {}
        }
    }

    # 기본 검증: 라인 길이
    widths = [len(line.rstrip('\n')) for line in lines]
    results['stats']['widths'] = {i: w for i, w in enumerate(widths)}

    if len(set(widths)) != 1:
        results['valid'] = False
        results['issues'].append(
            f"라인 너비 불일치: {set(widths)}"
        )

    # 예상 너비 검증
    if expected_width and widths[0] != expected_width:
        results['valid'] = False
        results['issues'].append(
            f"너비: {widths[0]}, 예상: {expected_width}"
        )

    # 예상 높이 검증
    if expected_height and len(lines) != expected_height:
        results['valid'] = False
        results['issues'].append(
            f"높이: {len(lines)}, 예상: {expected_height}"
        )

    # 타입별 검증
    if diagram_type == 'box':
        box_valid, box_result = validate_box_structure(lines)
        if not box_valid:
            results['valid'] = False
            results['issues'].extend(box_result['issues'])

    elif diagram_type == 'tree':
        # 트리 검증: 들여쓰기 확인
        for i, line in enumerate(lines):
            # 라인이 예상되는 문자로 시작하는지 확인
            stripped = line.lstrip()
            indent = len(line) - len(stripped)
            if indent > 0 and indent % 2 != 0:
                results['warnings'].append(
                    f"라인 {i}: 들여쓰기 {indent} (2의 배수 권장)"
                )

    return results


# 사용 예시
test_text = """┌──────────────────┐
│ Box Title        │
├──────────────────┤
│ Content line     │
└──────────────────┘"""

results = validate_ascii_diagram(
    test_text,
    expected_width=20,
    expected_height=5,
    diagram_type='box'
)

print(f"검증 결과: {'✓' if results['valid'] else '❌'}")
print(f"라인 수: {results['stats']['line_count']}")
print(f"너비: {results['stats']['widths']}")

if results['issues']:
    print("\n문제:")
    for issue in results['issues']:
        print(f"  - {issue}")

if results['warnings']:
    print("\n경고:")
    for warning in results['warnings']:
        print(f"  - {warning}")
```

---

## 실제 사용 예시 (Use Cases)

### 사용 예시 1: LLM 출력 검증

```python
def validate_llm_output(llm_response, expected_width=40):
    """
    LLM이 생성한 ASCII 다이어그램 검증
    """
    # 코드 블록 추출
    import re
    pattern = r'```\n(.*?)\n```'
    match = re.search(pattern, llm_response, re.DOTALL)

    if not match:
        return False, "코드 블록을 찾을 수 없음"

    ascii_text = match.group(1)

    # 검증 실행
    results = validate_ascii_diagram(
        ascii_text,
        expected_width=expected_width,
        diagram_type='box'
    )

    return results['valid'], results


# 테스트
llm_response = """
여기 결과입니다:

\`\`\`
┌──────────────────────────────────────┐
│ Title                                │
├──────────────────────────────────────┤
│ Content                              │
└──────────────────────────────────────┘
\`\`\`
"""

valid, details = validate_llm_output(llm_response, expected_width=40)
print(f"유효: {valid}")
```

### 사용 예시 2: 자동 생성 스크립트

```python
def generate_and_validate_box(title, content, width=40):
    """
    박스를 생성하고 자동 검증
    """
    # 박스 생성
    border = '┌' + '─' * (width - 2) + '┐'
    title_line = '│ ' + title.ljust(width - 4) + ' │'
    sep = '├' + '─' * (width - 2) + '┤'
    content_line = '│ ' + content.ljust(width - 4) + ' │'
    bottom = '└' + '─' * (width - 2) + '┘'

    box_text = f"{border}\n{title_line}\n{sep}\n{content_line}\n{bottom}"

    # 검증
    results = validate_ascii_diagram(
        box_text,
        expected_width=width,
        expected_height=5,
        diagram_type='box'
    )

    return box_text, results


# 테스트
box, results = generate_and_validate_box("My Box", "Hello", width=30)
print(box)
print(f"\n검증: {'✓' if results['valid'] else '❌'}")
```

### 사용 예시 3: 배치 검증

```python
def batch_validate_diagrams(diagram_dict):
    """
    여러 다이어그램을 한 번에 검증

    Args:
        diagram_dict: {이름: (텍스트, expected_width, type)}
    """
    report = {}

    for name, (text, width, diag_type) in diagram_dict.items():
        results = validate_ascii_diagram(
            text,
            expected_width=width,
            diagram_type=diag_type
        )
        report[name] = results

    # 리포트 생성
    print("=" * 50)
    print("ASCII 다이어그램 검증 리포트")
    print("=" * 50)

    for name, results in report.items():
        status = "✓ PASS" if results['valid'] else "❌ FAIL"
        print(f"\n{name}: {status}")
        print(f"  라인 수: {results['stats']['line_count']}")
        if results['issues']:
            for issue in results['issues']:
                print(f"  - {issue}")

    return report


# 사용 예시
diagrams = {
    'simple_box': (
        """┌────┐
│Box │
└────┘""",
        6,
        'box'
    ),
    'table': (
        """┌──┬──┐
│A │B │
├──┼──┤
│1 │2 │
└──┴──┘""",
        8,
        'table'
    )
}

batch_validate_diagrams(diagrams)
```

---

## JavaScript 구현 (TypeScript 호환)

```typescript
interface ValidationResult {
  valid: boolean;
  issues: string[];
  warnings: string[];
  stats: {
    lineCount: number;
    widths: Record<number, number>;
  };
}

function validateAsciiDiagram(
  text: string,
  expectedWidth?: number,
  expectedHeight?: number
): ValidationResult {
  const lines = text.trim().split('\n');
  const result: ValidationResult = {
    valid: true,
    issues: [],
    warnings: [],
    stats: {
      lineCount: lines.length,
      widths: {}
    }
  };

  // 라인 너비 확인
  const widths = lines.map(line => line.replace('\n', '').length);
  result.stats.widths = Object.fromEntries(
    widths.map((w, i) => [i, w])
  );

  // 모든 라인이 같은 너비인지 확인
  const uniqueWidths = new Set(widths);
  if (uniqueWidths.size > 1) {
    result.valid = false;
    result.issues.push(
      `라인 너비 불일치: ${Array.from(uniqueWidths).join(', ')}`
    );
  }

  // 예상 너비 확인
  if (expectedWidth && widths[0] !== expectedWidth) {
    result.valid = false;
    result.issues.push(
      `너비 ${widths[0]}, 예상 ${expectedWidth}`
    );
  }

  // 예상 높이 확인
  if (expectedHeight && lines.length !== expectedHeight) {
    result.valid = false;
    result.issues.push(
      `높이 ${lines.length}, 예상 ${expectedHeight}`
    );
  }

  // 박스 구조 확인
  if (lines[0]?.[0] !== '┌') {
    result.issues.push(`라인 0 시작: '${lines[0]?.[0]}' 대신 '┌' 필요`);
  }

  return result;
}

// 사용 예시
const testText = `┌──────────────────┐
│ Box Title        │
├──────────────────┤
│ Content line     │
└──────────────────┘`;

const result = validateAsciiDiagram(testText, 20, 5);
console.log(result.valid ? '✓' : '❌');
console.log('Issues:', result.issues);
```

---

## 통합 테스트 예제

```python
def test_all_validations():
    """
    모든 검증 함수 테스트
    """
    print("=" * 50)
    print("ASCII Art 검증 테스트")
    print("=" * 50)

    # 테스트 1: 정상 박스
    print("\n테스트 1: 정상 박스")
    normal_box = """┌─────┐
│Box  │
└─────┘"""
    lines = normal_box.split('\n')
    valid, details = validate_all_lines_equal_width(lines)
    print(f"결과: {'✓ PASS' if valid else '❌ FAIL'}")

    # 테스트 2: 너비 불일치
    print("\n테스트 2: 너비 불일치")
    bad_box = """┌─────┐
│Box   │
└─────┘"""
    lines = bad_box.split('\n')
    valid, details = validate_all_lines_equal_width(lines)
    print(f"결과: {'✓ PASS (정상 감지)' if not valid else '❌ FAIL'}")
    for issue in details['issues']:
        print(f"  {issue}")

    # 테스트 3: 박스 구조 검증
    print("\n테스트 3: 박스 구조 검증")
    valid, details = validate_box_structure(normal_box.split('\n'))
    print(f"결과: {'✓ PASS' if valid else '❌ FAIL'}")

    # 테스트 4: 종합 검증
    print("\n테스트 4: 종합 검증")
    results = validate_ascii_diagram(
        normal_box,
        expected_width=7,
        expected_height=3,
        diagram_type='box'
    )
    print(f"결과: {'✓ PASS' if results['valid'] else '❌ FAIL'}")
    print(f"통계: {results['stats']}")


if __name__ == '__main__':
    test_all_validations()
```

---

## 체크리스트: 구현 시 고려사항

LLM 스킬에 통합할 때:

- [ ] 라인 길이 검증 함수 포함
- [ ] 박스 구조 검증 함수 포함
- [ ] 열 정렬 검증 함수 포함
- [ ] 종합 검증 함수로 통합
- [ ] 에러 메시지를 명확하게 (사용자/개발자 친화적)
- [ ] 경고 vs 에러 구분
- [ ] JSON 출력 옵션 제공
- [ ] 시각적 리포트 생성 (예: 문제 위치 표시)
- [ ] 자동 수정 제안 (가능한 경우)
- [ ] 성능 고려 (큰 다이어그램에서도 빠른 검증)

---

## 참고: 출력 형식

권장 출력 형식:

```
=== ASCII Diagram Validation ===
Status: ✓ VALID / ❌ INVALID

Statistics:
  - Lines: 5
  - Width: 40 characters
  - Type: Box

Issues:
  - Line 2: Width 39, expected 40
  - Line 3: Corner character error

Warnings:
  - Consider adding padding for better readability

Details:
  Line 0: 40 chars ✓
  Line 1: 40 chars ✓
  Line 2: 39 chars ❌
  Line 3: 40 chars ✓
  Line 4: 40 chars ✓
```

이 형식을 사용하면 사용자가 문제를 쉽게 파악할 수 있습니다.
