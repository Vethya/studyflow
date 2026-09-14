# NFR-05 mobile Safari companion checklist

The automated NFR-05 suite covers Chrome, Edge, Playwright WebKit, mobile
Chrome emulation, responsive widths, axe checks, keyboard focus, labels,
contrast, and text/icon status cues. Playwright WebKit is not Apple Safari, so
this short run supplies the real mobile Safari evidence.

Record the following with the evidence report:

- iPhone model:
- iOS version:
- Safari version:
- Test date:
- Tested URL/commit:

## Checklist

- [ ] Open the app in Safari and confirm the initial page renders without an error.
- [ ] At the phone's portrait width, open Dashboard and confirm the main heading, capacity result, and task links are usable.
- [ ] Open Tasks; search, open filters, and open a task row.
- [ ] Open Calendar; confirm the mobile agenda/day layout is readable and can be scrolled.
- [ ] Open Availability; confirm the weekly view and add/edit controls are usable by touch.
- [ ] Open Settings; confirm account rows and dialogs fit the viewport.
- [ ] Rotate to landscape and confirm content remains usable without clipped controls.
- [ ] Capture screenshots of the Dashboard, Tasks, Calendar, Availability, and Settings views.
- [ ] Record any Safari-only issue in the evidence report rather than treating the automated WebKit result as proof of Safari behavior.
