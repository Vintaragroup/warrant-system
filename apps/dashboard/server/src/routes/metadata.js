import express from 'express';
import { ROLE_PERMISSIONS } from '../lib/roles.js';

const router = express.Router();

const FALLBACK_COUNTIES = ['brazoria', 'fortbend', 'galveston', 'harris', 'jefferson'];

function parseList(value, fallback = []) {
  if (!value) return fallback;
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const configuredCounties = parseList(process.env.AVAILABLE_COUNTIES, FALLBACK_COUNTIES);
const configuredDepartments = parseList(process.env.AVAILABLE_DEPARTMENTS, []);
const configuredRoles = Object.keys(ROLE_PERMISSIONS);

router.get('/', (_req, res) => {
  res.json({
    counties: configuredCounties,
    departments: configuredDepartments,
    roles: configuredRoles,
  });
});

export default router;
