import { Router } from 'express';
import { authMiddleware } from '../services/auth.js';
import {
  getSchedules, getSchedule, createSchedule, updateSchedule, deleteSchedule,
  getScheduleRuns, runScheduleNow,
} from '../services/unified-scheduler.js';
import {
  getAutomations, getAutomation, createAutomation, updateAutomation,
  deleteAutomation, restoreAutomation, permanentlyDeleteAutomation,
  getChildAutomations, reorderAutomations, getArchivedAutomations,
  getAutomationRuns, getDistinctCwds as getAutomationCwds,
  getTemplates, createFromTemplate,
  type AutomationFilters,
} from '../services/automation-manager.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════
// Unified Schedules
// ═══════════════════════════════════════════════════════════════

router.get('/schedules', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });
    const schedules = await getSchedules(userId);
    res.json(schedules);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/schedules/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id as string;
    const schedule = await getSchedule(id);
    if (!schedule) return res.status(404).json({ error: 'not found' });
    res.json(schedule);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/schedules', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });

    const { name, prompt, model, mode, targetId, triggerType, cronConfig, onceAt, projectId } = req.body;
    if (!name || !prompt) return res.status(400).json({ error: 'name and prompt required' });
    if (!['spawn', 'inject', 'channel'].includes(mode || 'spawn')) {
      return res.status(400).json({ error: 'mode must be spawn, inject, or channel' });
    }

    const schedule = await createSchedule({
      userId,
      projectId,
      name,
      prompt,
      model,
      mode: mode || 'spawn',
      targetId,
      triggerType: triggerType || 'cron',
      cronConfig,
      onceAt,
    });
    res.json(schedule);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch('/schedules/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id as string;
    const existing = await getSchedule(id);
    if (!existing) return res.status(404).json({ error: 'not found' });

    const userId = (req as any).user?.userId;
    if (existing.userId !== userId) return res.status(403).json({ error: 'forbidden' });

    const schedule = await updateSchedule(id, req.body);
    res.json(schedule);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/schedules/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id as string;
    const existing = await getSchedule(id);
    if (!existing) return res.status(404).json({ error: 'not found' });

    const userId = (req as any).user?.userId;
    if (existing.userId !== userId) return res.status(403).json({ error: 'forbidden' });

    await deleteSchedule(id);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/schedules/:id/run-now', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id as string;
    const existing = await getSchedule(id);
    if (!existing) return res.status(404).json({ error: 'not found' });

    const userId = (req as any).user?.userId;
    if (existing.userId !== userId) return res.status(403).json({ error: 'forbidden' });

    const result = await runScheduleNow(id);
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/schedules/:id/runs', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id as string;
    const limit = parseInt(req.query.limit as string) || 20;
    const runs = await getScheduleRuns(id, Math.min(limit, 100));
    res.json(runs);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════
// Automations — Tasks + Schedules 통합 API
// ═══════════════════════════════════════════════════════════════

// List automations (with filters)
router.get('/automations', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });

    const filters: AutomationFilters = {};
    if (req.query.status) {
      const s = req.query.status as string;
      filters.status = s.includes(',') ? s.split(',') as any : s as any;
    }
    if (req.query.trigger) filters.triggerType = req.query.trigger as any;
    if (req.query.project) filters.projectId = req.query.project as string;
    if (req.query.mode) filters.mode = req.query.mode as any;
    if (req.query.includeArchived === 'true') filters.includeArchived = true;

    const automations = await getAutomations(userId, role, filters);
    res.json(automations);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// CWD metadata
router.get('/automations/meta', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const cwds = await getAutomationCwds(userId);
    res.json({ cwds });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Templates
router.get('/automations/templates', authMiddleware, async (_req, res) => {
  try {
    res.json(getTemplates());
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Create from template
router.post('/automations/from-template', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });
    const { templateId, ...overrides } = req.body;
    if (!templateId) return res.status(400).json({ error: 'templateId required' });

    const automation = await createFromTemplate(templateId, userId, overrides);
    res.json(automation);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Get one
router.get('/automations/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id as string;
    const automation = await getAutomation(id);
    if (!automation) return res.status(404).json({ error: 'not found' });
    res.json(automation);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Create
router.post('/automations', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });

    const { name, prompt, description, model, workflow, mode, targetId, cwd,
            triggerType, cronConfig, onceAt, parentId, projectId,
            roomId, triggeredBy, roomMessageId } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    const automation = await createAutomation({
      userId, projectId, name, description, prompt: prompt || '',
      model, workflow, mode, targetId, cwd,
      triggerType, cronConfig, onceAt, parentId,
      roomId, triggeredBy, roomMessageId,
    });
    res.json(automation);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Update
router.patch('/automations/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id as string;
    const existing = await getAutomation(id);
    if (!existing) return res.status(404).json({ error: 'not found' });

    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    if (existing.userId !== userId && role !== 'admin') {
      return res.status(403).json({ error: 'forbidden' });
    }

    const automation = await updateAutomation(id, req.body);
    res.json(automation);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Delete (soft)
router.delete('/automations/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id as string;
    const existing = await getAutomation(id);
    if (!existing) return res.status(404).json({ error: 'not found' });

    const userId = (req as any).user?.userId;
    const role = (req as any).user?.role;
    if (existing.userId !== userId && role !== 'admin') {
      return res.status(403).json({ error: 'forbidden' });
    }

    await deleteAutomation(id);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Permanently delete
router.delete('/automations/:id/permanent', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id as string;
    await permanentlyDeleteAutomation(id);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Restore from archive
router.post('/automations/:id/restore', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id as string;
    const ok = await restoreAutomation(id);
    res.json({ success: ok });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Child automations
router.get('/automations/:id/children', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id as string;
    const children = await getChildAutomations(id);
    res.json(children);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Run history
router.get('/automations/:id/runs', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id as string;
    const limit = parseInt(req.query.limit as string) || 20;
    const runs = await getAutomationRuns(id, Math.min(limit, 100));
    res.json(runs);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Reorder (kanban drag-drop)
router.post('/automations/reorder', authMiddleware, async (req, res) => {
  try {
    const { taskIds, status } = req.body;
    if (!Array.isArray(taskIds) || !status) {
      return res.status(400).json({ error: 'taskIds array and status required' });
    }
    await reorderAutomations(taskIds, status);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Archived
router.get('/automations/archived', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const archived = await getArchivedAutomations(userId);
    res.json(archived);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════
// Proactive Agent — AI가 먼저 말을 거는 시스템
// ═══════════════════════════════════════════════════════════════

router.post('/proactive/fire', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const userRole = (req as any).user?.role;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });
    if (userRole !== 'admin') return res.status(403).json({ error: 'admin only (phase 1)' });

    const { templateName, prompt, context, projectId, model, targetSessionId } = req.body;
    if (!templateName || !prompt) {
      return res.status(400).json({ error: 'templateName and prompt are required' });
    }

    const { fireProactive } = await import('../services/proactive-agent.js');

    const template = {
      id: `manual-${Date.now()}`,
      name: templateName,
      prompt,
      model: model || undefined,
      projectId: projectId || undefined,
    };

    const result = await fireProactive(
      userId,
      template,
      context ? { summary: context } : undefined,
      targetSessionId ? { targetSessionId } : undefined,
    );

    res.json(result);
  } catch (err: any) {
    console.error('[proactive] Fire error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
