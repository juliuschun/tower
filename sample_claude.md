# Sample: Workspace CLAUDE.md

> **What is this file?**
> This is a fully-annotated reference template for `workspace/CLAUDE.md`.
> When you run `setup.sh`, a customized version is auto-generated for you.
> Use this file to understand each section and adapt it to your team.
>
> **한국어/영어 혼용** — Tower 팀 스타일을 따라 섹션 제목은 영어, 내용은 언어 선택에 따라 작성.

---

## 📌 Section 1: Header

```markdown
# Acme Corp — Workspace
```

> **역할**: 첫 줄에 팀/회사 이름을 넣는다. Claude가 대화를 시작할 때 컨텍스트를 즉시 파악한다.
> **Tip**: "Enterprise AI Team — Workspace", "Team Alpha — Workspace" 형식으로 작성.

---

## 📌 Section 2: Role of This Directory

```markdown
## Role of This Directory

This is the **team brain** — decisions, docs, memos, and project outputs.
Not a code project. For build/dev rules, see each repo's own CLAUDE.md.
```

> **역할**: 이 workspace가 코드 저장소가 아님을 명확히 한다.
> Claude는 종종 CLAUDE.md를 코드 프로젝트 컨텍스트로 혼동한다.
> 이 구분이 없으면 불필요한 코드 관련 동작이 발생할 수 있다.

---

## 📌 Section 3: Directory Structure

```markdown
## Directory Structure

workspace/
├── CLAUDE.md              # ← This file
├── principles.md          # Team principles
├── memory/MEMORY.md       # Team context (updated quarterly)
├── decisions/             # Decision records (immutable)
├── docs/                  # Process docs, guides
├── notes/                 # Temporary memos
└── projects/              # (Optional) Per-client outputs
```

> **역할**: Claude가 파일을 만들 때 어디에 넣을지 안다.
> **커스터마이즈**: 팀이 쓰지 않는 폴더는 제거하고, 추가 폴더는 여기서 설명.
>
> 예시 추가:
> ```
> └── dashboards/          # BI/analytics dashboard configs
> └── integrations/        # External service setup notes
> ```

---

## 📌 Section 4: Agent Behavior Rules

```markdown
## Agent Behavior Rules

### On Session Start
1. Read `memory/MEMORY.md` — understand priorities and team status
2. Know `principles.md` — especially "Write it down" and "Record the why"
3. Search `decisions/` before starting — check for prior art

### While Working
- Decisions → suggest recording: "Want to add this to decisions/?"
- File naming: decisions → YYYY-MM-DD-title.md, notes → YYYY-MM-DD.md
- decisions/ files are immutable. To change a decision, create a new file.
```

> **역할**: 이것이 CLAUDE.md의 핵심이다. Claude의 세션 행동을 제어한다.
>
> **커스터마이즈 포인트**:
> - "On Session Start"에 팀 전용 컨텍스트 파일 추가
>   예: "3. Check `projects/active/` for current client work"
> - 파일 네이밍 컨벤션을 팀 규칙에 맞게 수정
> - 특정 폴더가 immutable이면 여기서 명시

---

## 📌 Section 5: Communication Style

```markdown
## Communication Style

When explaining technical decisions:
- Plain language, everyday analogies
- Simplest explanation first, detail only if asked
- If a technical term is necessary, explain it right after (one sentence)
```

> **역할**: Claude의 응답 톤과 언어를 제어한다.
>
> **커스터마이즈 포인트**:
> ```markdown
> ## Communication Style
>
> - Respond in Korean by default. Use English for code/technical terms.
> - Casual tone (반말 OK). Formal only in client-facing docs.
> - When making recommendations, explain 2-3 options with trade-offs.
> ```

---

## 📌 Section 6: Infrastructure (Optional)

> **언제 포함?**: 팀이 클라우드 VM, 서버, 특수 환경을 사용할 때.
> 없으면 이 섹션 전체 삭제해도 된다.

**Azure VM 예시:**
```markdown
## Azure VM Environment

This workspace runs on `myteam-vm` (Azure, koreacentral).

- **VM Management Guide**: `azurevm/README.md`
- **Auth**: System Managed Identity (`az login --identity`)
- **Warning**: State changes (start/stop/resize) auto-logged to `azurevm/critical_change.md`
```

**AWS 예시:**
```markdown
## AWS Environment

This workspace runs on EC2 (`i-0abc123`, ap-northeast-2).

- **Access**: `aws sso login --profile myteam`
- **Resources**: see `docs/aws-resources.md`
```

**로컬 환경 예시:**
```markdown
## Environment

Runs locally on team members' machines.
- macOS (Apple Silicon) or Ubuntu 22.04
- Docker required for all services
```

---

## 📌 Section 7: Project Structure (Optional)

> **언제 포함?**: `projects/` 폴더를 클라이언트/프로젝트별 산출물에 쓸 때.

```markdown
## Projects (projects/)

Per-client or per-project outputs live here.

| Folder | Description |
|--------|-------------|
| `client-a/` | Client A deliverables |
| `client-b/` | Client B reports and analysis |

When creating project outputs:
- Work inside the relevant project folder
- Name files clearly: `2026-03-proposal.md` not `proposal_final_v2.md`
```

---

## 📌 Section 8: Cleanup Rhythm

```markdown
## Cleanup Rhythm

| Frequency | Action |
|---|---|
| **Weekly** | Scan notes/ → promote to decisions/ or docs/ |
| **Monthly** | Review docs/ — still accurate? |
| **Quarterly** | Update memory/MEMORY.md — reprioritize |
```

> **역할**: Claude가 정리 작업을 제안할 때 이 리듬을 기준으로 한다.
> **커스터마이즈**: 팀 sprint/retrospective 주기에 맞게 조정.

---

## 📌 Section 9: Warnings

```markdown
## Warnings

- Never commit .env, credentials, or secret files
- Never delete or modify files in decisions/ — create a new file instead
- When modifying this CLAUDE.md, note the reason in decisions/
```

> **역할**: Claude가 실수로 민감한 파일을 다루지 않도록 하는 안전장치.
> **추가 예시**:
> ```markdown
> - google-drive/ is a sync mirror — do not edit directly
> - notes/ older than 30 days should be reviewed, not auto-deleted
> ```

---

## 🔧 Quick Customization Checklist

새 workspace를 세팅할 때 이 체크리스트를 따른다:

- [ ] Section 1: 팀 이름 변경
- [ ] Section 3: 사용하는 폴더만 남기고 나머지 삭제
- [ ] Section 4: 세션 시작 시 읽어야 할 추가 파일 명시
- [ ] Section 5: 언어(KR/EN), 응답 톤 설정
- [ ] Section 6: 인프라 섹션 — Azure/AWS/로컬에 맞게 교체하거나 삭제
- [ ] Section 7: `projects/` 쓰면 포함, 안 쓰면 삭제
- [ ] Section 9: 팀 특화 주의사항 추가

---

## 📋 Minimal Template (Copy & Paste)

가장 단순한 버전. 여기서 시작해서 필요한 것만 추가.

```markdown
# My Team — Workspace

## Role
Team brain: decisions, docs, memos. Not a code project.

## Structure
- decisions/   immutable decision records (YYYY-MM-DD-title.md)
- docs/        process docs and guides
- notes/       temporary memos (YYYY-MM-DD.md)
- memory/      MEMORY.md — team context

## Agent Rules
1. Read memory/MEMORY.md at session start
2. Check decisions/ for prior art before working
3. Suggest recording decisions: "Want to log this in decisions/?"
4. decisions/ files are never deleted or modified

## Communication
- Respond in [Korean/English]
- Plain language, simple first
```
