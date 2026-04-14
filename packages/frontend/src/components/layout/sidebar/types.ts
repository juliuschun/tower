import { type SessionMeta } from '../../../stores/session-store';
import { type Pin } from '../../../stores/pin-store';
import { type PromptItem } from '../../../stores/prompt-store';

export interface SidebarProps {
  onNewSession: (projectId?: string) => void;
  onSelectSession: (session: SessionMeta) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, name: string) => void;
  onToggleFavorite: (id: string, favorite: boolean) => void;
  onFileClick: (path: string) => void;
  onDirectoryClick: (path: string) => void;
  onRequestFileTree: (path?: string) => void;
  onPinFile?: (path: string) => void;
  onUnpinFile?: (id: number) => void;
  onPinClick?: (pin: Pin) => void;
  onSettingsClick?: () => void;
  onPromptClick?: (prompt: PromptItem) => void;
  onPromptEdit?: (prompt: PromptItem) => void;
  onPromptDelete?: (id: number | string) => void;
  onPromptAdd?: () => void;
  onPromptInsert?: (prompt: PromptItem) => void;
  onNewSessionInFolder?: (path: string) => void;
  onCollapseSidebar?: () => void;
}
