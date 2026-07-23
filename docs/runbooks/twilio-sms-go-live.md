# Twilio SMS — Go-Live Checklist (Toll-Free Verification)

Status as of 2026-07-23. For whoever submits the Twilio Toll-Free Verification (TFV) and flips SMS live.

Source: compliance audit 2026-07-23 (Twilio TFV docs + CTIA messaging principles).

## TL;DR

The privacy/consent **copy is submission-ready**. The go-live blocker is **operational, not legal text**: every SMS body and the policy promise “Reply STOP / HELP,” but nothing in the app honors it yet.

**Owner decision (2026-07-23):** ship the copy fixes now; **do NOT build STOP/HELP handling yet** — it is tracked here as a separate task. Until it exists, do not send at scale.

## Copy — DONE (2026-07-23)

- `_copy/legal.ts` privacy policy: SMS section present; “opt-in data not shared/sold” clause broadened to the unqualified “for their own purposes” phrasing carriers (esp. T-Mobile) look for; Twilio named as an SMS sub-processor.
- `_copy/welcome.ts`: unchecked-by-default consent checkbox with the full disclosure (brand, message types, “frequency varies,” “Msg & data rates may apply,” “Reply STOP … HELP,” “consent is not a condition of purchase,” privacy link) + server re-validation.
- `_copy/invitations.ts`: initial SMS carries STOP/HELP/rates; **`sms.help()` and `sms.optOutConfirm()`** added as the HELP reply + opt-out-confirmation bodies (also the message samples the TFV form requires). These are NOT yet wired to any inbound handler.

## Go-live BLOCKERS (not done — deferred per owner)

1. **Honor STOP/HELP.** Options (do at least one, ideally both):
   - (a) Attach the sending number to a Twilio **Messaging Service with Advanced Opt-Out** — provides carrier STOP suppression + STOP/HELP auto-replies. Configure the STOP-confirmation and HELP text there (mirror `sms.optOutConfirm()` / `sms.help()`).
   - (b) Build an inbound webhook `apps/web/app/api/webhooks/twilio/route.ts` (validate `X-Twilio-Signature`), persist opt-out, and **gate every send** on opt-out. Needs a new store — `accounts.sms_opted_out_at` (migration) or an `sms_opt_outs(phone)` table keyed by E.164 so **provisional invitees** (never `account_contacts`) are covered. Add the companion regression test (STOP suppresses a later invite send).
   - **Risk if skipped:** a family member re-inviting a number that already texted STOP still sends → messaging-policy violation → carrier block. Highest-risk item.
2. **Public opt-in evidence for TFV.** `/welcome` is behind Clerk auth, so a Twilio reviewer cannot reach it. Submit **screenshots** of the branded, unchecked consent step (allowed) **or** publish a public opt-in page.

## TFV submission fields to prepare

- Legal business name + business type + registration number (EIN)
- Authorized-rep email on a **business domain** (not freemail) — 2025 requirement
- Public, content-bearing website (`tellmeagain.app`) — 2025 requirement
- Use case: “family invitation links + account/security notices” (transactional, non-marketing)
- Opt-in workflow description + screenshot/URL (see blocker 2)
- Message samples: initial invite (`invitations.sms.text`), HELP (`invitations.sms.help`), opt-out confirm (`invitations.sms.optOutConfirm`)
- Estimated monthly message volume

## Verify before submitting

- `/privacy` is publicly reachable (unauthenticated) in production.

## If we ever use 10DLC instead of toll-free

- Brand + campaign registration. As of **2026-06-30**, `PrivacyPolicyUrl` **and** `TermsAndConditionsUrl` are REQUIRED on every campaign. We have `/privacy`; there is **no `/terms` page** — add one first.
