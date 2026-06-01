# Tablet breakpoint plan (deferred)

The QA fleet flagged iPad as a "blocker" because the app shell is hard-clamped to `maxWidth: 430` in 5 different inline styles. On a 768×1024 iPad it renders as a 430px phone column floating in black void — looks broken.

## Why deferred

A proper fix is master-detail (list on left, detail on right, like Mail/Notes) — that's a 1-2 day rewrite of the navigation model. Not a one-line CSS change. TestFlight current users are 100% iPhone; iPad fix can wait until either:
- (a) we see iPad signups in PostHog warranting the work, or
- (b) the user explicitly prioritizes tablet readers

## When ready — recommended approach

1. **Media query at 768px** triggers a layout switch (no more `maxWidth: 430`)
2. **2-column master-detail** on tablet:
   - Left rail (320px): permanent search + categories nav
   - Right pane (flex): company detail full-screen
3. **Bottom nav becomes side nav** on tablet (vertical icons)
4. **Compare view becomes the killer iPad feature** — side-by-side instead of accordion
5. **Quiz / Paywall / Scanner** stay max-480 centered modals

## Approx effort

- Master-detail rewrite: 6-8 hours
- Visual polish: 2-4 hours
- Testing across iPad Mini / iPad Air / iPad Pro: 2 hours
- **Total: ~1.5 days**

## Files touched (estimate from current code)

- `src/App.jsx` lines 809, 1162, 3599, 3747, 3784 (maxWidth:430)
- `src/index.css` — add tablet breakpoint media query
- New: `src/layout/MasterDetail.jsx` for the tablet shell

## Minimum interim fix (not done yet)

Could ship a "best experienced on phone" banner on >900px viewports as a politeness measure, but that's just shame UX. Better to leave the 430 column visible and acknowledge tablet isn't optimized yet.
