import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/routes/utils/authz.js', () => ({
  assertPermission: () => {},
  filterByDepartment: (q) => q,
  hasPermission: () => true,
}));

let CrmOverlayModel;
let CaseEnrichmentModel;
let findRawCaseDocForAccessCheck;
let mockProvider;

// Mock mongoose connection to bypass ensureMongoConnected()
vi.mock('mongoose', () => {
  class FakeObjectId {
    constructor(v) { this.value = v; }
    toString() { return String(this.value); }
  }
  class FakeSchema {
    static Types = { ObjectId: FakeObjectId, Mixed: Object };
    constructor(def) { this.def = def; this._virtuals = new Map(); this.methods = {}; this._indexes = []; }
    virtual(name) { const v = { get: () => v, set: () => v }; this._virtuals.set(name, v); return v; }
    pre() { return this; }
    index(spec) { this._indexes.push(spec); return this; }
  }
  const model = () => ({ findOne: vi.fn(), aggregate: vi.fn(), create: vi.fn() });
  return {
    default: {
      connection: { readyState: 1, modelNames: () => [], model, db: { collection: () => ({ findOne: vi.fn() }) } },
      Types: { ObjectId: FakeObjectId },
      Schema: FakeSchema,
      model,
    },
  };
});

// Real models/Case.js is left unmocked — it only defines sub-schemas
// (ChecklistItemSchema/AttachmentSchema) that CrmOverlay.js imports, and
// building those against the fake mongoose above is harmless. Nothing in
// routes/cases.js touches the Case model directly anymore.

vi.mock('../src/models/CrmOverlay.js', async () => {
  const findOne = vi.fn();
  const findOneAndUpdate = vi.fn(() => ({ lean: () => ({ exec: () => Promise.resolve({ caseId: '507f1f77bcf86cd799439011', crm_details: {} }) }) }));
  const find = vi.fn(() => ({ lean: () => Promise.resolve([]) }));
  CrmOverlayModel = { findOne, findOneAndUpdate, find };
  return { default: CrmOverlayModel };
});

vi.mock('../src/routes/utils/caseAccess.js', () => {
  findRawCaseDocForAccessCheck = vi.fn();
  return {
    COUNTY_COLLECTIONS: ['simple_harris', 'simple_jefferson'],
    V2_COUNTY_COLLECTIONS: ['v2_harris_reports'],
    ALL_CASE_COLLECTIONS: ['simple_harris', 'simple_jefferson', 'v2_harris_reports'],
    CASE_SCOPE_FIELDS: ['county'],
    scopedCaseFilter: (req, filter) => filter,
    findRawCaseDocForAccessCheck,
  };
});

vi.mock('../src/models/CaseEnrichment.js', async () => {
  const create = vi.fn();
  const findOne = vi.fn();
  CaseEnrichmentModel = { create, findOne };
  return { default: CaseEnrichmentModel };
});

vi.mock('../src/lib/enrichment/registry.js', () => {
  mockProvider = {
    id: 'whitepages',
    label: 'Whitepages',
    ttlMinutes: 60,
    errorTtlMinutes: 15,
    supportsForce: false,
    search: vi.fn(async () => ({
      status: 'success',
      candidates: [
        {
          recordId: 'cand1',
          fullName: 'John Doe',
          score: 0.9,
          contacts: [{ type: 'phone', value: '+1-555-0100' }],
          addresses: [{ streetLine1: '1 Main', city: 'Houston', stateCode: 'TX', postalCode: '77001' }],
        },
      ],
    })),
  };

  return {
    listProviders: vi.fn(() => [mockProvider]),
    getProvider: vi.fn((id) => (id === mockProvider.id ? mockProvider : null)),
    getDefaultProviderId: vi.fn(() => mockProvider.id),
  };
});

const { default: buildRouter } = await import('../src/routes/cases.js');
import express from 'express';
import request from 'supertest';

function makeApp() {
  const app = express();
  app.use(express.json());
  // inject fake auth
  app.use((req, _res, next) => { req.user = { uid: 'u1', roles: ['cases:read','cases:write','cases:enrich'] }; next(); });
  app.use('/cases', buildRouter);
  return app;
}

const CASE_ID = '507f1f77bcf86cd799439011';

describe('Cases CRM + Enrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('PATCH /cases/:id/crm updates phone and address via CrmOverlay, keyed by caseId', async () => {
    findRawCaseDocForAccessCheck.mockResolvedValue({
      doc: { _id: CASE_ID, county: 'harris' },
      collection: 'v2_harris_reports',
    });
    CrmOverlayModel.findOne.mockReturnValue({ lean: () => Promise.resolve(null) });
    CrmOverlayModel.findOneAndUpdate.mockReturnValue({
      lean: () => Promise.resolve({ caseId: CASE_ID, crm_stage: 'new', crm_details: { phone: '+1-555-0111', address: { city: 'Houston' } } }),
    });

    const app = makeApp();
    const res = await request(app)
      .patch(`/cases/${CASE_ID}/crm`)
      .send({ phone: '+1-555-0111', address: { city: 'Houston', stateCode: 'TX', postalCode: '77001' } });

    expect(res.status).toBeLessThan(400);
    expect(CrmOverlayModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: expect.anything() }),
      expect.objectContaining({
        $set: expect.objectContaining({
          'crm_details.phone': '+1-555-0111',
          'crm_details.address': expect.objectContaining({ city: 'Houston' }),
        }),
      }),
      expect.objectContaining({ upsert: true, new: true })
    );
  });

  it('PATCH /cases/:id/crm 404s when the case does not exist in any source collection', async () => {
    findRawCaseDocForAccessCheck.mockResolvedValue(null);

    const app = makeApp();
    const res = await request(app)
      .patch(`/cases/${CASE_ID}/crm`)
      .send({ phone: '+1-555-0111' });

    expect(res.status).toBe(404);
    expect(CrmOverlayModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('PATCH /cases/:id/stage is idempotent — no write/audit when the stage is unchanged', async () => {
    findRawCaseDocForAccessCheck.mockResolvedValue({
      doc: { _id: CASE_ID, county: 'harris' },
      collection: 'v2_harris_reports',
    });
    CrmOverlayModel.findOne.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve({ crm_stage: 'contacted' }) }),
    });

    const app = makeApp();
    const res = await request(app)
      .patch(`/cases/${CASE_ID}/stage`)
      .send({ stage: 'contacted' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ crm_stage: 'contacted' });
    expect(CrmOverlayModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('Enrichment latest/run/select flow', async () => {
    const caseId = CASE_ID;
    findRawCaseDocForAccessCheck.mockResolvedValue({
      doc: { _id: caseId, full_name: 'John Doe', county: 'harris' },
      collection: 'v2_harris_reports',
    });

    // latest: none
    CaseEnrichmentModel.findOne
      .mockResolvedValueOnce(null) // for GET latest
      .mockResolvedValueOnce(null) // for POST run: latest cache check
      .mockResolvedValueOnce({     // for POST select: latest enrichment with candidates
        _id: 'enr1',
        provider: 'whitepages',
        candidates: [{ recordId: 'cand1' }],
        selectedRecords: [],
        save: vi.fn().mockResolvedValue(undefined),
        toObject() { return { id: 'enr1', provider: 'whitepages', candidates: [{ recordId: 'cand1' }], selectedRecords: [] }; },
      });

    CaseEnrichmentModel.create.mockResolvedValue({
      toObject() { return { id: 'enr1', provider: 'whitepages', status: 'ok', candidates: [{ recordId: 'cand1' }], params: { fullName: 'John Doe' } }; },
      candidates: [{ recordId: 'cand1' }],
    });

    const app = makeApp();

    const providersRes = await request(app).get('/cases/enrichment/providers');
    expect(providersRes.status).toBe(200);
    expect(providersRes.body.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'whitepages', default: true }),
    ]));

    const latest = await request(app).get(`/cases/${caseId}/enrichment/whitepages`);
    expect(latest.status).toBe(200);
    expect(latest.body).toEqual({ enrichment: null, cached: false, nextRefreshAt: null });

    const run = await request(app).post(`/cases/${caseId}/enrichment/whitepages`).send({});
    expect(run.status).toBe(200);
    expect(mockProvider.search).toHaveBeenCalled();
    expect(run.body.enrichment).toBeTruthy();

    const select = await request(app).post(`/cases/${caseId}/enrichment/whitepages/select`).send({ recordId: 'cand1' });
    expect(select.status).toBe(200);
  });
});
