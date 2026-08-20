---
name: Client complaint versus CRM scope audit
description: Durable rules and the detailed classification of the client complaint PDF against the original CRM scope workbook
---

## Durable audit rules

The client's PDF is the authoritative complaint record. The Gemini-generated text summary is only an interpretation and must not be treated as the source of truth.

The XLSX workbook is the original agreed CRM scope. Every complaint must be compared against that workbook before being called a bug or feature creep.

Use these classifications:

- **Confirmed defect:** current source directly demonstrates the problem.
- **SOW bug candidate — reproduce:** the requirement is in the original scope and the client reports failure, but a current logged-in test is still required.
- **Already addressed in current source:** the development source contains the requested behavior; production still needs verification.
- **Change request / feature creep:** the request is absent from the original scope or materially expands it.
- **Scope conflict:** the request contradicts an original requirement.

The real CRM implementation is the root `client/` and `server/` code. Do not use the separate scaffold artifact as evidence about the CRM.

Do not claim a production defect from static source alone. The current development workflows can establish that the app starts, but user-role and production behavior require a controlled browser/API test.

## Key findings preserved from the audit

- The strongest source-confirmed defect is authentication refresh: `server/src/routes/auth.ts` returns a refresh token, but `client/src/pages/Login.tsx` stores only the access token and `client/src/lib/api.ts` logs out on 401 without refreshing.
- Current source already contains substantial later fixes for filters/Expected OB Date, status views, controlled DQL/PR/PD skipping, task attachments, direct inactive handling, checklists, NPS data, and dashboard drill-down scaffolding. The PDF may reflect an earlier build; verify before reporting these as still broken.
- The original SOW explicitly covers lead management, pipeline/stages, calls, follow-up tasks, meetings/MOM, quote integration, email automation, SLA alerts, activity timeline, dashboards, and reports.
- The original SOW does not explicitly cover FYX rebranding, global internal/external notification controls, broad file/attachment management, project-team primary-designer rules, incentive engines, medals, forecasts, manual project flags, task activity locks, or the exact new funnel denominator.
- Removing Intent Rating conflicts with original scope row 1.7, which explicitly requires lead intent.
- Removing follow-up tasks conflicts with original scope rows 3.4–3.6, which require follow-up tasks after calls and reminder/manager handling.

## Full complaint-to-scope audit

| Complaint group from PDF | Original scope | Classification |
|---|---|---|
| Replace logo, CRM text, and login wording with FYX | No branding requirement | Change request / feature creep |
| Logout every 15–20 minutes while active | No explicit session-duration requirement | Confirmed defect in current source; exact timing still needs reproduction |
| Rename the gate prompt to FYX wording | Pipeline gates are in scope; exact copy is not | Change request |
| Make On Hold/Inactive views match Active | Scope 2.4–2.6 | Already addressed in current source; verify visually |
| New-lead unread counter | No unread-counter requirement | Change request |
| Lead and Sales Pipeline filters match; Expected OB Date; filter headings/flow | Scope 2.7–2.8 and report filters 14.14 | Core behavior already exists in current source; visual parity requires reproduction |
| Replace Designer filter with Lead Origin Date | Scope explicitly includes Designer filtering | Scope conflict |
| Date-wise notifications for calls, meetings, tasks, SLA | Scope 3.4–3.6 and 9.1–9.7 | SOW bug candidate — reproduce |
| Remove Intent Rating and replace it with stage-days/TAT/budget | Scope 1.7 explicitly requires intent; aging/SLA are adjacent scope | Scope conflict plus change request |
| Auto-update intent at every stage movement | Intent is in scope, automatic stage-scoring rules are not | Change request |
| Latest quote not reflected | Scope 5.3 and 5.5 | SOW bug candidate — reproduce |
| Country-specific phone validation | Phone capture is in scope; international rules are not | Change request |
| Rename Move-in Date to Expected Interiors Handover Date | Possession timeline is in scope | Copy change / partial scope extension |
| Skip DQL, PR, and PD while retaining skipped requirements | Current stage-gate source explicitly supports these skips | Already addressed in current source; test actual transitions |
| PP→OB fails because PD files/checklist are unavailable | Pipeline/gates are in scope; exact Files-tab design is not | SOW bug candidate for current transition; later file-module scope for the UI |
| OB checklist meeting not reflected in Meetings tab | Meeting workflow scope 4.1–4.8 | SOW bug candidate — reproduce |
| OB checklist only updates after refresh | Checklist is later than the base SOW; meeting state is in scope | Later-module bug candidate — reproduce |
| OB→OBM client-confirmation checkbox and quote-gate changes | Exact OBM gate policy is not in original SOW | Change request |
| Welcome-mail attachment behavior | Email automation is in scope; specific attachment rules are not | Change request / separate mail defect if approved |
| OBM→DIP screenshot and detailed DIP checklist | NPS/post-onboarding controls are mentioned, exact screenshot/checklist is not | Partial scope change |
| DIP cannot be reached after gates are complete | DIP/post-onboarding completion is mentioned in SOW comments | SOW bug candidate — reproduce |
| Add project team members and one Primary designer | Lead assignment and roles are in scope; project membership is not | Change request |
| Display NPS beside lead and distinguish it from intent | NPS is mentioned in post-onboarding comments, not as a full display/reporting module | Partial scope change |
| Roadmap text is clipped | Visual pipeline is in scope | SOW bug candidate — reproduce |
| Unified newest-first activity feed with actor/timestamp | Scope 11.1–11.3 | SOW bug candidate — reproduce |
| Internal-notes chat box | Free-text notes are in scope; chat is not | Change request |
| Schedule Call with date/time/type/agenda/notification choice | Calls and follow-up timing are scope 3.1–3.6 | SOW bug candidate for call basics; notification model is a change request |
| Separate Internal/External Notes and send only external notes | Notes and client communication are in scope; this two-channel model is not | Change request |
| Remove Follow-up Task entirely | Scope 3.4–3.6 requires follow-up tasks | Scope conflict |
| Task counters, assignment, reschedule details, reason/agenda labels | Follow-up handling is in scope, exact UX is not | Partial scope change; current source already has task/reschedule/attachment support |
| Lock all lead activity until overdue task is resolved | No activity-lock requirement | Change request |
| New tasks missing from activity feed | Timeline scope 11.1; task inclusion is a reasonable extension | SOW bug candidate — reproduce |
| Rename PD to Pitch Discussion and change attachment categories | Exact labels/categories not in SOW | Change request |
| Meeting mode/location missing or not dropdown | Meeting modes are scope 4.3 | SOW bug candidate — reproduce |
| Floor-plan sync into Files tab | No explicit central Files/floor-plan-sync requirement | Later-module bug candidate / change request |
| Multiple attachments across tabs | No broad all-tabs attachment requirement | Change request; some current components already support multiple files |
| Direct Mark Inactive from On Hold; reasons and notes | Inactive/On Hold and mandatory reason are scope 2.5–2.6 | Direct action already exists in source; detailed reason taxonomy is a change request |
| Mandatory client email/SMS on inactivity/reactivation | Inactivation mail/SMS appears in scope comments; reactivation policy does not | SOW bug candidate for inactivation; change request for reactivation |
| Restrict representative to own PID quote | Designer ownership and quote builder are adjacent scope | Security bug candidate — reproduce; exact cross-system PID rule needs approval |
| Prefill PID/name/project details in quote software | Lead ID prefill is scope 5.2; all detail prefill is broader | Partial scope change |
| Global Internal/External notification checkbox | Specific email/WhatsApp automations are scope; global delivery control is not | Change request |
| Designer edits every email; management edits all templates | Scope 8.4 allows preview/editing for selected email types | Change request beyond original preview requirement |
| Tuesday/week-start/day-start/one-hour reminders | Due reminders are scope; this exact schedule is not | Partial scope change |
| Calendar/clock controls, calendar views, wrong dates | Scheduled dates are scope; dedicated calendar UX is not | Date errors: SOW bug candidate; calendar redesign: change request |
| Incentives only after DIP | DIP is mentioned; incentive engine is not | Change request |
| Block MQL when required project details are missing | Project details are scope, exact MQL gate policy is not | Partial scope change / policy decision |
| Expected OB Date reminder mail/message | No Expected OB reminder requirement | Change request |
| Dashboard KPI redesign, drill-downs, forecasts | Dashboard and reports are scope; exact cards/forecasts/formulas are not | Partial scope change |
| Separate performance scores, medals, conversion/TAT/target/ABV formula | Performance reports are scope; score/gamification formula is not | Change request |
| BL/BH project flagging | SLA flags are scope; manual project flags are not | Change request |
| Inactive leads cancel all tasks | No task-cancellation lifecycle rule | Change request |
| Funnel denominator = Total Leads Received | Conversion reporting is scope; exact denominator/formula is not | Existing metric defect candidate; exact formula is a new reporting rule |

## Recall prompts

Use any of these prompts in a future session:

- “Recall the CRM client-complaint scope audit.”
- “Use the client PDF versus original XLSX audit rules.”
- “Classify this new complaint as an original-scope bug or feature creep.”
- “Show me the client complaints that conflict with the original scope.”
- “Which complaint items are confirmed in current source versus requiring reproduction?”
- “Continue the CRM complaint audit from memory.”
