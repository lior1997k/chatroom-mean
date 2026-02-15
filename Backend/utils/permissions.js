const ROLE_ORDER = {
  user: 1,
  moderator: 2,
  support: 3,
  admin: 4
};

const CAPABILITIES = {
  access_admin_console: ['moderator', 'support', 'admin'],
  moderate_messages: ['moderator', 'support', 'admin'],
  moderate_reports: ['moderator', 'support', 'admin'],
  manage_user_security: ['moderator', 'support', 'admin'],
  manage_roles: ['admin']
};

function normalizeRole(role) {
  const next = String(role || '').trim().toLowerCase();
  return ROLE_ORDER[next] ? next : 'user';
}

function hasCapability(role, capability) {
  const normalizedRole = normalizeRole(role);
  const allowed = CAPABILITIES[String(capability || '').trim().toLowerCase()] || [];
  return allowed.includes(normalizedRole);
}

function roleRank(role) {
  return ROLE_ORDER[normalizeRole(role)] || 0;
}

function canActOnTargetRole(actorRole, targetRole) {
  const actor = normalizeRole(actorRole);
  const target = normalizeRole(targetRole);
  if (actor === 'admin') return true;
  if (actor === 'support') return target === 'user' || target === 'moderator';
  if (actor === 'moderator') return target === 'user';
  return false;
}

module.exports = {
  normalizeRole,
  hasCapability,
  roleRank,
  canActOnTargetRole
};
