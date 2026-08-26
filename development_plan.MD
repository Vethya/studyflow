# Development Plan

## Responsibility model
- **Primary:** accountable for implementation, tests, evidence, and completion.
- **Support:** reviews, tests, documents, and must understand the work.
- **Both:** divide the work approximately equally.
- Each student works 10 hours/week, giving 20 team person-hours/week.

## Capacity and milestones

| Stage | Working period | Internal freeze | Official milestone | Vethya | Mengheang | Team |
|---|---|---|---|---|---|---|
| 1. Requirements, design, prototype | Jul 20–Aug 12 | Aug 12 | Review 1: Aug 14 | 36h | 36h | 72h |
| 2. Core implementation | Aug 15–Sep 9 | Sep 9 | Review 2: Sep 11 | 40h | 40h | 80h |
| 3. Adaptive features and testing | Sep 12–Oct 7 | Oct 7 | Review 3: Oct 9 | 40h | 40h | 80h |
| 4. Corrections and documentation | Oct 10–25 | Oct 24 | Package: Oct 26 | 24h | 24h | 48h |
| 5. Presentation | Oct 26–30 | Oct 28 | Defence: Oct 30 | 6h | 6h | 12h |
| 6. Final submission | Oct 31–Nov 4 | Nov 4 | Submission: Nov 7 | 10h | 10h | 20h |
| **Total** | | | | **156h** | **156h** | **312h** |

## Regular weekly allocation

| Day | Time | Main purpose |
|---|---|---|
| Monday | 8–10 PM | Vethya backend work; Mengheang frontend work |
| Tuesday | 8–10 PM | Continue parallel implementation |
| Wednesday | 8–10 PM | API integration, code review, shared decisions |
| Saturday | 8–10 PM | Testing, defect correction, evaluation |
| Sunday | 8–10 PM | Integration, documentation, evidence, backup and rehearsal |

## Stage 1: Requirements, Design and Prototype
*July 20–August 12 — Review 1 on August 14*

### Requirements control: July 20–24

| Task | Primary | Support | Remark |
|---|---|---|---|
| Close Review 0 feedback using a response sheet | Both | — | Don’t think there were any feedback |
| Convert FR-01–FR-10 and NFR-01–NFR-06 into testable acceptance criteria | Both | — | [Link](https://docs.google.com/document/d/1QtsndAkWNsAwdkZSK6slGcHnzVRDF65cheA7ad40WoI/edit?usp=sharing) |
| Create the requirements traceability matrix | Mengheang | Vethya | |
| Create the weighted requirement-completion sheet | Both | — | [Link](https://docs.google.com/document/d/1fd_kap-PAtAqKhCr_H2bLZKhrIVgUfXje3Vmq1xWc7E/edit?usp=sharing) |
| Confirm terminology, scope, exclusions and ADRs | Both | — | [Link](https://docs.google.com/document/d/1yZDTNCwG-EetnE6HLevANBoWR3C5MWvXB3vqKXdOF6I/edit?usp=sharing) |
| Obtain supervisor approval for usability research and consent | Mengheang | Vethya | |
| Begin recruiting at least 5 representative students | Mengheang | Vethya | |

### System design: July 25–August 2

| Task | Primary | Support | Remark |
|---|---|---|---|
| Design system architecture and deployment diagrams | Vethya | Mengheang | [Link 1](https://drive.google.com/file/d/1t4PUqrKvL3iG4JtnYiaTtGAT5zsthSSP/view?usp=sharing)<br>[Link 2](https://drive.google.com/file/d/1DCuPgkaAzC1FocIVJFDEr1A40al_tKnk/view?usp=sharing) |
| Design ERD, schema and data dictionary | Vethya | Mengheang | |
| Define migration strategy | Vethya | Mengheang | |
| Design REST API and OpenAPI structure | Vethya | Mengheang | wait for uiux design |
| Design authentication, sessions, CSRF and rate limiting | Vethya | Mengheang | |
| Design cross-user ownership and 404 behavior | Vethya | Mengheang | |
| Model task, session, timer and revision states | Vethya | Mengheang | |
| Define UTC storage and IANA timezone behavior | Vethya | Mengheang | |
| Design CP-SAT constraints and fallback algorithm | Vethya | Mengheang | |
| Design adaptive-estimation qualification | Vethya | Mengheang | |
| Design chronological evaluation methodology | Vethya | Mengheang | |
| Create desktop and 360px wireframes | Mengheang | Vethya | |
| Design Calendar, Dashboard, Tasks, Availability, Progress and Settings | Mengheang | Vethya | |
| Update risk register | Both | — | |

### Working prototype: August 3–10

| Task | Primary | Support |
|---|---|---|
| Scaffold FastAPI, PostgreSQL, SQLAlchemy and Alembic | Vethya | Mengheang |
| Scaffold React, Vite and TypeScript | Mengheang | Vethya |
| Create Docker development environment | Vethya | Mengheang |
| Configure linting, type-checking and migration validation | Vethya | Mengheang |
| Configure frontend unit tests and Playwright | Mengheang | Vethya |
| Build account-access prototype | Vethya | Mengheang |
| Build availability and task API prototype | Vethya | Mengheang |
| Build prototype forms and result display | Mengheang | Vethya |
| Integrate account → availability → task → schedule proposal | Both | — |
| Add backend unit and API tests | Vethya | Mengheang |
| Add frontend and Playwright smoke tests | Mengheang | Vethya |
| Configure local Mailpit | Vethya | Mengheang |
| Begin Render, Neon, Resend and Google OAuth setup | Vethya | Mengheang |

### Review 1 preparation: August 11–12

| Deliverable | Primary | Support |
|---|---|---|
| Corrected proposal and feedback-response sheet | Both | — |
| Requirements and acceptance criteria | Mengheang | Vethya |
| Architecture, database, API and security documentation | Vethya | Mengheang |
| Wireframes and interface documentation | Mengheang | Vethya |
| Thesis Chapters 1–3 | Mengheang | Vethya |
| Thesis Chapter 4 and technical methodology | Vethya | Mengheang |
| Updated Gantt, risk register and contribution matrix | Both | — |
| Review slides | Mengheang | Vethya |
| Live prototype demonstration | Both | — |
| Review backup and rehearsal | Both | — |

## Stage 2: Core Implementation and Integration
*August 15–September 9 — Review 2 on September 11*

### Secure foundation: August 15–23

| Task | Primary | Support |
|---|---|---|
| Email/password registration | Vethya | Mengheang |
| Email verification and resend flow | Vethya | Mengheang |
| Password recovery and session revocation | Vethya | Mengheang |
| Argon2id hashing and breached-password validation | Vethya | Mengheang |
| Opaque server-managed sessions | Vethya | Mengheang |
| CSRF protection and authentication rate limits | Vethya | Mengheang |
| Active-device session management | Vethya | Mengheang |
| Cross-user authorization enforcement | Vethya | Mengheang |
| Account Settings API and timezone logic | Vethya | Mengheang |
| Account Settings interface | Mengheang | Vethya |
| Complete Academic Task API and business rules | Vethya | Mengheang |
| Task forms, filtering and management interface | Mengheang | Vethya |
| Deadline history and task deletion | Vethya | Mengheang |
| Availability and Unavailable Period APIs | Vethya | Mengheang |
| Availability-management interface | Mengheang | Vethya |
| Shared responsive navigation and forms | Mengheang | Vethya |

### Scheduling core: August 24–31

| Task | Primary | Support |
|---|---|---|
| Exact-minute session splitting | Vethya | Mengheang |
| Minimum/maximum rebalancing | Vethya | Mengheang |
| Minimum Break enforcement | Vethya | Mengheang |
| CP-SAT hard constraints | Vethya | Mengheang |
| Scheduling priorities and urgency policy | Vethya | Mengheang |
| Four-second solver limit | Vethya | Mengheang |
| Deterministic fallback algorithm | Vethya | Mengheang |
| Overload and exact-shortfall calculation | Vethya | Mengheang |
| Unscheduled Work handling | Vethya | Mengheang |
| Schedule proposal and acceptance API | Vethya | Mengheang |
| Initial immutable schedule versioning | Vethya | Mengheang |
| Weekly Calendar and Next 14 Days agenda | Mengheang | Vethya |
| Mobile day and scrollable agenda views | Mengheang | Vethya |
| Manual move/Edit Time interface | Mengheang | Vethya |
| Move and pin validation | Vethya | Mengheang |

### Integrated workflow: September 1–9

| Task | Primary | Support |
|---|---|---|
| Completed, Delayed and Missed outcome rules | Vethya | Mengheang |
| Awaiting Outcome behavior | Vethya | Mengheang |
| Outcome-entry interface | Mengheang | Vethya |
| Actual Duration and remaining-work calculations | Vethya | Mengheang |
| Initial Schedule Revision triggers | Vethya | Mengheang |
| Revision preview interface | Mengheang | Vethya |
| Dashboard attention states | Mengheang | Vethya |
| End-to-end integration workflows | Both | — |
| Backend unit and integration tests | Vethya | Mengheang |
| Frontend component and Playwright tests | Mengheang | Vethya |
| Input validation and error handling | Both | — |
| Initial deployment | Vethya | Mengheang |
| Pre-review backup | Both | — |
| Review 2 slides and demonstration | Both | — |
| Update thesis design and implementation sections | Both | — |

> [!IMPORTANT]
> Review 2 gate: 50–60% verified completion. A requirement counts only when implemented, integrated, tested and demonstrated.

## Stage 3: Remaining Features and Full Testing
*September 12–October 7 — Review 3 on October 9*

### Feature completion: September 12–20

| Task | Primary | Support |
|---|---|---|
| Complete all Schedule Revision triggers | Vethya | Mengheang |
| Atomic accept/reject behavior | Vethya | Mengheang |
| Invalid-session removal and Unscheduled Work | Vethya | Mengheang |
| Immutable schedule history | Vethya | Mengheang |
| Revision comparison interface | Mengheang | Vethya |
| Hybrid Study Timer API and persistence | Vethya | Mengheang |
| One active timer across devices | Vethya | Mengheang |
| Long-timer confirmation behavior | Vethya | Mengheang |
| Global timer interface | Mengheang | Vethya |
| Google OpenID Connect | Vethya | Mengheang |
| Password-confirmed Google account linking | Vethya | Mengheang |
| Task Finished Early | Vethya | Mengheang |
| Remaining outcome edge cases | Both | — |
| Correction-baseline estimation | Vethya | Mengheang |
| Qualification and MAE comparison | Vethya | Mengheang |
| Large-adjustment acknowledgment logic | Vethya | Mengheang |
| Ridge Regression qualification | Vethya | Mengheang |
| Continued qualification and fallback | Vethya | Mengheang |
| Adaptive-estimate explanations | Mengheang | Vethya |
| Effort Progress calculations | Vethya | Mengheang |
| Progress and estimate-comparison interface | Mengheang | Vethya |
| Aggregate MAE, bias and sample counts | Vethya | Mengheang |
| Complete all navigation pages | Mengheang | Vethya |
| Evaluation export command | Vethya | Mengheang |

> [!IMPORTANT]
> Core feature freeze: September 20.

### Testing and evaluation: September 21–October 4

| Task | Primary | Support |
|---|---|---|
| Backend unit and integration suite | Vethya | Mengheang |
| Frontend component and Playwright suite | Mengheang | Vethya |
| Full-system workflows | Both | — |
| Scheduling invariant and hard-constraint tests | Vethya | Mengheang |
| Cross-user isolation tests for every resource | Vethya | Mengheang |
| 50-task/250-session performance dataset | Vethya | Mengheang |
| Schedule-generation performance tests | Vethya | Mengheang |
| Twenty warm page-performance runs | Mengheang | Vethya |
| Feasible and overloaded scenario testing | Vethya | Mengheang |
| Solver timeout and failure testing | Vethya | Mengheang |
| Chrome, Edge and Safari compatibility | Mengheang | Vethya |
| Desktop, 360px and mobile testing | Mengheang | Vethya |
| Accessibility-quality checks | Mengheang | Vethya |
| Recruit and schedule usability participants | Mengheang | Vethya |
| Conduct usability sessions | Both — approx 5 participants each | — |
| Record success, assistance, time and errors | Both | — |
| Collect external SUS and trust feedback | Mengheang | Vethya |
| Analyze usability results | Mengheang | Vethya |
| Static-versus-adaptive technical evaluation | Vethya | Mengheang |
| Schedule-stability metric evaluation | Vethya | Mengheang |
| Security testing | Vethya | Mengheang |
| Defect log and correction evidence | Both | — |
| Backup and documented restore test | Vethya | Mengheang |

### Review 3 preparation: October 5–7

| Deliverable | Primary | Support |
|---|---|---|
| Stable 90–100% complete deployment | Both | — |
| Final traceability matrix | Mengheang | Vethya |
| Complete test plan and evidence | Both | — |
| User manual | Mengheang | Vethya |
| Technical/administrator manual | Vethya | Mengheang |
| Thesis Chapters 5–6 | Vethya | Mengheang |
| Thesis Chapters 7–9 | Mengheang | Vethya |
| References and appendices | Both | — |
| Draft final slides | Mengheang | Vethya |
| Complete live demonstration | Both | — |
| Review 3 correction plan | Both | — |
| Review backup | Both | — |

## Stage 4: Corrections, Evaluation and Documentation
*October 10–25 — Presentation package due October 26*

| Task | Primary | Support |
|---|---|---|
| Record and prioritize Review 3 feedback | Both | — |
| Correct backend and scheduling defects | Vethya | Mengheang |
| Correct frontend and usability defects | Mengheang | Vethya |
| Retest affected requirements | Both | — |
| Finalize technical-evaluation analysis | Vethya | Mengheang |
| Finalize usability analysis | Mengheang | Vethya |
| Complete thesis implementation chapter | Vethya | Mengheang |
| Complete thesis testing and evaluation chapter | Both | — |
| Complete results, discussion and limitations | Both | — |
| Verify every objective is evaluated | Both | — |
| Finalize README and deployment instructions | Vethya | Mengheang |
| Finalize user manual | Mengheang | Vethya |
| Finalize technical manual | Vethya | Mengheang |
| Finalize appendices and supporting evidence | Both | — |
| Check citations, references and licenses | Both | — |
| Verify Render, Neon and Resend | Vethya | Mengheang |
| Recheck deployment performance | Vethya | Mengheang |
| Create realistic demo data and accounts | Mengheang | Vethya |
| Produce screenshots | Mengheang | Vethya |
| Produce backup demonstration video | Both | — |
| Build the official submission folder structure | Both | — |
| Perform installation verification | Vethya | Mengheang |
| Freeze release and presentation package on October 24 | Both | — |
| Complete backup and final package check on October 25 | Both | — |

## Stage 5: Presentation and Demonstration
*October 26–30 — Final defence October 30*

| Task | Primary | Support |
|---|---|---|
| Submit the presentation package on October 26 | Both | — |
| Prepare slides in the handbook’s required order | Mengheang | Vethya |
| Prepare architecture and implementation explanation | Vethya | Mengheang |
| Prepare problem, evaluation and results explanation | Mengheang | Vethya |
| Prepare the fixed demonstration script | Both | — |
| Demonstrate successful scenarios | Both | — |
| Demonstrate validation and error scenarios | Both | — |
| Rehearse the 15-minute presentation | Both | — |
| Rehearse the 15-minute demonstration | Both | — |
| Prepare for individual viva questions | Both | — |
| Reset and verify demonstration data | Mengheang | Vethya |
| Pre-warm and verify deployment | Vethya | Mengheang |
| Test the presentation device and network | Both | — |
| Prepare offline backup, screenshots and video | Both | — |
| Confirm either student can continue the demo | Both | — |

## Stage 6: Final Corrections and Submission
*October 31–November 4 — Official deadline November 7*

> [!IMPORTANT]
> Treat November 4 as the internal deadline because November 5–6 are outside the agreed working schedule.

| Task | Primary | Support |
|---|---|---|
| Record final panel corrections | Both | — |
| Apply technical corrections | Vethya | Mengheang |
| Apply thesis and presentation corrections | Mengheang | Vethya |
| Ensure the thesis matches the demonstrated system | Both | — |
| Check originality and academic integrity | Both | — |
| Check citations and references | Mengheang | Vethya |
| Check secrets, private data and configuration | Vethya | Mengheang |
| Check third-party licenses and attribution | Both | — |
| Run final automated tests | Both | — |
| Perform a clean installation | Vethya | Mengheang |
| Verify responsive workflows | Mengheang | Vethya |
| Verify database, migrations and seed data | Vethya | Mengheang |
| Independently inspect the final package | Both | — |
| Create repository, cloud and offline backups | Both | — |
| Submit the project package | Both | — |
| Save proof of submission | Both | — |

## Continuous responsibilities

| Responsibility | Owner |
|---|---|
| Weekly progress log | Both update their own entries |
| Contribution matrix | Both |
| Risk register | Both |
| Requirements traceability | Mengheang primary; Vethya verifies technical links |
| Backend test evidence | Vethya |
| Frontend test evidence | Mengheang |
| Defect log | Both |
| Supervisor feedback sheet | Both |
| Pre-review backups | Both |
| Review-build archive/tag | Vethya primary; Mengheang verifies |
| Sunday integration and rehearsal | Both |
| Scope and exclusion control | Both |

## Critical dependency order

| Order | Work area | Primary |
|---|---|---|
| 1 | Security, sessions and ownership | Vethya |
| 2 | Tasks and availability | Vethya backend; Mengheang frontend |
| 3 | Session splitting | Vethya |
| 4 | Scheduling engine and Overload | Vethya |
| 5 | Calendar and schedule interaction | Mengheang |
| 6 | Schedule versions and revisions | Vethya backend; Mengheang frontend |
| 7 | Outcomes and Study Timer | Vethya backend; Mengheang frontend |
| 8 | Behavior history and adaptive estimation | Vethya |
| 9 | Progress and comparison interface | Mengheang |
| 10 | Testing, evaluation and thesis evidence | Both |
