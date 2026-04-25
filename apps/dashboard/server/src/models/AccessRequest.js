import mongoose from 'mongoose';

const { Schema, connection } = mongoose;

const AccessRequestSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    displayName: { type: String, default: '' },
    message: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'reviewed', 'completed', 'rejected'],
      default: 'pending',
      index: true,
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      transform: (_doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
      },
    },
  }
);

const modelName = 'AccessRequest';

export default connection.models[modelName]
  ? connection.models[modelName]
  : connection.model(modelName, AccessRequestSchema, 'access_requests');
