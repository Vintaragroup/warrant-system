import express from 'express';
import AccessRequest from '../models/AccessRequest.js';
import User from '../models/User.js';
import { assertPermission, hasPermission } from './utils/authz.js';

const router = express.Router();

const VALID_STATUSES = ['pending', 'reviewed', 'completed', 'rejected'];

function sanitize(request) {
  if (!request) return null;
  return {
    id: request._id?.toString?.() || request.id,
    email: request.email,
    displayName: request.displayName,
    message: request.message,
    status: request.status,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    reviewedBy: request.reviewedBy ? request.reviewedBy.toString() : null,
    reviewedAt: request.reviewedAt,
  };
}

function ensureManageAccess(req) {
  if (!hasPermission(req, 'users:manage')) {
    assertPermission(req, 'users:manage');
  }
}

router.get('/', async (req, res) => {
  ensureManageAccess(req);
  const { status = 'pending' } = req.query || {};
  const filters = {};
  if (status && VALID_STATUSES.includes(String(status))) {
    filters.status = String(status);
  }
  const requests = await AccessRequest.find(filters).sort({ createdAt: -1 }).lean();
  res.json({ requests: requests.map(sanitize) });
});

router.patch('/:id', async (req, res) => {
  ensureManageAccess(req);
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: 'id is required' });
  }
  const { status } = req.body || {};
  if (!status || !VALID_STATUSES.includes(String(status))) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const reviewer = await User.findOne({ uid: req.user?.uid }).select('_id').lean();
  const update = {
    status: String(status),
    reviewedBy: reviewer?._id || null,
    reviewedAt: new Date(),
  };

  const doc = await AccessRequest.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
  if (!doc) {
    return res.status(404).json({ error: 'Access request not found' });
  }

  res.json({ request: sanitize(doc) });
});

export default router;
