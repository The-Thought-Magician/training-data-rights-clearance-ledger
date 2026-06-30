// Same-origin relative calls to /api/proxy/* — the proxy route injects X-User-Id.
// Path after /api/proxy/ maps 1:1 to the backend path after /api/v1/.

type Params = Record<string, string | number | boolean | undefined | null>

function qs(params?: Params): string {
  if (!params) return ''
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

async function req(path: string, options?: RequestInit) {
  const res = await fetch(path, options)
  const text = await res.text()
  let data: any = null
  if (text) {
    try { data = JSON.parse(text) } catch { data = text }
  }
  if (!res.ok) {
    const message = (data && (data.error || data.message)) || `Request failed (${res.status})`
    throw new Error(message)
  }
  return data
}

function get(path: string) {
  return req(path)
}

function send(method: string, path: string, body?: unknown) {
  return req(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

const api = {
  // Workspaces / members
  listWorkspaces: () => get('/api/proxy/workspaces'),
  getCurrentWorkspace: () => get('/api/proxy/workspaces/current'),
  createWorkspace: (body: unknown) => send('POST', '/api/proxy/workspaces', body),
  getWorkspace: (id: string) => get(`/api/proxy/workspaces/${id}`),
  updateWorkspace: (id: string, body: unknown) => send('PUT', `/api/proxy/workspaces/${id}`, body),
  listMembers: () => get('/api/proxy/members'),
  addMember: (body: unknown) => send('POST', '/api/proxy/members', body),
  updateMember: (id: string, body: unknown) => send('PUT', `/api/proxy/members/${id}`, body),
  removeMember: (id: string) => send('DELETE', `/api/proxy/members/${id}`),

  // Sources
  listSources: (params?: Params) => get(`/api/proxy/sources${qs(params)}`),
  getSource: (id: string) => get(`/api/proxy/sources/${id}`),
  getSourceFull: (id: string) => get(`/api/proxy/sources/${id}/full`),
  createSource: (body: unknown) => send('POST', '/api/proxy/sources', body),
  updateSource: (id: string, body: unknown) => send('PUT', `/api/proxy/sources/${id}`, body),
  deleteSource: (id: string) => send('DELETE', `/api/proxy/sources/${id}`),
  getProvenance: (id: string) => get(`/api/proxy/sources/${id}/provenance`),
  addProvenance: (id: string, body: unknown) => send('POST', `/api/proxy/sources/${id}/provenance`, body),
  getCustody: (id: string) => get(`/api/proxy/sources/${id}/custody`),
  addCustody: (id: string, body: unknown) => send('POST', `/api/proxy/sources/${id}/custody`, body),

  // Evidence
  listEvidence: (params?: Params) => get(`/api/proxy/evidence${qs(params)}`),
  addEvidence: (body: unknown) => send('POST', '/api/proxy/evidence', body),
  deleteEvidence: (id: string) => send('DELETE', `/api/proxy/evidence/${id}`),

  // Licenses
  listLicenses: (params?: Params) => get(`/api/proxy/licenses${qs(params)}`),
  getLicenseConflicts: () => get('/api/proxy/licenses/conflicts'),
  getExpiringLicenses: () => get('/api/proxy/licenses/expiring'),
  getLicense: (id: string) => get(`/api/proxy/licenses/${id}`),
  createLicense: (body: unknown) => send('POST', '/api/proxy/licenses', body),
  updateLicense: (id: string, body: unknown) => send('PUT', `/api/proxy/licenses/${id}`, body),
  deleteLicense: (id: string) => send('DELETE', `/api/proxy/licenses/${id}`),
  listLicenseTemplates: () => get('/api/proxy/license-templates'),
  createLicenseTemplate: (body: unknown) => send('POST', '/api/proxy/license-templates', body),
  deleteLicenseTemplate: (id: string) => send('DELETE', `/api/proxy/license-templates/${id}`),

  // Copyright screening
  listCopyrightScreenings: (params?: Params) => get(`/api/proxy/copyright-screenings${qs(params)}`),
  getCopyrightScreening: (id: string) => get(`/api/proxy/copyright-screenings/${id}`),
  createCopyrightScreening: (body: unknown) => send('POST', '/api/proxy/copyright-screenings', body),
  updateCopyrightScreening: (id: string, body: unknown) => send('PUT', `/api/proxy/copyright-screenings/${id}`, body),

  // PII screening
  listPiiScreenings: (params?: Params) => get(`/api/proxy/pii-screenings${qs(params)}`),
  getPiiScreening: (id: string) => get(`/api/proxy/pii-screenings/${id}`),
  createPiiScreening: (body: unknown) => send('POST', '/api/proxy/pii-screenings', body),
  updatePiiScreening: (id: string, body: unknown) => send('PUT', `/api/proxy/pii-screenings/${id}`, body),

  // Opt-outs & preference signals
  listOptouts: (params?: Params) => get(`/api/proxy/optouts${qs(params)}`),
  createOptout: (body: unknown) => send('POST', '/api/proxy/optouts', body),
  applyOptout: (id: string) => send('POST', `/api/proxy/optouts/${id}/apply`),
  rejectOptout: (id: string, body: unknown) => send('POST', `/api/proxy/optouts/${id}/reject`, body),
  listPreferenceSignals: (params?: Params) => get(`/api/proxy/preference-signals${qs(params)}`),
  createPreferenceSignal: (body: unknown) => send('POST', '/api/proxy/preference-signals', body),
  deletePreferenceSignal: (id: string) => send('DELETE', `/api/proxy/preference-signals/${id}`),

  // Rights-holders
  listRightsHolders: () => get('/api/proxy/rights-holders'),
  getRightsHolder: (id: string) => get(`/api/proxy/rights-holders/${id}`),
  createRightsHolder: (body: unknown) => send('POST', '/api/proxy/rights-holders', body),
  updateRightsHolder: (id: string, body: unknown) => send('PUT', `/api/proxy/rights-holders/${id}`, body),
  deleteRightsHolder: (id: string) => send('DELETE', `/api/proxy/rights-holders/${id}`),

  // Models & versions
  listModels: () => get('/api/proxy/models'),
  getModel: (id: string) => get(`/api/proxy/models/${id}`),
  createModel: (body: unknown) => send('POST', '/api/proxy/models', body),
  updateModel: (id: string, body: unknown) => send('PUT', `/api/proxy/models/${id}`, body),
  deleteModel: (id: string) => send('DELETE', `/api/proxy/models/${id}`),
  listModelVersions: (params?: Params) => get(`/api/proxy/model-versions${qs(params)}`),
  getModelVersion: (id: string) => get(`/api/proxy/model-versions/${id}`),
  createModelVersion: (body: unknown) => send('POST', '/api/proxy/model-versions', body),
  updateModelVersion: (id: string, body: unknown) => send('PUT', `/api/proxy/model-versions/${id}`, body),
  getReadiness: (id: string) => get(`/api/proxy/model-versions/${id}/readiness`),
  releaseModelVersion: (id: string, body: unknown) => send('POST', `/api/proxy/model-versions/${id}/release`, body),

  // Lineage
  listLineage: (params?: Params) => get(`/api/proxy/lineage${qs(params)}`),
  getSourceModels: (sourceId: string) => get(`/api/proxy/lineage/source/${sourceId}/models`),
  createLineageBinding: (body: unknown) => send('POST', '/api/proxy/lineage', body),
  deleteLineageBinding: (id: string) => send('DELETE', `/api/proxy/lineage/${id}`),

  // Clearance
  getClearanceRequirements: () => get('/api/proxy/clearance/requirements'),
  setClearanceRequirements: (body: unknown) => send('PUT', '/api/proxy/clearance/requirements', body),
  listClearances: (params?: Params) => get(`/api/proxy/clearance${qs(params)}`),
  getSourceClearance: (sourceId: string) => get(`/api/proxy/clearance/source/${sourceId}`),
  evaluateClearance: (sourceId: string) => send('POST', `/api/proxy/clearance/evaluate/${sourceId}`),
  approveClearance: (sourceId: string, body: unknown) => send('POST', `/api/proxy/clearance/approve/${sourceId}`, body),
  overrideClearance: (sourceId: string, body: unknown) => send('POST', `/api/proxy/clearance/override/${sourceId}`, body),
  listCertificates: (params?: Params) => get(`/api/proxy/clearance/certificates${qs(params)}`),

  // Claims
  listClaims: (params?: Params) => get(`/api/proxy/claims${qs(params)}`),
  getClaim: (id: string) => get(`/api/proxy/claims/${id}`),
  createClaim: (body: unknown) => send('POST', '/api/proxy/claims', body),
  updateClaim: (id: string, body: unknown) => send('PUT', `/api/proxy/claims/${id}`, body),
  addClaimImpact: (id: string, body: unknown) => send('POST', `/api/proxy/claims/${id}/impacts`, body),
  updateClaimImpact: (id: string, impactId: string, body: unknown) => send('PUT', `/api/proxy/claims/${id}/impacts/${impactId}`, body),

  // Ledger
  listLedger: (params?: Params) => get(`/api/proxy/ledger${qs(params)}`),
  verifyLedger: () => get('/api/proxy/ledger/verify'),
  getEntityLedger: (entityType: string, entityId: string) => get(`/api/proxy/ledger/entity/${entityType}/${entityId}`),

  // Approvals
  listApprovals: (params?: Params) => get(`/api/proxy/approvals${qs(params)}`),
  getMyApprovals: () => get('/api/proxy/approvals/mine'),
  getApproval: (id: string) => get(`/api/proxy/approvals/${id}`),
  createApproval: (body: unknown) => send('POST', '/api/proxy/approvals', body),
  decideApproval: (id: string, body: unknown) => send('POST', `/api/proxy/approvals/${id}/decide`, body),

  // Policies
  listPolicies: () => get('/api/proxy/policies'),
  createPolicy: (body: unknown) => send('POST', '/api/proxy/policies', body),
  updatePolicy: (id: string, body: unknown) => send('PUT', `/api/proxy/policies/${id}`, body),
  deletePolicy: (id: string) => send('DELETE', `/api/proxy/policies/${id}`),
  evaluatePolicies: (sourceId: string) => send('POST', `/api/proxy/policies/evaluate/${sourceId}`),
  listPolicyViolations: (params?: Params) => get(`/api/proxy/policies/violations${qs(params)}`),

  // Risk
  listRiskScores: () => get('/api/proxy/risk'),
  getSourceRisk: (sourceId: string) => get(`/api/proxy/risk/source/${sourceId}`),
  recomputeRisk: (sourceId: string) => send('POST', `/api/proxy/risk/recompute/${sourceId}`),
  getRiskDashboard: () => get('/api/proxy/risk/dashboard'),

  // Activity
  listActivity: (params?: Params) => get(`/api/proxy/activity${qs(params)}`),
  getEntityActivity: (entityType: string, entityId: string) => get(`/api/proxy/activity/entity/${entityType}/${entityId}`),

  // Notifications & tasks
  listNotifications: () => get('/api/proxy/notifications'),
  markNotificationRead: (id: string) => send('POST', `/api/proxy/notifications/${id}/read`),
  markAllNotificationsRead: () => send('POST', '/api/proxy/notifications/read-all'),
  listTasks: (params?: Params) => get(`/api/proxy/tasks${qs(params)}`),
  createTask: (body: unknown) => send('POST', '/api/proxy/tasks', body),
  updateTask: (id: string, body: unknown) => send('PUT', `/api/proxy/tasks/${id}`, body),

  // Documentation packs
  listDocumentationPacks: (params?: Params) => get(`/api/proxy/documentation-packs${qs(params)}`),
  getDocumentationPack: (id: string) => get(`/api/proxy/documentation-packs/${id}`),
  generateDocumentationPack: (body: unknown) => send('POST', '/api/proxy/documentation-packs/generate', body),

  // Reports
  getClearanceThroughput: () => get('/api/proxy/reports/clearance-throughput'),
  getCoverage: () => get('/api/proxy/reports/coverage'),
  getClaimsSummary: () => get('/api/proxy/reports/claims-summary'),

  // Seed
  seedDemo: () => send('POST', '/api/proxy/seed/demo'),
  resetDemo: () => send('POST', '/api/proxy/seed/reset'),

  // Billing
  getBillingPlan: () => get('/api/proxy/billing/plan'),
  startCheckout: () => send('POST', '/api/proxy/billing/checkout'),
  openPortal: () => send('POST', '/api/proxy/billing/portal'),
}

export default api
