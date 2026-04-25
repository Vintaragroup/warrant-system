import { ROLE_PERMISSIONS } from '../../lib/roles.js';

function toPermissionList(permission) {
  if (Array.isArray(permission)) {
    return permission.map((item) => String(item)).filter(Boolean);
  }
  return [String(permission)];
}

function flattenPermissions(roles = []) {
  return roles.reduce((acc, role) => {
    const grants = ROLE_PERMISSIONS[role] || [];
    if (Array.isArray(grants)) acc.push(...grants);
    return acc;
  }, []);
}

function hasDepartmentScopedAccess(perms = []) {
  return perms.some((perm) => typeof perm === 'string' && perm.endsWith(':department'));
}

function hasGlobalAccess(perms = []) {
  return perms.some((perm) => {
    if (perm === '*') return true;
    if (typeof perm !== 'string') return false;
    return !perm.includes(':department') && !perm.endsWith(':self');
  });
}

export function assertPermission(req, permission) {
  const roles = req.user?.roles || [];
  if (!roles.length) {
    const err = new Error('Forbidden');
    err.statusCode = 403;
    throw err;
  }

  const required = toPermissionList(permission);
  const granted = flattenPermissions(roles);

  const allowed = granted.includes('*') || required.some((needed) => granted.includes(needed));

  if (!allowed) {
    const err = new Error('Forbidden');
    err.statusCode = 403;
    throw err;
  }

  return true;
}

export function hasPermission(req, permission) {
  const roles = req.user?.roles || [];
  if (!roles.length) return false;
  const granted = flattenPermissions(roles);
  const required = toPermissionList(permission);
  if (granted.includes('*')) return true;
  return required.some((needed) => granted.includes(needed));
}

function ensureDepartmentAssignment(departments = []) {
  if (departments.length) return;
  const err = new Error('Department access requires assignment');
  err.statusCode = 403;
  throw err;
}

function cloneQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  return { ...query };
}

export function filterByDepartment(query = {}, req, fields = ['department'], options = {}) {
  const fieldList = Array.isArray(fields) ? fields.filter(Boolean) : [fields].filter(Boolean);
  const roles = req.user?.roles || [];
  const departments = Array.isArray(req.user?.departments) ? req.user.departments.filter(Boolean) : [];
  const counties = Array.isArray(req.user?.counties) ? req.user.counties.filter(Boolean) : [];
  const granted = flattenPermissions(roles);

  const scopedAccess = hasDepartmentScopedAccess(granted);
  const globalAccess = hasGlobalAccess(granted);

  if (!scopedAccess || globalAccess || !fieldList.length) {
    return cloneQuery(query);
  }

  const scopeValues = departments.length ? departments : counties;
  ensureDepartmentAssignment(scopeValues);

  const { includeUnassigned = false } = options;
  const scopeClauses = [];

  fieldList.forEach((field) => {
    scopeClauses.push({ [field]: { $in: scopeValues } });
    if (includeUnassigned) {
      scopeClauses.push({ [field]: { $in: ['', null] } });
      scopeClauses.push({ [field]: { $exists: false } });
    }
  });

  const clauses = [];
  const baseFilter = cloneQuery(query);
  if (Object.keys(baseFilter).length) {
    clauses.push(baseFilter);
  }
  clauses.push({ $or: scopeClauses });

  if (clauses.length === 1) {
    return clauses[0];
  }

  return { $and: clauses };
}
