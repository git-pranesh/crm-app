import { Router } from 'express';

export const callWebhookRouter = Router();

/**
 * POST /api/calls/webhook/exotel
 *
 * STUB — activate when Exotel credentials are provided.
 * Maps to Call model (recordingUrl field already in schema).
 *
 * Expected Exotel payload:
 *   CallSid, Status, From, To, RecordingUrl, Duration, Direction
 */
callWebhookRouter.post('/exotel', (req, res) => {
  // Activate when Exotel credentials provided — maps to Call model
  console.log('[exotel:webhook] Received payload:', JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});
