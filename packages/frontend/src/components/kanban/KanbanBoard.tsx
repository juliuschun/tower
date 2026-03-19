import { useState, useEffect } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  pointerWithin,
  rectIntersection,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type CollisionDetection,
} from '@dnd-kit/core';
import { useKanbanStore, type TaskMeta } from '../../stores/kanban-store';
import { useSessionStore } from '../../stores/session-store';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import { NewTaskModal } from './NewTaskModal';
import { SchedulePopover } from './SchedulePopover';

const COLUMNS: { id: TaskMeta['status']; title: string; color: string }[] = [
  { id: 'todo', title: 'Todo', color: 'text-gray-400' },
  { id: 'in_progress', title: 'In Progress', color: 'text-blue-400' },
  { id: 'done', title: 'Done', color: 'text-green-400' },
];

export function KanbanBoard() {
  const { tasks, setTasks, setLoading } = useKanbanStore();
  const [activeTask, setActiveTask] = useState<TaskMeta | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskMeta | null>(null);
  const [scheduleTaskId, setScheduleTaskId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  // Custom collision detection: try card-level first, fall back to column-level
  const collisionDetection: CollisionDetection = (args) => {
    // First try closestCorners (finds cards)
    const cornerCollisions = closestCorners(args);
    if (cornerCollisions.length > 0) return cornerCollisions;
    // Fall back to pointerWithin (finds columns even when empty)
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) return pointerCollisions;
    // Last resort: rectangle intersection
    return rectIntersection(args);
  };

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

  const getTasksByStatus = (status: TaskMeta['status']) =>
    tasks
      .filter((t) => (status === 'done' ? t.status === 'done' || t.status === 'failed' : t.status === status))
      .sort((a, b) => a.sortOrder - b.sortOrder);

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find((t) => t.id === event.active.id);
    if (task) setActiveTask(task);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = active.id as string;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    // Determine target column
    const columnIds = new Set(COLUMNS.map((c) => c.id));
    let targetStatus: TaskMeta['status'];

    if (columnIds.has(over.id as string)) {
      // Dropped on column directly
      targetStatus = over.id as TaskMeta['status'];
    } else {
      // Dropped on a card — use that card's status
      const overTask = tasks.find((t) => t.id === over.id);
      if (overTask) {
        targetStatus = overTask.status;
      } else {
        return;
      }
    }

    if (task.status === targetStatus) return; // No change

    // Trigger spawn or abort via WS
    if (targetStatus === 'in_progress' && (task.status === 'todo' || task.status === 'failed')) {
      onSpawnTask(taskId);
    } else if (targetStatus === 'todo' && task.status === 'in_progress') {
      onAbortTask(taskId);
    }
    // Note: manual move to 'done' is not allowed — agent does that
  };

  const onSpawnTask = (taskId: string) => {
    const ws = (window as any).__claudeWs;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'task_spawn', taskId }));
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
        <h2 className="text-lg font-semibold text-gray-200">Task</h2>
        <button
          onClick={() => setShowNewTask(true)}
          className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
        >
          + New Task
        </button>
      </div>

      {/* Columns */}
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 flex gap-4 overflow-x-auto">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.id}
              id={col.id}
              title={col.title}
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
