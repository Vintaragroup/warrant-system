import mongoose from 'mongoose';

const { Schema, connection } = mongoose;

const UserSchema = new Schema(
  {
    uid: { type: String, required: true, unique: true, index: true },
    email: { type: String, lowercase: true, trim: true, index: true },
    emailVerified: { type: Boolean, default: false },
    displayName: { type: String, default: '' },
    // For development: default to Admin; for production, should be ['BondClient'] or user-assigned
    roles: { type: [String], default: () => (process.env.NODE_ENV === 'development' ? ['Admin'] : ['BondClient']) },
    departments: { type: [String], default: [] },
    counties: { type: [String], default: [] },
    status: {
      type: String,
      enum: ['active', 'suspended', 'invited', 'pending_mfa', 'deleted'],
      default: 'active',
    },
    mfaEnforced: { type: Boolean, default: false },
    lastLoginAt: { type: Date },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    invitedAt: { type: Date },
    lastRoleChangeAt: { type: Date },
    termsAcceptedAt: { type: Date },
    privacyNoticeAcceptedAt: { type: Date },
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
    toObject: { versionKey: false },
  }
);

UserSchema.index({ email: 1 }, { unique: true, sparse: true, name: 'email_unique' });
UserSchema.index({ roles: 1, status: 1 }, { name: 'roles_status_idx' });

const modelName = 'User';

export default connection.models[modelName]
  ? connection.models[modelName]
  : connection.model(modelName, UserSchema, 'users');
