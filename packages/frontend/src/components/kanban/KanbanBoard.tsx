import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { useKanbanStore, type TaskMeta } from '../../stores/kanban-store';
import { useSessionStore } from '../../stores/session-store';
import { useProjectStore } from '../../stores/project-store';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import { NewTaskModal } from './NewTaskModal';
import { SchedulePopover } from './SchedulePopover';

const COLUMN_DEFS: { id: TaskMeta['status']; titleKey: string; color: string }[] = [
  { id: 'todo', titleKey: 'todo', color: 'text-gray-400' },
  { id: 'in_progress', titleKey: 'inProgress', color: 'text-blue-400' },
  { id: 'done', titleKey: 'done', color: 'text-green-400' },
];

export function KanbanBoard() {
  const { t } = useTranslation('kanban');
  const { tasks, setTasks, setLoading } = useKanbanStore();
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeProjectId = sessions.find((s) => s.id === activeSessionId)?.projectId ?? null;
  const projects = useProjectStore((s) => s.projects);
  const [activeTask, setActiveTask] = useState<TaskMeta | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskMeta | null>(null);
  const [scheduleTaskId, setScheduleTaskId] = useState<string | null>(null);
  const [filterProjectId, setFilterProjectId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  const activeProjects = useMemo(() => projects.filter(p => !p.archived), [projects]);

  // Load tasks on mount
  useEffect(() => {
    loadTasks();
  }, []);

  const loadTasks = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/tasks', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTasks(data);
      }
    } catch (err) {
      console.error('Failed to load tasks:', err);
    } finally {
      setLoading(false);
    }
  };

  // Apply project filter
  const filteredTasks = useMemo(() => {
    if (!filterProjectId) return tasks;
    return tasks.filter(t => t.projectId === filterProjectId);
  }, [tasks, filterProjectId]);

  const getTasksByStatus = (status: TaskMeta['status']) => {
    const statusTasks = filteredTasks.filter((t) =>
      status === 'done' ? t.status === 'done' || t.status === 'failed' : t.status === status
    );
    if (status === 'done') {
      // Done column: most recent first (by completedAt, then updatedAt)
      return statusTasks.sort((a, b) => {
        const aTime = a.completedAt || a.updatedAt;
        const bTime = b.completedAt || b.updatedAt;
        return bTime.localeCompare(aTime);
      });
    }
    return statusTasks.sort((a, b) => a.sortOrder - b.sortOrder);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find((t) => t.id === event.active.id);
    if (task) setActiveTask(task);
  };

  // Track which column the drag is currently over (fallback for dragEnd)
  const [overColumnId, setOverColumnId] = useState<string | null>(null);

  const resolveTargetColumn = (overId: string | number): TaskMeta['status'] | null => {
    const columnIds = new Set<string>(COLUMN_DEFS.map((c) => c.id));
    const id = String(overId);
    if (columnIds.has(id)) return id as TaskMeta['status'];
    const overTask = tasks.find((t) => t.id === id);
    if (overTask) return overTask.status;
    return null;
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;
    setOverColumnId(over ? resolveTargetColumn(over.id) : null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;

    const taskId = active.id as string;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) { setOverColumnId(null); return; }

    // Determine target: from over element, or fallback to tracked column
    const targetStatus = over ? resolveTargetColumn(over.id) : overColumnId as TaskMeta['status'] | null;
    setOverColumnId(null);

    console.log('[kanban:dragEnd]', {
      taskId: taskId.slice(0, 8),
      from: task.status,
      overId: over?.id,
      overColumnFallback: overColumnId,
      targetStatus,
    });

    if (!targetStatus || task.status === targetStatus) return;

    // Trigger spawn or abort via WS
    if (targetStatus === 'in_progress' && (task.status === 'todo' || task.status === 'failed')) {
      console.log('[kanban] → onSpawnTask', taskId.slice(0, 8));
      onSpawnTask(taskId);
    } else if (targetStatus === 'todo' && task.status === 'in_progress') {
      console.log('[kanban] → onAbortTask', taskId.slice(0, 8));
      onAbortTask(taskId);
    } else {
      console.log('[kanban] → no action (status transition not handled)', task.status, '→', targetStatus);
    }
  };

  const onSpawnTask = (taskId: string) => {
    const ws = (window as any).__claudeWs;
    console.log('[kanban:spawn] ws state:', ws?.readyState, 'OPEN=', WebSocket.OPEN);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'task_spawn', taskId }));
      console.log('[kanban:spawn] sent task_spawn for', taskId.slice(0, 8));
    } else {
      console.warn('[kanban:spawn] WS not open! Cannot send task_spawn');
    }
  };

  const onAbortTask = (taskId: string) => {
    const ws = (window as any).__claudeWs;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'task_abort', taskId }));
    }
  };

  const handleCardClick = (task: TaskMeta) => {
    if (task.sessionId) {
      // Switch to chat view and select this session
      const { setActiveView } = useSessionStore.getState();
      setActiveView('chat');
      window.dispatchEvent(new CustomEvent('kanban-select-session', { detail: { sessionId: task.sessionId } }));
    } else if (task.status === 'todo' || task.status === 'failed') {
      // Open edit modal for tasks without a session
      setEditingTask(task);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        useKanbanStore.getState().removeTask(taskId);
      }
    } catch (err) {
      console.error('Failed to delete task:', err);
    }
  };

  const handleScheduleSave = async (schedule: {
    scheduledAt: string | null;
    scheduleCron: string | null;
    scheduleEnabled: boolean;
  }) => {
    if (!scheduleTaskId) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/tasks/${scheduleTaskId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(schedule),
      });
      if (res.ok) {
        const updated = await res.json();
        useKanbanStore.getState().updateTask(scheduleTaskId, updated);
      }
    } catch (err) {
      console.error('Failed to save schedule:', err);
    }
    setScheduleTaskId(null);
  };

  const handleCleanupWorktree = async (taskId: string) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/tasks/${taskId}/cleanup-worktree`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        useKanbanStore.getState().updateTask(taskId, { worktreePath: null });
      }
    } catch (err) {
      console.error('Failed to cleanup worktree:', err);
    }
  };

  const scheduleTask = scheduleTaskId ? tasks.find((t) => t.id === scheduleTaskId) : null;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden p-4">
      {/* Board header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-gray-200">{t('layout:task')}</h2>
          {/* Project filter */}
          <div className="flex items-center gap-1.5">
            <select
              value={filterProjectId ?? ''}
              onChange={(e) => setFilterProjectId(e.target.value || null)}
              className="text-xs bg-surface-800 border border-surface-700 rounded-md px-2 py-1.5 text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer max-w-[180px]"
            >
              <option value="">{t('allProjects')}</option>
              {activeProjects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {/* Clear filter button */}
            {filterProjectId && (
              <button
                onClick={() => setFilterProjectId(null)}
                className="text-gray-500 hover:text-gray-300 transition-colors p-1"
                title={t('clearFilter')}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowNewTask(true)}
          className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
        >
          + {t('newTask')}
        </button>
      </div>

      {/* Columns */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 flex gap-4 overflow-x-auto">
          {COLUMN_DEFS.map((col) => (
            <KanbanColumn
              key={col.id}
              id={col.id}
              title={t(col.titleKey)}
              color={col.color}
              tasks={getTasksByStatus(col.id)}
              onCardClick={handleCardClick}
              onDeleteTask={handleDeleteTask}
              onSpawnTask={onSpawnTask}
              onAbortTask={onAbortTask}
              onScheduleTask={(taskId) => setScheduleTaskId(taskId)}
              onCleanupWorktree={handleCleanupWorktree}
            />
          ))}
        </div>

        <DragOverlay>
          {activeTask ? (
            <KanbanCard task={activeTask} isDragOverlay onClick={() => {}} />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Schedule Popover */}
      {scheduleTask && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <SchedulePopover
            taskId={scheduleTask.id}
            currentScheduledAt={scheduleTask.scheduledAt}
            currentScheduleCron={scheduleTask.scheduleCron}
            currentScheduleEnabled={scheduleTask.scheduleEnabled}
            onSave={handleScheduleSave}
            onClose={() => setScheduleTaskId(null)}
          />
        </div>
      )}

      {showNewTask && (
        <NewTaskModal
          onClose={() => setShowNewTask(false)}
          onCreated={(task) => {
            useKanbanStore.getState().addTask(task);
            setShowNewTask(false);
          }}
          projectId={filterProjectId || activeProjectId}
          filterProjectId={filterProjectId}
        />
      )}

      {editingTask && (
        <NewTaskModal
          editTask={editingTask}
          onClose={() => setEditingTask(null)}
          onCreated={(updated) => {
            useKanbanStore.getState().updateTask(updated.id, updated);
            setEditingTask(null);
          }}
        />
      )}
    </div>
  );
}
