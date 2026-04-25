import mongoose from 'mongoose';

const { Schema, connection } = mongoose;

const AuthAuditSchema = new Schema(
  {
    uid: { type: String, index: true },
    event: {
      type: String,
      enum: ['session_created', 'session_failed', 'logout', 'session_revoked'],
      required: true,
    },
    email: { type: String },
    ip: { type: String },
    userAgent: { type: String },
    metadata: { type: Schema.Types.Mixed },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false },
  }
);

AuthAuditSchema.index({ event: 1, createdAt: -1 });
AuthAuditSchema.index({ createdAt: -1 });

const modelName = 'AuthAudit';

export default connection.models[modelName]
  ? connection.models[modelName]
  : connection.model(modelName, AuthAuditSchema, 'auth_audit');
