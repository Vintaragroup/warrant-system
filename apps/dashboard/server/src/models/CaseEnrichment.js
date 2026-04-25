import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const ContactSchema = new Schema(
  {
    type: { type: String },
    value: { type: String },
    lineType: { type: String },
    carrier: { type: String },
  },
  { _id: false }
);

const AddressSchema = new Schema(
  {
    streetLine1: { type: String },
    streetLine2: { type: String },
    city: { type: String },
    stateCode: { type: String },
    postalCode: { type: String },
    countryCode: { type: String },
    type: { type: String },
  },
  { _id: false }
);

const RelationSchema = new Schema(
  {
    name: { type: String },
    relation: { type: String },
  },
  { _id: false }
);

const CandidateSchema = new Schema(
  {
    recordId: { type: String },
    fullName: { type: String },
    firstName: { type: String },
    lastName: { type: String },
    ageRange: { type: String },
    gender: { type: String },
    score: { type: Number },
    contacts: { type: [ContactSchema], default: [] },
    addresses: { type: [AddressSchema], default: [] },
    relations: { type: [RelationSchema], default: [] },
    additional: { type: Schema.Types.Mixed },
  },
  { _id: false }
);

const CaseEnrichmentSchema = new Schema(
  {
    caseId: { type: Schema.Types.ObjectId, ref: 'Case', required: true, index: true },
    provider: { type: String, required: true, index: true },
    status: { type: String, enum: ['success', 'empty', 'error'], required: true },
    params: { type: Schema.Types.Mixed },
    requestedBy: {
      uid: { type: String },
      email: { type: String },
      name: { type: String },
    },
    requestedAt: { type: Date, default: Date.now },
  // expiresAt TTL handled via schema.index below; avoid inline index to prevent duplicates
  expiresAt: { type: Date },
    candidates: { type: [CandidateSchema], default: [] },
    error: {
      code: { type: String },
      message: { type: String },
    },
    meta: { type: Schema.Types.Mixed },
    selectedRecords: {
      type: [
        new Schema(
          {
            recordId: { type: String, required: true },
            selectedAt: { type: Date, default: Date.now },
            selectedBy: {
              uid: { type: String },
              email: { type: String },
              name: { type: String },
            },
            payload: { type: Schema.Types.Mixed },
          },
          { _id: false }
        )
      ],
      default: [],
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
      },
    },
  }
);

CaseEnrichmentSchema.index({ caseId: 1, provider: 1, requestedAt: -1 });
CaseEnrichmentSchema.index({ provider: 1, requestedAt: -1 });
CaseEnrichmentSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const CaseEnrichment = model('CaseEnrichment', CaseEnrichmentSchema);
export default CaseEnrichment;
