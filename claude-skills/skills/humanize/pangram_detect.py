#!/usr/bin/env python3
"""
Pangram AI Detection Script

Uses the Pangram API to detect AI-generated content in text.
Requires PANGRAM_API_KEY environment variable to be set.

Usage:
    python pangram_detect.py "text to analyze"
    python pangram_detect.py --file path/to/file.txt
    echo "text" | python pangram_detect.py --stdin
"""

import argparse
import json
import os
import sys

try:
    from pangram import PangramText
except ImportError:
    print("Error: pangram package not installed. Run: pip install pangram-sdk", file=sys.stderr)
    sys.exit(1)


def detect_ai_content(text: str) -> dict:
    """
    Analyze text for AI-generated content using Pangram API.

    Returns dict with:
        - ai_fraction: float 0-1 indicating AI content percentage
        - ai_detected: bool if AI content was found
        - segments: list of flagged segments with scores
        - raw_response: full API response
    """
    api_key = os.environ.get("PANGRAM_API_KEY")
    if not api_key:
        return {
            "error": "PANGRAM_API_KEY environment variable not set",
            "ai_detected": None
        }

    try:
        client = PangramText(api_key=api_key)

        # Use predict for detailed analysis (v3 API)
        result = client.predict(text)

        # Parse the response (API returns a dict)
        ai_fraction = result.get('fraction_ai', 0) or 0

        # Extract segment-level information if available
        segments = []
        windows = result.get('windows', [])
        if windows:
            for window in windows:
                segments.append({
                    "text": window.get('text', ''),
                    "score": window.get('ai_assistance_score', 0),
                    "label": window.get('label', 'unknown'),
                    "confidence": window.get('confidence', 'unknown'),
                    "word_count": window.get('word_count', 0)
                })

        return {
            "ai_fraction": ai_fraction,
            "ai_detected": ai_fraction > 0.3,
            "ai_percentage": round(ai_fraction * 100, 1),
            "segments": segments,
            "classification": result.get('prediction_short', 'unknown'),
            "headline": result.get('headline', ''),
            "prediction": result.get('prediction', ''),
            "num_ai_segments": result.get('num_ai_segments', 0),
            "num_human_segments": result.get('num_human_segments', 0)
        }

    except Exception as e:
        return {
            "error": str(e),
            "ai_detected": None
        }


def detect_short(text: str) -> dict:
    """
    Quick AI detection for short texts (up to 512 tokens).
    Returns a simple score from 0 (human) to 1 (AI).
    """
    api_key = os.environ.get("PANGRAM_API_KEY")
    if not api_key:
        return {
            "error": "PANGRAM_API_KEY environment variable not set",
            "score": None
        }

    try:
        client = PangramText(api_key=api_key)
        result = client.predict_short(text)

        # v3 API returns ai_likelihood field
        score = result.get('ai_likelihood', 0) or 0

        return {
            "score": score,
            "ai_detected": score > 0.5,
            "ai_percentage": round(score * 100, 1),
            "classification": "AI" if score > 0.5 else "Human"
        }

    except Exception as e:
        return {
            "error": str(e),
            "score": None
        }


def main():
    parser = argparse.ArgumentParser(
        description="Detect AI-generated content using Pangram API"
    )
    parser.add_argument("text", nargs="?", help="Text to analyze")
    parser.add_argument("--file", "-f", help="Read text from file")
    parser.add_argument("--stdin", action="store_true", help="Read text from stdin")
    parser.add_argument("--short", "-s", action="store_true",
                        help="Use quick detection model (less aggressive, different results)")
    parser.add_argument("--both", "-b", action="store_true",
                        help="Run both detection models and compare results")
    parser.add_argument("--json", "-j", action="store_true",
                        help="Output raw JSON response")
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="Show full segment text for problem areas")
    parser.add_argument("--flagged", action="store_true",
                        help="Show only AI-labeled windows that need rewriting")

    args = parser.parse_args()

    # Get text from appropriate source
    if args.stdin:
        text = sys.stdin.read().strip()
    elif args.file:
        with open(args.file, 'r') as f:
            text = f.read().strip()
    elif args.text:
        text = args.text
    else:
        parser.print_help()
        sys.exit(1)

    if not text:
        print("Error: No text provided", file=sys.stderr)
        sys.exit(1)

    # Run detection
    if args.both:
        result_full = detect_ai_content(text)
        result_short = detect_short(text)
        print("=" * 50)
        print("COMPARISON: Two Detection Models")
        print("=" * 50)
        print(f"\nFULL MODEL (predict):")
        print(f"  AI Percentage: {result_full.get('ai_percentage', 'N/A')}%")
        print(f"  Classification: {result_full.get('classification', 'Unknown')}")
        if result_full.get('headline'):
            print(f"  Verdict: {result_full['headline']}")
        print(f"\nSHORT MODEL (predict_short):")
        print(f"  AI Percentage: {result_short.get('ai_percentage', 'N/A')}%")
        print(f"  Classification: {result_short.get('classification', 'Unknown')}")
        print("\n" + "=" * 50)
        print("NOTE: These models often give very different results.")
        print("The full model is more aggressive on formal writing.")
        print("=" * 50)
        return
    elif args.short:
        result = detect_short(text)
    else:
        result = detect_ai_content(text)

    # Output results
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        if "error" in result:
            print(f"Error: {result['error']}", file=sys.stderr)
            sys.exit(1)

        print(f"AI Detection Results:")
        print(f"  AI Percentage: {result.get('ai_percentage', 'N/A')}%")
        print(f"  Classification: {result.get('classification', 'Unknown')}")

        if result.get('headline'):
            print(f"  Verdict: {result['headline']}")

        if result.get('prediction'):
            print(f"  Details: {result['prediction']}")

        ai_segs = result.get('num_ai_segments', 0)
        human_segs = result.get('num_human_segments', 0)
        print(f"  Segments: {ai_segs} AI, {human_segs} Human")

        if 'segments' in result and result['segments']:
            segments = result['segments']

            # Filter to only AI-labeled windows if --flagged
            if args.flagged:
                ai_segments = [(i, seg) for i, seg in enumerate(segments, 1)
                               if 'AI' in seg.get('label', '').upper()]
                if not ai_segments:
                    print(f"\n  ✓ No AI-labeled windows found. All windows pass!")
                else:
                    print(f"\n  Windows to Rewrite ({len(ai_segments)} of {len(segments)}):")
                    for i, seg in ai_segments:
                        score = seg.get('score', 0)
                        words = seg.get('word_count', 0)
                        text = seg.get('text', '')
                        print(f"\n  🔴 Window {i}: {score*100:.1f}% AI ({words} words)")
                        print(f"  --- REWRITE THIS TEXT ---")
                        print(f"  {text}")
                        print(f"  --- END ---")
            else:
                print(f"\n  Segment Breakdown:")
                for i, seg in enumerate(segments, 1):
                    score = seg.get('score', 0)
                    label = seg.get('label', 'unknown')
                    confidence = seg.get('confidence', 'unknown')
                    words = seg.get('word_count', 0)
                    text = seg.get('text', '')

                    # Flag high-scoring segments
                    flag = "🔴" if score > 0.8 else "🟡" if score > 0.5 else "🟢"
                    print(f"    {flag} Segment {i}: {score*100:.1f}% AI, label={label} ({confidence}, {words} words)")

                    if args.verbose and score > 0.7:
                        print(f"\n    --- PROBLEM TEXT (rewrite this) ---")
                        print(f"    {text}")
                        print(f"    --- END ---\n")
                    else:
                        text_preview = text[:60] + '...' if len(text) > 60 else text
                        print(f"       \"{text_preview}\"")


if __name__ == "__main__":
    main()
