import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';
import mongoose from 'mongoose';
import CrmOverlay from '../models/CrmOverlay.js';
import CaseAudit from '../models/CaseAudit.js';
import { assertPermission as ensurePermission } from './utils/authz.js';
import { findRawCaseDocForAccessCheck } from './utils/caseAccess.js';

const uploadDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({ storage });

const fsPromises = fs.promises;

const r = Router();

function ensureMongoConnected(res) {
  if (!mongoose.connection || mongoose.connection.readyState !== 1) {
    res.status(503).json({ error: 'Database not connected' });
    return false;
  }
  return true;
}

function toPlainAttachment(attachment) {
  if (!attachment) return null;
  if (typeof attachment.toObject === 'function') return attachment.toObject();
  return { ...attachment };
}

function ensurePlainAttachmentIds(list = []) {
  let mutated = false;
  const attachments = (list || [])
    .filter(Boolean)
    .map((item) => {
      const next = { ...item };
      if (!next.id) {
        next.id = new mongoose.Types.ObjectId().toString();
        mutated = true;
      }
      return next;
    });
  return { attachments, mutated };
}

r.get('/:id/documents', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:read', 'cases:read:department']);
    const accessible = await findRawCaseDocForAccessCheck(req, req.params.id);
    if (!accessible) return res.status(404).json({ error: 'Case not found' });

    const objectId = new mongoose.Types.ObjectId(req.params.id);
    const overlay = await CrmOverlay.findOne({ caseId: objectId }).select({ crm_details: 1 }).lean();
    if (!overlay) return res.json({ attachments: [] });

    const raw = Array.isArray(overlay.crm_details?.attachments) ? overlay.crm_details.attachments : [];
    const { attachments, mutated } = ensurePlainAttachmentIds(raw);

    if (mutated) {
      await CrmOverlay.updateOne(
        { caseId: objectId },
        { $set: { 'crm_details.attachments': attachments } }
      ).catch((err) => {
        console.warn('GET /cases/:id/documents backfill failed', err?.message);
      });
    }

    res.json({ attachments });
  } catch (err) {
    console.error('GET /cases/:id/documents error', err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message || 'Forbidden' });
    }
    if (err?.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid case id' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.post('/:id/documents', upload.single('file'), async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:write', 'cases:write:department']);
    if (!req.file) {
      return res.status(400).json({ error: 'file is required' });
    }

    const accessible = await findRawCaseDocForAccessCheck(req, req.params.id);
    if (!accessible) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Case not found' });
    }
    const objectId = new mongoose.Types.ObjectId(req.params.id);

    const { label, note, checklistKey } = req.body || {};
    const now = new Date();
    const attachment = {
      id: new mongoose.Types.ObjectId().toString(),
      filename: req.file.filename,
      originalName: req.file.originalname,
      url: `/uploads/${req.file.filename}`,
      mimeType: req.file.mimetype,
      size: req.file.size,
      uploadedAt: now,
      label: label ? String(label) : req.file.originalname,
      note: note ? String(note) : '',
      checklistKey: checklistKey ? String(checklistKey) : null,
    };

    const doc = await CrmOverlay.findOneAndUpdate(
      { caseId: objectId },
      {
        $push: { 'crm_details.attachments': attachment },
        $setOnInsert: {
          caseId: objectId,
          sourceCollection: accessible.collection,
          county: accessible.doc?.county || null,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean().catch((err) => {
      console.error('POST /cases/:id/documents update error', err?.message);
      return null;
    });

    if (!doc) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Case not found' });
    }

    await CaseAudit.create({
      caseId: objectId,
      type: 'document_upload',
      actor: req.user?.email || req.user?.id || 'system',
      details: { attachment },
    });

    res.status(201).json({ attachment });
  } catch (err) {
    console.error('POST /cases/:id/documents error', err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message || 'Forbidden' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.patch('/:id/documents/:attachmentId', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:write', 'cases:write:department']);
    const accessible = await findRawCaseDocForAccessCheck(req, req.params.id);
    if (!accessible) return res.status(404).json({ error: 'Case not found' });

    const objectId = new mongoose.Types.ObjectId(req.params.id);
    const overlay = await CrmOverlay.findOne({ caseId: objectId });
    if (!overlay) return res.status(404).json({ error: 'Attachment not found' });

    overlay.crm_details = overlay.crm_details || {};
    overlay.crm_details.attachments = Array.isArray(overlay.crm_details.attachments)
      ? overlay.crm_details.attachments
      : [];

    overlay.crm_details.attachments.forEach((att) => {
      if (att && !att.id) {
        att.id = new mongoose.Types.ObjectId().toString();
      }
    });

    const target = overlay.crm_details.attachments.find((att) => att && att.id === req.params.attachmentId);
    if (!target) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    if (req.body.label !== undefined) {
      const lbl = String(req.body.label || '').trim();
      target.label = lbl;
    }

    if (req.body.note !== undefined) {
      target.note = String(req.body.note || '');
    }

    if (req.body.checklistKey !== undefined) {
      const key = req.body.checklistKey;
      target.checklistKey = key ? String(key) : null;
    }

    overlay.markModified('crm_details.attachments');
    await overlay.save();

    const attachmentPlain = toPlainAttachment(target);

    await CaseAudit.create({
      caseId: objectId,
      type: 'document_update',
      actor: req.user?.email || req.user?.id || 'system',
      details: { attachment: attachmentPlain },
    });

    res.json({ attachment: attachmentPlain });
  } catch (err) {
    console.error('PATCH /cases/:id/documents/:attachmentId error', err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message || 'Forbidden' });
    }
    if (err?.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid identifier' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.delete('/:id/documents/:attachmentId', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:write', 'cases:write:department']);
    const accessible = await findRawCaseDocForAccessCheck(req, req.params.id);
    if (!accessible) return res.status(404).json({ error: 'Case not found' });

    const objectId = new mongoose.Types.ObjectId(req.params.id);
    const overlay = await CrmOverlay.findOne({ caseId: objectId });
    if (!overlay) return res.status(404).json({ error: 'Attachment not found' });

    overlay.crm_details = overlay.crm_details || {};
    overlay.crm_details.attachments = Array.isArray(overlay.crm_details.attachments)
      ? overlay.crm_details.attachments
      : [];

    overlay.crm_details.attachments.forEach((att) => {
      if (att && !att.id) {
        att.id = new mongoose.Types.ObjectId().toString();
      }
    });

    const idx = overlay.crm_details.attachments.findIndex(
      (att) => att && att.id === req.params.attachmentId
    );

    if (idx === -1) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const [removedDoc] = overlay.crm_details.attachments.splice(idx, 1);
    overlay.markModified('crm_details.attachments');
    await overlay.save();

    const removed = toPlainAttachment(removedDoc);

    if (removed?.filename) {
      const filePath = path.join(uploadDir, removed.filename);
      try {
        await fsPromises.unlink(filePath);
      } catch (unlinkErr) {
        if (unlinkErr?.code !== 'ENOENT') {
          console.warn('Failed to delete attachment file', filePath, unlinkErr?.message);
        }
      }
    }

    await CaseAudit.create({
      caseId: objectId,
      type: 'document_delete',
      actor: req.user?.email || req.user?.id || 'system',
      details: { attachment: removed },
    });

    res.json({ removed });
  } catch (err) {
    console.error('DELETE /cases/:id/documents/:attachmentId error', err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message || 'Forbidden' });
    }
    if (err?.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid identifier' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default r;
