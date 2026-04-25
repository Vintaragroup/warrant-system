import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const CaseAuditSchema = new Schema(
  {
    caseId: { type: Schema.Types.ObjectId, ref: 'Case', index: true, required: true },
    type: { type: String, required: true, index: true },
    actor: { type: String, index: true },
    details: Schema.Types.Mixed,
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false },
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
      }
    },
  }
);

CaseAuditSchema.index({ caseId: 1, createdAt: -1 });

const CaseAudit = model('CaseAudit', CaseAuditSchema);
export default CaseAudit;
