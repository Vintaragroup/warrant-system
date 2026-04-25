"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.InmateModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const InmateSchema = new mongoose_1.Schema({
    // flexible schema: allow unknown fields, but index a few
    spn: { type: String, index: true },
    subject_id: { type: String, index: true },
    subjectId: { type: String, index: true },
    first_name: String,
    middle_name: String,
    last_name: String,
    age: Number,
    dob: mongoose_1.Schema.Types.Mixed,
    city: String,
    state: String,
    county: { type: String, index: true },
    enrichment_flag: { type: Boolean, default: false, index: true },
    enrichment_status: {
        type: String,
        enum: ['NEW', 'READY', 'RUNNING', 'PARTIAL', 'FAILED', 'SUCCEEDED', 'CANCELLED'],
        default: 'NEW',
        index: true,
    },
    enrichment_last_run_at: { type: Date, index: true },
    // candidate timestamps for filtering window
    scraped_at: Date,
    _ingested_at: Date,
    fetched_at: Date,
    migrated_at: Date,
    first_seen_at: Date,
    inserted_at: Date,
    detail_fetched_at: Date,
    facts: {
        phones: [String],
        addresses: [String],
        emails: [String],
        usernames: [String],
        user_ids: [String],
    },
}, { strict: false, timestamps: true });
exports.InmateModel = mongoose_1.default.models.inmates || mongoose_1.default.model('inmates', InmateSchema, 'inmates');
//# sourceMappingURL=inmate.js.map