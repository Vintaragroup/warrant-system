import mongoose from 'mongoose';
import { ChecklistItemSchema, AttachmentSchema } from './Case.js';

const { Schema, model } = mongoose;

/**
 * App-owned CRM state, decoupled from wherever the underlying scraped case
 * data lives (simple_* legacy collections or v2_* pipeline collections,
 * which are owned/upserted by services/warrantdb-pipeline on every scrape
 * cycle). Keyed by the case's own _id — the same identity already used by
 * CaseAudit/Message/CaseEnrichment — not a synthetic id of its own.
 */
const CrmOverlaySchema = new Schema(
  {
    caseId: { type: Schema.Types.ObjectId, required: true, unique: true, index: true },

    // Denormalized for debugging/reporting only — never used for access control.
    sourceCollection: { type: String },
    county: { type: String },

    manual_tags: { type: [String], default: [] },

    crm_stage: { type: String, default: 'new', index: true },
    crm_stage_history: {
      type: [
        new Schema(
          {
            stage: { type: String, required: true },
            changedAt: { type: Date, default: Date.now },
            actor: String,
            note: String,
          },
          { _id: false }
        ),
      ],
      default: [],
    },

    crm_details: {
      qualificationNotes: { type: String, default: '' },
      documents: { type: [ChecklistItemSchema], default: [] },
      followUpAt: { type: Date },
      assignedTo: { type: String, default: '' },
      address: {
        type: new Schema(
          {
            streetLine1: { type: String, default: '' },
            streetLine2: { type: String, default: '' },
            city: { type: String, default: '' },
            stateCode: { type: String, default: '' },
            postalCode: { type: String, default: '' },
            countryCode: { type: String, default: '' },
          },
          { _id: false }
        ),
        default: undefined,
      },
      phone: { type: String, default: '' },
      attachments: { type: [AttachmentSchema], default: [] },
      acceptance: {
        accepted: { type: Boolean, default: false },
        acceptedAt: { type: Date },
        notes: { type: String, default: '' },
      },
      denial: {
        denied: { type: Boolean, default: false },
        deniedAt: { type: Date },
        reason: { type: String, default: '' },
        notes: { type: String, default: '' },
      },
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_, ret) => {
        ret.id = ret._id;
        delete ret._id;
      },
    },
    toObject: { virtuals: true },
  }
);

const CrmOverlay = model('CrmOverlay', CrmOverlaySchema, 'crm_overlays');
export default CrmOverlay;
