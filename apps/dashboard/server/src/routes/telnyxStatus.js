/**
 * routes/telnyxStatus.js
 * ──────────────────────────────────────────────────────────────────────────────
 * Read-only status endpoint for the Telnyx messaging integration, surfaced in
 * the Admin UI's Integrations panel.
 *
 * Mounted at: /api/admin/telnyx (requireAuth + requireAdmin)
 */

import { Router } from 'express';
import Message from '../models/Message.js';

const r = Router();

function requireAdmin(req, res, next) {
  const roles = req.user?.roles || [];
  if (
    roles.includes('Admin') ||
    roles.includes('SuperUser') ||
    roles.includes('Super Admin') ||
    roles.includes('super_admin')
  ) {
    return next();
  }
  return res.status(403).json({
    ok: false,
    error: 'FORBIDDEN',
    message: 'Admin or SuperUser role required',
  });
}

r.use(requireAdmin);

r.get('/status', async (req, res) => {
  try {
    const configured = {
      api_key: Boolean(process.env.TELNYX_API_KEY),
      sender_number: Boolean(process.env.TELNYX_MESSAGING_FROM_NUMBER),
      messaging_profile_id: Boolean(process.env.TELNYX_MESSAGING_PROFILE_ID),
      webhook_public_key: Boolean(process.env.TELNYX_PUBLIC_KEY),
    };

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await Message.find({
      provider: 'telnyx',
      direction: 'out',
      createdAt: { $gte: since },
    }).select({ status: 1, createdAt: 1 }).lean();

    const total = recent.length;
    const failed = recent.filter((m) => m.status === 'failed').length;
    const successRate = total > 0 ? (total - failed) / total : null;

    const lastMessage = await Message.findOne({ provider: 'telnyx', direction: 'out' })
      .sort({ createdAt: -1 })
      .select({ status: 1, createdAt: 1, sentAt: 1, deliveredAt: 1 })
      .lean();

    res.json({
      ok: true,
      configured,
      recent_24h: { total, failed, success_rate: successRate },
      last_send: lastMessage || null,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[telnyxStatus] /status error:', err.message);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: err.message });
  }
});

export default r;
