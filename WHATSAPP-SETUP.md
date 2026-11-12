# WhatsApp Web setup (no paid provider)

Version 0.5 sends through your logged-in WhatsApp Web session. No Twilio account, template, local server or provider credentials are used. Desktop alerts remain available. Browser-based sending depends on the current WhatsApp interface and may stop after UI or login changes.

## Privacy boundary

The sender does not read chat history, message text, cookies, internal stores or contact lists. It inspects only the current recipient header, scoped contact-info phone fields, compose structure and Send control. It counts draft character lengths without reading their values, refuses existing text or rich drafts, and aborts if the user edits the composer or switches chats during a send. Recipient numbers are configured in local extension storage, not source or packages.

No chat screenshots or whole-page accessibility snapshots should be used to troubleshoot this sender. A manual test is confirmed by you; the app never reads message history to confirm receipt. Composer clearance establishes submission only, not delivery.

## Setup

1. Reload Visa Slot Watch at `chrome://extensions`. This pauses monitoring so popup and worker use the same version.
2. Open a dedicated WhatsApp Web tab to your intended recipient. Sign in manually if needed. Leave the tab open. Do not use that tab for other conversations or drafts during monitoring.
3. In the extension, enter the recipient's full phone number with country code and enable **Send through my WhatsApp Web session**.
4. Click **Verify & attach WhatsApp tab**. Chrome asks for optional WhatsApp Web access; approve the native prompt yourself if you want the sender enabled.
5. The extension verifies the exact number using recipient metadata. It may open Contact info. If metadata/control markup is unsupported or an existing draft is present, it stops without sending. Do not substitute a display name for number verification.
6. Click **Send test**. It submits one clearly labeled app test to the configured number. Confirm receipt yourself on your phone. No appointment availability is implied by the test.
7. Return to the OFC calendar and resume monitoring with your selected sweep interval. Keep Chrome, the Mac and both dedicated tabs running/awake.

Each completed/partial sweep produces one WhatsApp report with locations in Hyderabad-first order. No-slots results and unvisited locations are explicit. Normal desktop receipts can be disabled independently.

## Failures and interrupted sends

A persistent local send lock and submitted report IDs prevent automatic duplicates across worker restarts. If a send becomes ambiguous, WhatsApp delivery is marked failed while calendar checks continue; the lock prevents automatic retries. Check receipt manually before using **clear interrupted-send lock**. Clearing the lock does not itself resend a message.

If the app inserted an unsent draft before a cancellation/error, remove that app-generated draft yourself before another send. Existing user drafts are never overwritten or cleared automatically. The app does not inspect them.

WhatsApp sign-out, unsupported UI, unverifiable recipient, existing draft, lost tab or changed composer pauses remote sending. Visa login/CAPTCHA/blocking errors continue to pause site checking without retries. A short interval does not guarantee either session stays logged in.

## Verification status

Automated tests protect history/body/draft text getters and exercise wrong recipient, hidden metadata, rich drafts, same-length edits, duplicate IDs, interrupted sends and control failures. These fixtures do not prove live WhatsApp selector compatibility or delivery. Native host permission and a real manual receipt test remain required.
