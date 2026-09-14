# Remaining SPEC and requirements gaps

Status: 2026-09-14

This list compares the repository with [SPEC.md](../SPEC.md) and the thesis
requirements PDF. It counts the adaptive-estimation, deletion-recalculation,
and cross-user-isolation work in the stacked PRs as implemented, as agreed:

- [PR #2](https://github.com/Vethya/studyflow-dev/pull/2)
- [PR #6](https://github.com/Vethya/studyflow-dev/pull/6)
- [PR #9](https://github.com/Vethya/studyflow-dev/pull/9)

The merged backup/restore and Context-alignment work is also included.

## Completed gaps

### NFR-02 performance evidence — resolved

The full-stack evidence run passed against the warm dev deployment. The
recorded report contains 20 measured runs for the main pages and HTTP
endpoints, including feasible and overloaded schedule-generation scenarios:

[NFR-02 performance evidence — 2026-09-14](evidence/nfr02-performance-2026-09-14.md)

The measured page and schedule-generation p95 values are below their required
three-second and five-second limits.

### NFR-06 data inventory — resolved

The repository now contains the required inventory at
[docs/data-inventory.md](data-inventory.md). It covers persisted fields,
transient authentication inputs, evaluation export fields, retention, expiry,
deletion cascades, and the existing deletion and ownership evidence.

## Remaining gaps

### 2. NFR-04 usability evidence

No usability study report is committed.

The requirements call for at least five representative university students,
with at least four completing the main workflow without assistance. The report
should record participant characteristics, success or failure, assistance,
task time, errors, and external usability feedback such as SUS results.

### 3. NFR-05 compatibility and accessibility evidence

The frontend includes basic accessibility details such as visible focus styles,
but the repository has no browser test report covering:

- 360, 768, and 1440 CSS-pixel widths.
- Latest stable Chrome, Edge, and Safari.
- Mobile Chrome and Safari.
- Keyboard operation, labels, focus, contrast, and non-color status cues.

Formal WCAG 2.2 AA certification remains optional under the specification.

### 4. Acceptance criteria document drift

`Acceptance_Criteria.MD` does not match the current SPEC/PDF in two places:

- It still contains the superseded FR-10 progress/comparison requirement.
- Its performance profile says 100 tasks, 200 sessions, 50 concurrent users,
  and 100 measured runs. SPEC/PDF use one student, 50 active tasks, up to 250
  sessions, a 16-week horizon, 50 unavailable periods, and 20 warm runs.

The acceptance criteria should be reconciled before it is used as test evidence.

## Completion condition

The remaining work is evidence and documentation. Once the three remaining
items above are completed and `Acceptance_Criteria.MD` is aligned, the SPEC/PDF
gap review can be marked complete.
