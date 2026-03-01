import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { KanbanCard } from './KanbanCard';
import type { TaskMeta } from '../../stores/kanban-store';

interface KanbanColumnProps {
  id: string;
  title: string;
  color: string;
  tasks: TaskMeta[];
  onCardClick: (task: TaskMeta) => void;
  onDeleteTask: (taskId: string) => void;
  onSpawnTask: (taskId: string) => void;
  onAbortTask: (taskId: string) => void;
}

export function KanbanColumn({ id, title, color, tasks, onCardClick, onDeleteTask, onSpawnTask, onAbortTask }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`flex-1 min-w-[280px] max-w-[400px] flex flex-col rounded-xl transition-colors ${
        isOver ? 'bg-surface-800/80 ring-1 ring-blue-500/30' : 'bg-surface-900/50'
      }`}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-surface-800">
        <span className={`text-sm font-medium ${color}`}>{title}</span>
        <span className="text-xs text-gray-500 bg-surface-800 rounded-full px-2 py-0.5">
          {tasks.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <KanbanCard
              key={task.id}
              task={task}
              onClick={() => onCardClick(task)}
              onDelete={() => onDeleteTask(task.id)}
              onSpawn={(task.status === 'todo' || task.status === 'failed') ? () => onSpawnTask(task.id) : undefined}
              onAbort={task.status === 'in_progress' ? () => onAbortTask(task.id) : undefined}
            />
          ))}
        </SortableContext>

        {tasks.length === 0 && (
          <div className="text-center text-gray-600 text-xs py-8">
            {id === 'todo' ? 'Add a task to get started' : 'Drop cards here'}
          </div>
        )}
      </div>
    </div>
  );
}
