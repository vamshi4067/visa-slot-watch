# Visa Slot Watch 0.5

A local Chrome extension that checks visa OFC calendars and alerts you. All VACs are checked in each sweep, starting with Hyderabad. Optional Gmail alerts send one combined report after each completed sweep using send-only access; desktop notifications continue independently. WhatsApp Web remains optional and may leave a report draft for you to send.

## Install or upgrade

1. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the Visa Slot Watch folder. For an existing installation, click its Reload button.
2. Open the visa site, log in and complete CAPTCHA manually. Leave a dedicated OFC calendar tab open.
3. Open Visa Slot Watch, choose **Attach this calendar tab**, then **Test desktop alert**. Confirm the alert appears; enable Google Chrome in macOS Notifications if needed.
4. Choose **All VACs · Hyderabad first** or **Hyderabad only**. Select a sweep interval; new installs default to **2 minutes**. Existing saved settings remain until changed.
5. Click **Start / resume**. The dedicated tab may reload or change OFC locations. It will not select dates or times, submit, book, cancel or reschedule.

For email, use the **Email reports** section in the extension. Save the recipient, connect the Google account that should send messages, then use **Send test email** and confirm receipt yourself. Gmail alerts require your own Chrome Extension OAuth client ID. If Google reports an extension-ID mismatch, compare the ID on `chrome://extensions` with the Chrome Extension OAuth client in Google Cloud Console.

To create or verify the Google OAuth client: in [Google Cloud Console](https://console.cloud.google.com/), select a project and enable the Gmail API; configure Google Auth Platform consent and add your Google account as a test user while the app is in Testing; under **Clients**, create a **Chrome Extension** client and enter the ID shown on the Visa Slot Watch card at `chrome://extensions`; copy the resulting client ID into `manifest.json` under `oauth2.client_id`, reload the unpacked extension, then connect Google in Visa Slot Watch. See Google's [Chrome extension OAuth guide](https://developer.chrome.com/docs/extensions/how-to/integrate/oauth) and [credential setup guide](https://developers.google.com/workspace/guides/create-credentials). Do not create or paste a client secret into the extension.

## How a sweep works

- Each sweep visits Hyderabad first, then each other location found in the OFC Post dropdown exactly once. It no longer alternates Hyderabad with other VACs across separate intervals.
- One location is observed per alarm, with at least **30 seconds between location checks**. The queue and observations persist between Chrome service worker runs.
- The interval is a target between sweep starts, not a promise to finish within two minutes. For example, five locations require at least two minutes of gaps plus page loading. Sweeps never overlap; a slow sweep delays the next one. Chrome can delay alarms further.
- At the same location, reload the dedicated calendar tab once. For a different location, change only OFC Post and wait for actual fresh result replacement and a stable state. If freshness cannot be confirmed, pause as unknown.
- Inspect only rendered dates. No date/time clicks, month navigation or hidden appointment API requests.
- A shorter interval does not guarantee an authenticated session or prevent a website outage. The app does not use a separate keep-alive mechanism. Expired login, CAPTCHA, blocking, errors, missing freshness or unknown markup pauses monitoring for manual review. No automatic retries of failed site requests.

## Notifications

- **New dates:** desktop alert once per newly observed location/date; open the calendar and verify manually.
- **No slots:** enabled by default after each confirmed empty location check; the notification includes that VAC and the time. The checkbox only controls these desktop receipts.
- **Email:** if enabled and authorized, one combined Gmail report after each completed sweep, including all-empty sweeps. Only rendered location status and dates are included. Failed sends do not pause monitoring or suppress desktop alerts; no automatic retries are made. The extension never reads the inbox.
- **WhatsApp:** if configured, one compact combined report after every completed sweep, including all-empty sweeps. Partial reports mark failed and unvisited locations explicitly. Desktop receipt settings do not suppress WhatsApp reports.
- **Email status:** The app reports Gmail API acceptance, not inbox delivery. You confirm test receipt manually. Only the Gmail send scope is requested; mailbox read/list/modify APIs are never used.
- **WhatsApp status:** The app reports submission only, not delivery. It never reads chat history; you confirm test receipt yourself. Failed or ambiguous submissions are recorded without pausing calendar checks. A persistent send lock prevents automatic retries until you check receipt manually and clear it.
- **Test buttons:** explicitly labeled desktop, email, and WhatsApp tests do not establish any appointment availability.

## Privacy and operation

No visa credentials, cookies, applicant names or raw page dumps are collected. Chrome stores settings, location/date observations, timestamps and alert fingerprints locally. The Gmail OAuth token is managed by Chrome Identity and is not copied into extension storage. If enabled, only app-generated location/date/status reports are sent using Gmail send-only access or composed into your verified WhatsApp chat. The sender inspects recipient metadata and compose controls, never chat history or existing draft text. Your recipient is kept in local extension storage.

Keep Chrome open and your Mac awake. Keep the dedicated WhatsApp Web tab open and logged in. This app does not prevent device sleep, bypass CAPTCHA/access controls, keep an account session alive indefinitely, or perform any booking action. Reattaching resets observations and date-alert fingerprints.

## Verified and missing

Observed live using Chrome accessibility: authenticated OFC page, Hyderabad and later Mumbai selected by the user, explicit **No Slots Available**, disabled Submit. No available dates were observed. REA browser/CDP attachment remains unverified.

Local tests cover classification, freshness, sweep persistence and coverage, Pause races, notification deduplication, Gmail message encoding/send boundaries, and WhatsApp validation/security/acceptance. A standalone Chrome synthetic fixture verified five adapter behaviors; the popup layout was inspected. These do not establish compatibility with the actual site's available-date markup or location refresh behavior.

Still unverified: installed-extension runtime, automated live location switching, actual available-date markup, live WhatsApp Web submission/receipt, long-running session lifetime and all-month coverage. Treat date detection as experimental until live validation. A blank page never means no slots.

## Development and packages

```sh
npm ci
npm test
npm run check
node scripts/package.mjs
```

No extension build step is needed. Linkedom is a test-only dependency; NodWhatsApper belongs to the local WhatsApp sender. `visa-slot-watch.zip` contains the standalone extension. `visa-slot-watch-app.zip` additionally contains test source and development metadata, excluding `.env` and credentials. `node scripts/browser-fixture.mjs` generates a standalone local browser test from the current production sources.

References: [Chrome alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms), [Chrome notifications](https://developer.chrome.com/docs/extensions/reference/api/notifications), [content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts).

## Session and page-load diagnosis (0.5.8)

A blank page or browser network error is not labelled a logout. The monitor checks the tab again after a calendar reload and before injecting its observer. A redirect to Atlas sign-in, verification, an unfinished navigation, and an unrecognized/blank document pause separately. The popup shows the stage of an unreadable calendar result. No automatic login, retry, keep-alive, cookie changes, or challenge bypass is added.

A bounded local `watchDiagnostics` record keeps at most 30 entries containing only time, check stage, fixed page category, and result status. It contains no raw URLs, query parameters, cookies, applicant data or page contents, and is not included in Gmail or WhatsApp reports. This is diagnostic hardening; the cause of a real second-sweep error remains unverified until its page state is observed.

## Prominent date alerts (0.5.9)

New calendar dates trigger a desktop alert such as “Visa slots available on January 15, 2027, at Hyderabad VAC.” A local English system voice reads the dates and VAC. It also announces when human verification is needed. Both announcements can be previewed in the popup. Muting slot voice alerts leaves verification announcements enabled. Audio failure does not cancel the visual alert or monitoring. System sound and notification settings still apply.

The latest unacknowledged detection remains in an amber popup banner and SLOT toolbar badge even if later checks are empty. Its detection time is shown; it is historical evidence, not guaranteed current availability. Acknowledge clears the banner/badge without resetting date deduplication. The location history retains other observations. The slot announcement does not repeat for an already alerted date at the same VAC; attaching a calendar starts a new monitoring history.

## PSE0501 recovery (0.6.0)

Reload the extension and start monitoring explicitly. Version 0.6.1 also installs the detector on an already-open calendar during inspection; a separate calendar refresh is not required. On the attached running tab, only the matching “Unable to load appointment available days” PSE0501 alert is handled before it blocks the page, equivalent to accepting its OK. Unrelated alerts remain native. An alert already open before the detector was installed must be dismissed manually once.

The failed check is never recorded as no slots. The monitor starts recovery immediately, opens Home, then follows the unique visible Schedule Appointment link back to the same-origin OFC calendar. Recovery stages are at least 30 seconds apart and are shown in the popup. It verifies the calendar, then restarts the sweep at Hyderabad without resetting seen dates or the pending slot alert.

Missing links, unexpected pages and login can require manual attention. Pause cancels queued recovery. No debugger permission, cookie access, login automation or booking is added. Home navigation cannot guarantee repair of the portal’s underlying failure; installed live recovery still requires verification.

## Detector loading fix (0.6.1)

Live diagnosis showed version 0.6.0 running while the existing calendar document lacked its detector marker. Every calendar inspection now ensures the MAIN-world alert hook and isolated bridge are installed on that document before reading or switching locations. Repeated installation is idempotent. Arming is owned by the isolated bridge, whose revision check discards older responses when Pause is pressed. The installer uses this same mechanism rather than writing arming state independently. No navigation or extra portal request is used for installation.

## General calendar recovery (0.7.0)

Identified calendar load errors, blank pages, navigation/loading timeouts and unverifiable fresh results now use recovery, not just PSE0501. Each attempt refreshes the controlled tab once, returns to Home, follows the visible Schedule Appointment link, and verifies the latest calendar. Stages remain at least 30 seconds apart. The freshly loaded document ID and VAC list replace the old attachment metadata; date deduplication and pending slot alerts remain. Newly verified dates alert immediately, then the next sweep starts from Hyderabad.

The first recovery starts immediately. If recovery itself encounters another eligible calendar failure, it retries after 30 seconds. There is no hourly attempt limit. The popup shows the stage, last issue and next check.

Login, CAPTCHA/Cloudflare verification, explicit access blocks, closed tabs, unexpected sites, unavailable/ambiguous scheduling links and unrelated notification/email/WhatsApp problems do not trigger automatic navigation. Manual Pause cancels pending recovery. For a blank document, only its previously verified calendar base is used. The extension never chooses another account/tab, logs in, books or closes an application. This is recovery behavior, not a guarantee that the portal's underlying failure will disappear.
