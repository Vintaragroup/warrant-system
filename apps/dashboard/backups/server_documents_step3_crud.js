import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';
import mongoose from 'mongoose';
import Case from '../models/Case.js';
import CaseAudit from '../models/CaseAudit.js';

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
    const doc = await Case.findById(req.params.id).select({ crm_details: 1 }).lean();
    if (!doc) return res.status(404).json({ error: 'Case not found' });

    const raw = Array.isArray(doc.crm_details?.attachments) ? doc.crm_details.attachments : [];
    const { attachments, mutated } = ensurePlainAttachmentIds(raw);

    if (mutated) {
      await Case.updateOne(
        { _id: doc._id },
        { $set: { 'crm_details.attachments': attachments } }
      ).catch((err) => {
        console.warn('GET /cases/:id/documents backfill failed', err?.message);
      });
    }

    res.json({ attachments });
  } catch (err) {
    console.error('GET /cases/:id/documents error', err);
    if (err?.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid case id' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.post('/:id/documents', upload.single('file'), async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    if (!req.file) {
      return res.status(400).json({ error: 'file is required' });
    }

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

    const update = {
      updatedAt: now,
      $push: { 'crm_details.attachments': attachment },
    };

    const doc = await Case.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true, runValidators: false }
    ).lean();

    if (!doc) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Case not found' });
    }

    await CaseAudit.create({
      caseId: doc._id,
      type: 'document_upload',
      actor: req.user?.email || req.user?.id || 'system',
      details: { attachment },
    });

    res.status(201).json({ attachment });
  } catch (err) {
    console.error('POST /cases/:id/documents error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.patch('/:id/documents/:attachmentId', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    const caseDoc = await Case.findById(req.params.id);
    if (!caseDoc) return res.status(404).json({ error: 'Case not found' });

    caseDoc.crm_details = caseDoc.crm_details || {};
    caseDoc.crm_details.attachments = Array.isArray(caseDoc.crm_details.attachments)
      ? caseDoc.crm_details.attachments
      : [];

    caseDoc.crm_details.attachments.forEach((att) => {
      if (att && !att.id) {
        att.id = new mongoose.Types.ObjectId().toString();
      }
    });

    const target = caseDoc.crm_details.attachments.find((att) => att && att.id === req.params.attachmentId);
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

    caseDoc.markModified('crm_details.attachments');
    await caseDoc.save();

    const attachmentPlain = toPlainAttachment(target);

    await CaseAudit.create({
      caseId: caseDoc._id,
      type: 'document_update',
      actor: req.user?.email || req.user?.id || 'system',
      details: { attachment: attachmentPlain },
    });

    res.json({ attachment: attachmentPlain });
  } catch (err) {
    console.error('PATCH /cases/:id/documents/:attachmentId error', err);
    if (err?.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid identifier' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.delete('/:id/documents/:attachmentId', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    const caseDoc = await Case.findById(req.params.id);
    if (!caseDoc) return res.status(404).json({ error: 'Case not found' });

    caseDoc.crm_details = caseDoc.crm_details || {};
    caseDoc.crm_details.attachments = Array.isArray(caseDoc.crm_details.attachments)
      ? caseDoc.crm_details.attachments
      : [];

    caseDoc.crm_details.attachments.forEach((att) => {
      if (att && !att.id) {
        att.id = new mongoose.Types.ObjectId().toString();
      }
    });

    const idx = caseDoc.crm_details.attachments.findIndex(
      (att) => att && att.id === req.params.attachmentId
    );

    if (idx === -1) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const [removedDoc] = caseDoc.crm_details.attachments.splice(idx, 1);
    caseDoc.markModified('crm_details.attachments');
    await caseDoc.save();

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
      caseId: caseDoc._id,
      type: 'document_delete',
      actor: req.user?.email || req.user?.id || 'system',
      details: { attachment: removed },
    });

    res.json({ removed });
  } catch (err) {
    console.error('DELETE /cases/:id/documents/:attachmentId error', err);
    if (err?.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid identifier' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default r;
