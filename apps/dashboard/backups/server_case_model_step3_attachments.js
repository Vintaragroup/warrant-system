import mongoose from 'mongoose';

const { Schema, connection } = mongoose;

/**
 * Normalized Case schema aligned with simple_* collections produced by the normalizer.
 * Works for both Harris (simple_harris) and Jefferson (simple_jefferson).
 */

const UpsertKeySchema = new Schema(
  {
    county: { type: String, required: true, index: true },
    category: { type: String, required: true }, // e.g., 'Criminal' | 'Civil'
    anchor: { type: String, required: true },   // case_number (Harris) or URL (Jefferson)
  },
  { _id: false }
);

const ChecklistItemSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    required: { type: Boolean, default: false },
    status: { type: String, enum: ['pending', 'completed'], default: 'pending' },
    completedAt: { type: Date },
    note: { type: String, default: '' },
  },
  { _id: false }
);

const AttachmentSchema = new Schema(
  {
    id: {
      type: String,
      default: () => new mongoose.Types.ObjectId().toString(),
    },
    filename: String,
    originalName: String,
    url: String,
    mimeType: String,
    size: Number,
    uploadedAt: Date,
    label: String,
    note: String,
    checklistKey: String,
  },
  { _id: false }
);

const CaseSchema = new Schema(
  {
    // Display / identity
    full_name: { type: String, index: true },
    county: { type: String, required: true, index: true },

    // Normalized case fields used by the dashboard & routes
    charge: { type: String, index: true },
    status: { type: String, index: true }, // e.g., 'Active'
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
        )
      ],
      default: [],
    },
    crm_details: {
      qualificationNotes: { type: String, default: '' },
      documents: { type: [ChecklistItemSchema], default: [] },
      followUpAt: { type: Date },
      assignedTo: { type: String, default: '' },
      attachments: {
        type: [AttachmentSchema],
        default: [],
      },
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
    race:   { type: String, index: true },
    sex:    { type: String, index: true },

    // Booking timeline (normalized string date: 'YYYY-MM-DD')
    booking_date: { type: String, index: true },
    time_bucket:  { type: String, index: true }, // '24_hours_or_less', '0_to_30_days', ...

    // Bond normalization
    bond_amount: { type: Number, default: null, index: true }, // numeric only
    bond_label:  { type: String, default: '' },                 // e.g., 'UNSECURED GOB ELIGIBLE', 'REFER TO MAGISTRATE'
    // Kept for completeness/back-compat (may be a Number, 'REFER TO MAGISTRATE', or null)
    bond:        { type: Schema.Types.Mixed, default: null },

    // Identifiers
    case_number: { type: String, index: true },
    spn:         { type: String, index: true },

    // Optional legacy/source fields (not required by dashboard but useful to display/filter)
    offense: String,
    source: String,
    source_url: String,
    source_filename_date: String,

    // Tags for UI flags (e.g., 'refer_to_magistrate', etc.)
    tags: { type: [String], default: [] },
    manual_tags: { type: [String], default: [] },

    // Upsert identity from the normalizer
    _upsert_key: { type: UpsertKeySchema, required: true },
  },
  { 
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
      }
    },
    toObject: { virtuals: true }
  }
);

// Convenience virtuals for the API layer
CaseSchema.virtual('anchor').get(function () {
  return this._upsert_key?.anchor || null;
});

/**
 * Indexes that mirror what we created directly in MongoDB.
 * These are safe to define in Mongoose; in production you can disable autoIndex if desired.
 */
CaseSchema.index({ '_upsert_key.county': 1, '_upsert_key.category': 1, '_upsert_key.anchor': 1 }, { name: 'uniq_upsert_key', unique: true });
CaseSchema.index({ booking_date: 1 }, { name: 'booking_date_1' });
CaseSchema.index({ status: 1, booking_date: -1 }, { name: 'status_1_booking_date_-1' });
CaseSchema.index({ time_bucket: 1, booking_date: -1 }, { name: 'time_bucket_1_booking_date_-1' });
CaseSchema.index({ county: 1, booking_date: 1 }, { name: 'county_1_booking_date_1' });
// Helpful text search for free-form query
CaseSchema.index({ full_name: 'text', charge: 'text', case_number: 'text', spn: 'text' }, { name: 'case_text_index', default_language: 'english' });

/**
 * Export models for each collection.
 * - CaseHarris -> 'simple_harris'
 * - CaseJefferson -> 'simple_jefferson'
 *
 * If your routes prefer a single import, use `pickCaseModel` to select by county.
 */
export const CaseHarris = (connection.modelNames().includes('CaseHarris')
  ? connection.model('CaseHarris')
  : connection.model('CaseHarris', CaseSchema, 'simple_harris'));

export const CaseJefferson = (connection.modelNames().includes('CaseJefferson')
  ? connection.model('CaseJefferson')
  : connection.model('CaseJefferson', CaseSchema, 'simple_jefferson'));

/**
 * Helper to choose the correct model by county.
 * Defaults to Harris if county is missing/unknown.
 */
export const pickCaseModel = (county) => {
  const name = (county || '').toLowerCase();
  if (name === 'jefferson') return CaseJefferson;
  return CaseHarris;
};

// Default export keeps backward compatibility (Harris as the default dataset)
export default CaseHarris;
