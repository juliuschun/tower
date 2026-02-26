#!/usr/bin/env python3
"""
Auto-Humanize Script

Automatically finds trigger sentences and attempts to fix them by adding hedging.
Builds up text sentence by sentence, testing each addition.

Usage:
    python auto_humanize.py --file input.txt
    python auto_humanize.py --file input.txt --output humanized.txt
    python auto_humanize.py "Your text here"
"""

import argparse
import os
import re
import sys

try:
    from pangram import PangramText
except ImportError:
    print("Error: pangram package not installed. Run: pip install pangram-sdk", file=sys.stderr)
    sys.exit(1)


def get_client():
    api_key = os.environ.get("PANGRAM_API_KEY")
    if not api_key:
        print("Error: PANGRAM_API_KEY environment variable not set", file=sys.stderr)
        sys.exit(1)
    return PangramText(api_key=api_key)


def test_score(client, text):
    """Get AI fraction score for text"""
    if not text.strip():
        return 0.0
    try:
        result = client.predict(text)
        return result.get('fraction_ai', 0)
    except Exception as e:
        print(f"API Error: {e}", file=sys.stderr)
        return 1.0


def split_into_sentences(text):
    """Split text into sentences"""
    # Split on sentence endings, keeping the delimiter
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    return [s.strip() for s in sentences if s.strip()]


def try_fix_sentence(client, base_text, trigger_sentence):
    """
    Try various fixes for a trigger sentence.
    Returns (fixed_sentence, method) or (None, None) if unfixable.
    """
    fixes = [
        # Strategy 1: Add "I think" at end
        (trigger_sentence.rstrip('.?!') + ' I think.', 'hedge_end'),

        # Strategy 2: Add "I guess" at end
        (trigger_sentence.rstrip('.?!') + ' I guess.', 'hedge_guess'),

        # Strategy 3: Add "probably" after "is/are/was/were"
        (re.sub(r'\b(is|are|was|were)\b', r'\1 probably', trigger_sentence), 'hedge_probably'),

        # Strategy 4: Add "kinda" or "sort of"
        (re.sub(r'\b(is|are)\b', r'\1 kinda', trigger_sentence), 'hedge_kinda'),

        # Strategy 5: Make it a question
        (trigger_sentence.rstrip('.') + '?', 'question'),

        # Strategy 6: Add "maybe" at start
        ('Maybe ' + trigger_sentence[0].lower() + trigger_sentence[1:], 'hedge_maybe'),
    ]

    for fixed_sent, method in fixes:
        test_text = (base_text + ' ' + fixed_sent).strip()
        if test_score(client, test_text) < 0.5:
            return fixed_sent, method

    return None, None


def auto_humanize(text, verbose=True):
    """
    Automatically humanize text by finding and fixing trigger sentences.

    Returns:
        tuple: (humanized_text, stats_dict)
    """
    client = get_client()

    sentences = split_into_sentences(text)

    if verbose:
        print(f"Processing {len(sentences)} sentences...")
        print("=" * 60)

    passing_text = ''
    stats = {
        'total_sentences': len(sentences),
        'passed': 0,
        'fixed': 0,
        'skipped': 0,
        'triggers': [],
        'fixes': [],
    }

    for i, sent in enumerate(sentences):
        test_text = (passing_text + ' ' + sent).strip()
        score = test_score(client, test_text)
        words = len(test_text.split())

        if score < 0.5:
            # Sentence passes
            passing_text = test_text
            stats['passed'] += 1
            if verbose:
                print(f"✓ S{i+1} ({words}w): {score*100:.0f}% - \"{sent[:50]}{'...' if len(sent) > 50 else ''}\"")
        else:
            # Sentence triggers detection
            stats['triggers'].append(sent)
            if verbose:
                print(f"✗ S{i+1} ({words}w): {score*100:.0f}% - TRIGGER: \"{sent[:50]}{'...' if len(sent) > 50 else ''}\"")

            # Try to fix
            fixed_sent, method = try_fix_sentence(client, passing_text, sent)

            if fixed_sent:
                passing_text = (passing_text + ' ' + fixed_sent).strip()
                stats['fixed'] += 1
                stats['fixes'].append({'original': sent, 'fixed': fixed_sent, 'method': method})
                if verbose:
                    print(f"  → Fixed ({method}): \"{fixed_sent[:50]}{'...' if len(fixed_sent) > 50 else ''}\"")
            else:
                stats['skipped'] += 1
                if verbose:
                    print(f"  → Skipped (couldn't auto-fix)")

    # Final score
    final_score = test_score(client, passing_text)
    stats['final_score'] = final_score
    stats['final_words'] = len(passing_text.split())

    if verbose:
        print()
        print("=" * 60)
        print("RESULTS:")
        print("=" * 60)
        print(f"Words: {stats['final_words']}")
        print(f"Final Score: {final_score*100:.1f}% AI")
        print(f"Sentences: {stats['passed']} passed, {stats['fixed']} fixed, {stats['skipped']} skipped")
        print()

    return passing_text, stats


def main():
    parser = argparse.ArgumentParser(
        description="Automatically humanize text by finding and fixing trigger sentences"
    )
    parser.add_argument("text", nargs="?", help="Text to humanize")
    parser.add_argument("--file", "-f", help="Read text from file")
    parser.add_argument("--output", "-o", help="Write humanized text to file")
    parser.add_argument("--quiet", "-q", action="store_true", help="Suppress progress output")
    parser.add_argument("--stats", "-s", action="store_true", help="Show detailed stats at end")

    args = parser.parse_args()

    # Get input text
    if args.file:
        with open(args.file, 'r') as f:
            text = f.read()
    elif args.text:
        text = args.text
    else:
        parser.print_help()
        sys.exit(1)

    # Process
    humanized, stats = auto_humanize(text, verbose=not args.quiet)

    # Output
    if args.output:
        with open(args.output, 'w') as f:
            f.write(humanized)
        print(f"Written to: {args.output}")
    elif args.quiet:
        print(humanized)
    else:
        print("HUMANIZED TEXT:")
        print("-" * 60)
        print(humanized)

    if args.stats:
        print()
        print("DETAILED STATS:")
        print(f"  Triggers found: {len(stats['triggers'])}")
        for t in stats['triggers']:
            print(f"    - \"{t[:60]}...\"")
        print(f"  Fixes applied: {len(stats['fixes'])}")
        for fix in stats['fixes']:
            print(f"    - {fix['method']}: \"{fix['original'][:40]}...\"")


if __name__ == "__main__":
    main()
