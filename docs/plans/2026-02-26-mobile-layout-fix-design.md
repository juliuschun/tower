# Mobile Layout Fix — Design

**Date:** 2026-02-26
**Status:** Approved

## Problem

Mobile web app feels "loose" — the chat input box (`absolute bottom-[4.5rem]`) and MobileTabBar are 72px apart, creating a dead zone where messages are visible but obscured. When typing, this gap wastes screen real estate and hides messages.

```
[Messages scroll area]
[Input box]           ← absolute, bottom-[4.5rem] = 72px from content bottom
[  72px dead zone   ] ← messages visible but blocked
[MobileTabBar]        ← separate flex item in App.tsx
```

## Solution: ChatPanel Flex Layout

Replace absolute-positioned input with a proper flex column layout.

### Before

```tsx
// ChatPanel.tsx
<div className="flex flex-col h-full relative overflow-x-hidden">
  <div className="flex-1 overflow-y-auto pb-44">  {/* messages */}
  <div className="absolute left-0 right-0 bottom-[4.5rem]">  {/* input */}
</div>
```

### After

```tsx
// ChatPanel.tsx
<div className="flex flex-col h-full overflow-x-hidden">
  <div className="flex-1 overflow-y-auto pb-4">  {/* messages - minimal padding */}
  <div className="shrink-0 px-3 md:px-6 pb-2 md:pb-6">  {/* input - flex footer */}
</div>
```

## Changes

**File:** `frontend/src/components/chat/ChatPanel.tsx`

1. Remove `relative` from root div (no longer needed for absolute child)
2. Change input container from `absolute bottom-[4.5rem]/bottom-6` to `shrink-0` flex item
3. Reduce messages padding from `pb-44`/`pb-32` to `pb-4` (no longer need space for floating input)
4. Remove `isMobile` conditional from input positioning (flex handles both)

## Result

```
[Messages scroll area]  ← flex-1, scrollable
[Input box]              ← shrink-0, flush to bottom
[MobileTabBar]           ← App.tsx, no gap
```

Zero gap between input and tab bar. Messages fill available space naturally. Keyboard behavior handled by flex layout without magic numbers.
