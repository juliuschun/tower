import { Router } from 'express';
import {
  createUser, adminMiddleware, listUsers, updateUserRole, updateUserPath,
  resetUserPassword, disableUser,
} from '../services/auth.js';
import { loadModelsFile, saveModelsFile, reloadModels } from '../config.js';
import { broadcast } from './ws-handler.js';
import {
  listAccounts, addAccount, updateAccount, removeAccount,
  assignAccountToProject, getProjectAccountId,
} from '../services/credential-store.js';
import { listSystemPrompts, upsertSystemPrompt, deleteSystemPrompt } from '../services/system-prompt.js';
import {
  listGroups, createGroup, updateGroup, deleteGroup,
  addUserToGroup, removeUserFromGroup,
} from '../services/group-manager.js';
import {
  getCustomers, getCustomer, getFleetStatus, getVMStatus,
  checkWorkspace, getLogs, remoteExec,
} from '../services/fleet-manager.js';

const router = Router();

// All admin routes require adminMiddleware (applied per-route)

// ───── Admin: Models ─────

router.get('/admin/models', adminMiddleware, (_req, res) => {
  res.json(loadModelsFile());
});

router.put('/admin/models', adminMiddleware, (req, res) => {
  try {
    const data = req.body;
    if (!data.claude || !data.pi) return res.status(400).json({ error: 'claude and pi arrays required' });
    saveModelsFile(data);
    const reloaded = reloadModels();
    // Broadcast updated model list to all connected clients
    broadcast({ type: 'config_update', models: reloaded.claude, piModels: reloaded.pi, localModels: reloaded.local, defaults: reloaded.defaults });
    res.json({ ok: true, ...reloaded });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ───── Admin: Claude Accounts (credential rotation) ─────

router.get('/admin/claude-accounts', adminMiddleware, async (_req, res) => {
  try {
    res.json(await listAccounts());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/claude-accounts', adminMiddleware, async (req, res) => {
  const { id, label, configDir, tier, isDefault } = req.body;
  if (!id || !label || !configDir) {
    return res.status(400).json({ error: 'id, label, and configDir are required' });
  }
  try {
    const account = await addAccount({ id, label, configDir, tier, isDefault });
    res.json(account);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE') || err.message?.includes('unique') || err.message?.includes('duplicate')) {
      return res.status(409).json({ error: 'Account ID or configDir already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.put('/admin/claude-accounts/:id', adminMiddleware, async (req, res) => {
  const { label, configDir, tier, isDefault, enabled } = req.body;
  try {
    const updated = await updateAccount(req.params.id as string, { label, configDir, tier, isDefault, enabled });
    if (!updated) return res.status(404).json({ error: 'Account not found' });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/admin/claude-accounts/:id', adminMiddleware, async (req, res) => {
  try {
    const ok = await removeAccount(req.params.id as string);
    if (!ok) return res.status(404).json({ error: 'Account not found' });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Assign account to project
router.put('/admin/projects/:projectId/claude-account', adminMiddleware, async (req, res) => {
  const { accountId } = req.body; // null to unassign
  try {
    await assignAccountToProject(req.params.projectId as string, accountId);
    res.json({ ok: true, projectId: req.params.projectId, accountId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/projects/:projectId/claude-account', adminMiddleware, async (req, res) => {
  try {
    const accountId = await getProjectAccountId(req.params.projectId as string);
    res.json({ projectId: req.params.projectId, accountId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ───── Admin: System Prompts ─────

router.get('/admin/system-prompts', adminMiddleware, async (_req, res) => {
  res.json(await listSystemPrompts());
});

router.put('/admin/system-prompts/:name', adminMiddleware, async (req, res) => {
  const name = req.params.name as string;
  const { prompt } = req.body;
  if (!prompt && prompt !== '') return res.status(400).json({ error: 'prompt is required' });
  const result = await upsertSystemPrompt(name, prompt);
  res.json(result);
});

router.delete('/admin/system-prompts/:name', adminMiddleware, async (req, res) => {
  const name = req.params.name as string;
  const ok = await deleteSystemPrompt(name);
  if (!ok) return res.status(400).json({ error: 'Cannot delete the default prompt' });
  res.json({ ok: true });
});

// ───── Admin: User Management ─────
router.get('/admin/users', adminMiddleware, async (_req, res) => {
  res.json(await listUsers());
});

router.post('/admin/users', adminMiddleware, async (req, res) => {
  const { username, password, role, allowed_path } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  try {
    const user = await createUser(username, password, role || 'member');
    if (allowed_path !== undefined) await updateUserPath(user.id, allowed_path);
    res.json({ ...user, allowed_path: allowed_path || '' });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Username already exists' });
    res.status(500).json({ error: error.message });
  }
});

router.patch('/admin/users/:id', adminMiddleware, async (req, res) => {
  const userId = parseInt(req.params.id as string);
  const currentUser = (req as any).user;
  const { role, allowed_path } = req.body;
  if (role !== undefined) {
    if (currentUser.userId === userId) return res.status(403).json({ error: 'Cannot change own role' });
    await updateUserRole(userId, role);
  }
  if (allowed_path !== undefined) await updateUserPath(userId, allowed_path);
  res.json({ ok: true });
});

router.patch('/admin/users/:id/password', adminMiddleware, async (req, res) => {
  const userId = parseInt(req.params.id as string);
  const { password } = req.body;
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  await resetUserPassword(userId, password);
  res.json({ ok: true });
});

router.delete('/admin/users/:id', adminMiddleware, async (req, res) => {
  const userId = parseInt(req.params.id as string);
  const currentUser = (req as any).user;
  if (currentUser.userId === userId) return res.status(403).json({ error: 'Cannot delete yourself' });
  await disableUser(userId);
  res.json({ ok: true });
});

// ───── Admin: Groups ─────
router.get('/admin/groups', adminMiddleware, async (_req, res) => {
  res.json(await listGroups());
});

router.post('/admin/groups', adminMiddleware, async (req, res) => {
  try {
    const { name, description, isGlobal } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });
    const group = await createGroup(name.trim(), description, isGlobal);
    res.json(group);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Group name already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.patch('/admin/groups/:id', adminMiddleware, async (req, res) => {
  try {
    const groupId = parseInt(req.params.id as string);
    const group = await updateGroup(groupId, req.body);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    res.json(group);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Group name already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/admin/groups/:id', adminMiddleware, async (req, res) => {
  const ok = await deleteGroup(parseInt(req.params.id as string));
  if (!ok) return res.status(404).json({ error: 'Group not found' });
  res.json({ ok: true });
});

router.post('/admin/groups/:id/users', adminMiddleware, async (req, res) => {
  const groupId = parseInt(req.params.id as string);
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  await addUserToGroup(userId, groupId);
  res.json({ ok: true });
});

router.delete('/admin/groups/:id/users/:uid', adminMiddleware, async (req, res) => {
  const groupId = parseInt(req.params.id as string);
  const userId = parseInt(req.params.uid as string);
  await removeUserFromGroup(userId, groupId);
  res.json({ ok: true });
});

// ───── Fleet Management (admin-only, internal) ─────

// List all customers
router.get('/admin/fleet', adminMiddleware, async (_req, res) => {
  try {
    const customers = await getCustomers();
    res.json(customers);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Full fleet status (SSHs into all VMs)
router.get('/admin/fleet/status', adminMiddleware, async (_req, res) => {
  try {
    const status = await getFleetStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Single customer status
router.get('/admin/fleet/:customer/status', adminMiddleware, async (req, res) => {
  try {
    const info = await getCustomer(req.params.customer as string);
    if (!info) return res.status(404).json({ error: 'Customer not found' });
    const status = await getVMStatus(info);
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Workspace health check
router.get('/admin/fleet/:customer/workspace', adminMiddleware, async (req, res) => {
  try {
    const info = await getCustomer(req.params.customer as string);
    if (!info) return res.status(404).json({ error: 'Customer not found' });
    const check = await checkWorkspace(info);
    res.json(check);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Logs
router.get('/admin/fleet/:customer/logs', adminMiddleware, async (req, res) => {
  try {
    const info = await getCustomer(req.params.customer as string);
    if (!info) return res.status(404).json({ error: 'Customer not found' });
    const lines = parseInt(req.query.lines as string) || 30;
    const logs = await getLogs(info, Math.min(lines, 200));
    res.json({ logs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Remote command execution
router.post('/admin/fleet/:customer/exec', adminMiddleware, async (req, res) => {
  try {
    const info = await getCustomer(req.params.customer as string);
    if (!info) return res.status(404).json({ error: 'Customer not found' });
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'command required' });
    const output = await remoteExec(info, command);
    res.json({ output });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
