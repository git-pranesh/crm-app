# Google Form DQL Questionnaire — Setup Guide

This document explains how to connect a Google Form pre-DQL questionnaire to the CRM.

## Overview

Before a DQL meeting, the designer sends the client a Google Form with qualifying questions.
When the client submits the form, a webhook fires to the CRM and attaches the responses to the lead.
The designer sees a "View Pre-meeting Questionnaire" button inside the DQL meeting card.

---

## Step 1 — Create the Google Form

1. Go to [forms.google.com](https://forms.google.com) and click **Blank**.
2. Title it: **Interiors by DeX — Pre-Meeting Questionnaire**
3. Add your qualifying questions (scope, budget, timeline, style preferences, etc.)
4. **Important:** Add a first question called **"Lead ID"** with `Short answer` type.
   - Set its description to: *"Your designer will fill this in. Please do not edit."*
   - This field is how the CRM matches the response to the correct lead.
5. (Optional) Set the form to require a Google account login — this reduces spam submissions.

---

## Step 2 — Create the Apps Script webhook

1. Inside the form, click the three-dot menu (⋮) → **Script editor**.
2. Replace all code with:

```javascript
function onFormSubmit(e) {
  var responses = e.namedValues;
  var leadIdentifier = responses["Lead ID"] ? responses["Lead ID"][0] : "";

  if (!leadIdentifier) {
    console.log("No Lead ID found — skipping webhook");
    return;
  }

  var payload = {
    formResponseId: e.response.getId(),
    leadIdentifier: leadIdentifier.trim(),
    responses: {}
  };

  for (var key in responses) {
    if (key !== "Lead ID") {
      payload.responses[key] = responses[key][0];
    }
  }

  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  // Replace with your CRM URL:
  var CRM_URL = "https://crm.interiorsbydex.com/api/integrations/google-form-webhook";
  var response = UrlFetchApp.fetch(CRM_URL, options);
  console.log("CRM response:", response.getContentText());
}
```

3. Click **Save** (the floppy-disk icon).
4. Click **Edit → Current project's triggers**.
5. Click **+ Add Trigger** and set:
   - **Function:** `onFormSubmit`
   - **Event source:** From form
   - **Event type:** On form submit
6. Click **Save** and grant the permissions it requests.

---

## Step 3 — Test the integration

1. Open the form as a respondent.
2. Fill in a real Lead ID (e.g. `X0001`) in the Lead ID field.
3. Submit the form.
4. Check the CRM: open the lead with that ID → Meetings tab → DQL meeting card.
5. A **"View Pre-meeting Questionnaire"** button should appear.

---

## Step 4 — Add Lead ID to the send flow (designer workflow)

When a designer sends the form link to a client:

1. Open the lead in the CRM.
2. Copy the lead's ID (displayed as `X####` in the header).
3. Open the Form → click the **pencil icon** on the Lead ID question.
4. Click **⋮ → Pre-fill link**.
5. Paste the lead's ID into the Lead ID field → click **Get link**.
6. Send the pre-filled link to the client via WhatsApp or email from within the CRM.

---

## Troubleshooting

| Issue | Fix |
|---|---|
| Questionnaire not appearing in CRM | Check Apps Script logs (Executions tab) for errors |
| "Lead not found" error | Double-check the Lead ID field value in the form response |
| Webhook URL rejected | Ensure the CRM server is publicly accessible and BASE_URL is set correctly |
| Trigger not firing | Re-authorize the Apps Script trigger (delete and re-create it) |

---

## ACTIVATION REQUIRED

// ACTIVATION REQUIRED: client must set up Google Form with Lead ID field + configure Apps Script webhook to POST to this endpoint. See this file for setup instructions.

Once the client confirms form setup, test with a real submission before enabling in production.
