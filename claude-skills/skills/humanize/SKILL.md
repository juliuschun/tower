---
name: humanize-text
description: Rewrite AI-generated text to reduce AI detection scores using Pangram API for feedback. Use when you want to make writing less detectable as AI, humanize text, or reduce AI detection scores.
allowed-tools: Read, Write, Edit, Bash, Glob
---

# Humanize Text Skill

This skill rewrites AI-generated text iteratively, using Pangram API feedback to identify and rewrite the most AI-detectable segments.

## Requirements

1. **Pangram API Key**: Set `PANGRAM_API_KEY` environment variable
2. **Pangram Package**: Install with `pip install pangram-sdk`

```bash
export PANGRAM_API_KEY="your-api-key-here"
pip install pangram-sdk
```

## Critical: Pangram Has Two Different Detection Models

**Pangram's API has two detection methods that give completely different results on the same text:**

| Model | Method | Behavior |
|-------|--------|----------|
| **Full** (`predict`) | Detailed segment analysis | Extremely aggressive on formal writing - flags almost all polished prose as AI |
| **Short** (`predict_short`) | Quick classification | Much more lenient - often classifies the same formal text as human |

**Example on the same formal essay:**
```
FULL MODEL:  100% AI, "Fully AI Generated"
SHORT MODEL: 0% AI, "Human"
```

**Key insight:** The full model detects **aggregate patterns across the entire document**, not individual sentences or phrases:
- Individual sentences pass (0% AI)
- Individual paragraphs pass (0% AI)
- Combined paragraphs fail (100% AI)

This means window-based surgical editing has **limited effectiveness** for the full model.

**Ask the user which detection standard matters to them:**

1. **Must pass full model**: Requires structural changes AND staying under ~180 words (see limitations below)
2. **Must pass short model**: Most casual rewrites already pass
3. **Informational only**: User wants to see both scores for awareness

## Critical: Full Model Word Count Threshold

**The full model has a hard threshold around ~180 words.** Beyond this, structured technical content triggers detection regardless of casual tone or humanization techniques applied.

| Word Count | Typical Result |
|------------|----------------|
| < 150 words | Usually passes with light humanization |
| 150-180 words | May pass with careful construction |
| > 180 words | Almost always fails, even with heavy casualization |

**Testing confirmed:**
- 179 words with casual tone: 0% AI
- 180 words (same text + one word): 100% AI
- 198 words with heavy casualization: 100% AI

**Implication:** For documents over ~180 words that must pass the full model, you may need to split into multiple shorter pieces or accept that passing is not achievable.

## How It Works: Debugging with Granular Testing

Since the full model detects aggregate patterns (not individual windows), the most effective approach is **granular testing** to find specific triggers:

### Core Debugging Workflow

```
1. Test each PARAGRAPH separately with predict()
   → Find which paragraphs fail individually

2. For failing paragraphs, test SENTENCES progressively
   → Add sentences one at a time until it fails
   → Identify the specific trigger sentence

3. Test VARIATIONS of the trigger sentence
   → Try hedging ("I think", "I guess", "probably")
   → Try simpler phrasing
   → Try breaking into shorter sentences

4. Rebuild with fixed sentences
   → Re-test the full paragraph
   → Watch for new triggers that emerge

5. Test PARAGRAPH COMBINATIONS
   → Paragraphs may pass alone but fail combined
   → This reveals aggregate pattern detection
```

### Example: Finding Triggers

```python
# Test paragraphs individually
Para 1: 0% AI ✓
Para 2: 0% AI ✓
Para 3: 0% AI ✓

# Test combinations
Para 1+2: 0% AI ✓
Para 2+3: 100% AI ✗  ← Combination triggers detection

# Test Para 2+3 sentence by sentence
S1: 0%
S1+S2: 0%
S1+S2+S3: 100% ← S3 is the trigger
```

**Key insight:** Even when individual components pass, combinations may fail due to aggregate pattern detection.

## Usage

### Step 1: Run Detection with JSON Output

```bash
python .claude/skills/humanize-text/pangram_detect.py --file path/to/text.txt --json
```

This returns structured data with each window's text and label:

```json
{
  "segments": [
    {"text": "First paragraph...", "label": "Human", "score": 0.15},
    {"text": "Second paragraph...", "label": "AI", "score": 0.92},
    {"text": "Third paragraph...", "label": "Mixed", "score": 0.55}
  ]
}
```

Or use `--verbose` for human-readable output showing problem windows.

### Step 2: Extract AI-Labeled Windows

From the detection results, identify windows where `label == "AI"`:

```
Window 2: "Second paragraph..." → label: AI, score: 92%
```

**Only these windows need rewriting.** Windows labeled "Human" are already passing—don't touch them.

### Step 3: Rewrite Only the Flagged Windows

Take the exact text from each AI-labeled window and rewrite it using humanization techniques. Apply techniques proportional to the score:

- **Score 90%+**: Apply aggressive techniques (fragments, missing apostrophes, tangents)
- **Score 70-90%**: Apply moderate techniques (first-person, rhetorical questions)
- **Score 50-70%**: Apply light touches (varied sentence length, specific examples)

**Humanization Techniques Reference:**

Based on testing, here's what actually works:

| Technique | Example | Actually Works? | Notes |
|-----------|---------|-----------------|-------|
| **Structural changes** | More, shorter paragraphs | ✅ Yes | 5 short paras > 3 long paras |
| **Simpler sentences** | Break complex → simple | ✅ Yes | Most effective technique |
| **Personal admissions** | "I feel dumb", "Still dont get it" | ✅ Yes | Genuine uncertainty helps |
| **Hedging (local)** | "I think", "I guess", "probably" | ⚠️ Partial | Fixes specific triggers, not global |
| **Missing apostrophes** | "thats", "dont" | ❌ No | Alone doesn't help |
| **Em-dash removal** | Replace — with . or , | ❌ No | No measurable impact |
| **Meta-commentary** | "Sorry if this is rambly" | ❌ No | Can actually trigger detection |
| **Single-word emphasis** | "Billions." | ❌ Harmful | Often triggers detection |

**What actually passes the full model:**
```
❌ FAILS: "This is why GPUs exist in their current form—turns out graphics
         cards are accidentally perfect for parallel matrix ops."

✅ PASSES: "GPUs are basically made for this. Graphics cards handle
          parallel matrix ops really well."
```

**Key pattern:** Simpler, shorter, less "polished" writing passes. The detector flags sophisticated sentence construction, not casual language per se.

### Step 4: Replace in Original Document

Use the Edit tool to replace the original window text with the rewritten version. Keep everything else unchanged.

Example:
```
Original window: "The implementation of algorithms requires careful consideration..."
Rewritten:       "Look, you cant just implement algorithms without thinking it through..."

→ Replace only this section in the document
```

### Step 5: Re-detect and Iterate

Run detection again on the full updated document:

```bash
python .claude/skills/humanize-text/pangram_detect.py --file revised.txt --json
```

Check the previously-flagged windows:
- If now "Human" or "Mixed" → Success, move on
- If still "AI" → Apply more aggressive techniques to that specific window

Repeat until:
- All windows pass (label != "AI")
- Or user accepts the current tradeoff

### Step 6: Present Results

Show the user:
1. **Original vs Final scores** (overall and per-window)
2. **Which specific windows were rewritten** (with before/after)
3. **Windows that remain flagged** (if any) and why they're resistant
4. **Style tradeoffs made** (casual vs formal techniques used)

## Example: Window-Based Targeting in Action

**Initial Detection (3 windows):**
```
Window 1: "Human" (12% AI) ✓ Leave alone
Window 2: "AI" (94% AI)    ← Target this
Window 3: "Mixed" (48% AI) ✓ Leave alone
```

**Window 2 Original Text:**
> The implementation of machine learning algorithms requires careful consideration of various factors including data preprocessing, feature selection, and model optimization. These components work together synergistically to produce optimal results.

**Window 2 Rewritten:**
> Look, you cant just throw an ML algorithm at a problem and expect magic. Theres a whole mess of prep work—cleaning your data (which takes forever, trust me), figuring out which features actually matter, and then the optimization rabbit hole. Skip any of that and the whole thing falls apart.

**After Re-detection:**
```
Window 1: "Human" (12% AI) ✓ Unchanged
Window 2: "Human" (22% AI) ✓ Now passing!
Window 3: "Mixed" (48% AI) ✓ Unchanged
Overall: 27% AI (was 51%)
```

**Key insight:** We only touched Window 2. Windows 1 and 3 were already acceptable and stayed untouched.

## Style Spectrum Examples

**Same flagged window, different style choices:**

| Target Style | Rewrite | Expected Score |
|--------------|---------|----------------|
| Very Casual | "So heres the thing—ML is way harder than tutorials make it look. Data cleaning alone takes forever." | ~15% AI |
| Conversational | "Here's what tutorials don't tell you: ML projects live or die on the prep work. I've seen teams skip data cleaning and regret it." | ~35% AI |
| Professional | "Building effective ML systems requires more than algorithm selection. The preparatory work—data cleaning, feature engineering—often determines success." | ~70% AI |

## Troubleshooting

**Dense academic prose fails even at sentence level:**
Some formal writing is so "AI-like" that even individual sentences trigger 100% AI detection. Hedging strategies won't work. This requires **complete rewrite** in casual style:

```
❌ UNFIXABLE (each sentence 100% AI):
"Contemporary software engineering presents practitioners with an
unprecedented abundance of technological options."

✅ COMPLETE REWRITE REQUIRED:
"Ok so web dev has way too many options now and its actually a problem."
```

The `auto_humanize.py` script will skip all sentences and produce empty output in these cases. You must manually rewrite in casual voice.

**Document over 180 words fails no matter what:**
This is a fundamental limitation of the full model. Options:
1. Accept that passing full model isn't achievable at this length
2. Split into multiple shorter documents (each under 180 words)
3. Target short model only (much more lenient)

**Individual paragraphs pass but combined document fails:**
This is aggregate pattern detection. The detector sees patterns across the full document that aren't visible in individual parts. Solutions:
- Reduce total word count to under 180
- Increase structural variation between paragraphs
- Add more "imperfect" elements throughout

**A specific sentence keeps triggering detection:**
Use progressive testing to find the trigger:
```python
# Add sentences one at a time
S1: 0%
S1+S2: 0%
S1+S2+S3: 100% ← S3 is the trigger
```
Then test variations of S3:
- Simpler phrasing (most effective)
- Add hedging ("I think", "I guess")
- Break into two shorter sentences

**Common trigger patterns identified:**
- Single-word emphatic sentences: "Billions." "Wild."
- Complex constructions: "This is why X exist in their current form—"
- Smooth transitions: "Furthermore," "Additionally,"
- Parallel lists: "X, Y, and Z patterns"
- Aphoristic statements: "More tools means less mastery" (but "Too many tools not enough time" passes)
- Academic vocabulary: "unprecedented," "proliferation," "manifests"

**Semantically similar phrases can have opposite results:**
```
❌ "More tools means less mastery." → 100% AI
✅ "Too many tools not enough time." → 0% AI
```
The detector appears sensitive to certain phrase structures, not just meaning. When one phrasing fails, try alternatives.

**The short model passes but full model fails:**
This is expected for most technical content. The full model is much more aggressive. Options:
1. If short model passing is sufficient, you're done
2. If full model must pass, you likely need to stay under 180 words AND simplify structure
3. Accept the tradeoff: quality writing that's detected vs. degraded writing that passes

## Script Options

### Detection Script (pangram_detect.py)

```bash
# Full model detection (aggressive)
python pangram_detect.py --file path/to/text.txt

# Short model detection (lenient)
python pangram_detect.py --short --file path/to/text.txt

# Compare BOTH models side-by-side
python pangram_detect.py --both --file path/to/text.txt

# Show ONLY AI-labeled windows that need rewriting
python pangram_detect.py --file text.txt --flagged

# Show all segments with full text for problem areas
python pangram_detect.py --file text.txt --verbose

# JSON output for parsing
python pangram_detect.py --file text.txt --json
```

### Auto-Humanize Script (auto_humanize.py)

Automatically finds trigger sentences and attempts to fix them by adding hedging phrases.

```bash
# Auto-humanize a file
python auto_humanize.py --file input.txt

# Save output to file
python auto_humanize.py --file input.txt --output humanized.txt

# Quiet mode (just output the text)
python auto_humanize.py --file input.txt --quiet

# Show detailed stats about triggers and fixes
python auto_humanize.py --file input.txt --stats
```

**How it works:**
1. Splits text into sentences
2. Tests each sentence addition against the full model
3. When a trigger is found, tries multiple fix strategies:
   - Add "I think" at end
   - Add "I guess" at end
   - Add "probably" after is/are/was/were
   - Add "kinda" after is/are
   - Convert to question
   - Add "Maybe" at start
4. If a fix works, uses it; otherwise skips the sentence
5. Returns the humanized text and stats

**Example output:**
```
✓ S1 (7w): 0% - "So heres something that blew my mind...."
✓ S2 (16w): 0% - "Human psychology isnt special...."
✗ S3 (25w): 100% - TRIGGER: "Whatever helps you reproduce..."
  → Fixed (hedge_end): "Whatever helps you reproduce I think...."
```

**Recommended workflow:**
1. Start with `--both` to see how both models score the text
2. If short model passes and that's sufficient, done
3. If full model must pass, try `auto_humanize.py` first for automatic fixes
4. For remaining issues, use manual debugging with `pangram_detect.py --flagged`

## Important Notes

- **The goal is informed choice, not just evasion.** Help users understand the tradeoff between detection scores and writing quality.
- Pangram's detector is specifically trained to catch formal AI writing patterns.
- Casual markers (missing punctuation, tangents, fragments) are highly effective at evasion but may be inappropriate for professional contexts.
- Always preserve the original meaning and accuracy of content.
- Some use cases (academic papers, professional reports) may be better served by high-quality detected text than low-quality undetected text.

## Real Example: Essay That Passes Full Model (0% AI)

This 179-word essay passes both the full model (0% AI) and short model (0% AI):

```
So I finally figured out what deep learning actually is and I feel dumb for
not getting it sooner. Its matmuls. Matrix multiplications. Thats literally
the whole thing.

Like every neural net layer is just: multiply weights with inputs, add
nonlinearity, repeat. Transformers do this. CNNs do this. Everything does
this. I spent years thinking there was more to it.

GPUs are good at matmuls. Someone noticed this and now we have a whole
industry. Nvidia makes tensor cores. Google made TPUs. All to multiply
matrices faster. Kind of hilarious when you think about it.

The training part has some gotchas. Gradients can vanish or explode when you
stack too many matmuls. Thats why resnets exist. Layer norm too. Also trained
weights usually end up low rank for some reason? Still dont fully understand
that one.

Point is: matmuls arent implementation details. Theyre the whole game. A
friend told me this years ago and I didnt believe them. Now I see matmuls
everywhere. Attention is also matmuls basically. My roommate says Im obsessed
with this now. Anyway thats it.
```

**Why it works:**
- 179 words (just under the ~180 threshold)
- 5 short paragraphs instead of 3 long ones
- Simple sentence structure throughout
- Personal admissions ("I feel dumb", "Still dont fully understand")
- No complex constructions or smooth transitions
- Missing apostrophes (though these alone don't help)
