/** 界面图标 —— 统一走 lucide-react，不在本地画 svg。 */
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Flame,
  History,
  IdCard,
  Info,
  Link2,
  LoaderCircle,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Send,
  Settings,
  Sparkles,
  SquarePen,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';

function LineIcon({ icon: Icon, size = 18 }: { icon: LucideIcon; size?: number }) {
  return <Icon size={size} strokeWidth={1.8} aria-hidden="true" />;
}

export function CheckIcon() {
  return <LineIcon icon={Check} />;
}

export function WarnIcon() {
  return <LineIcon icon={TriangleAlert} />;
}

export function InfoIcon({ size = 18 }: { size?: number }) {
  return <LineIcon icon={Info} size={size} />;
}

export function ChartIcon() {
  return <LineIcon icon={Activity} size={17} />;
}

export function HistoryIcon() {
  return <LineIcon icon={History} />;
}

export function PlusIcon() {
  return <LineIcon icon={Plus} />;
}

export function RefreshIcon() {
  return <LineIcon icon={RefreshCw} />;
}

export function SparkIcon() {
  return <LineIcon icon={Sparkles} />;
}

export function SendIcon() {
  return <LineIcon icon={Send} />;
}

/** 新建会话：顶栏用「写一条」的笔形，抽屉底部仍用加号 */
export function NewConversationIcon() {
  return <LineIcon icon={SquarePen} size={15} />;
}

export function CloseIcon() {
  return <LineIcon icon={X} />;
}

export function SquarePenIcon() {
  return <LineIcon icon={SquarePen} />;
}

export function LinkIcon() {
  return <LineIcon icon={Link2} size={13} />;
}

export function ChevronDownIcon({ size = 14 }: { size?: number }) {
  return <LineIcon icon={ChevronDown} size={size} />;
}

export function ChevronRightIcon({ size = 14 }: { size?: number }) {
  return <LineIcon icon={ChevronRight} size={size} />;
}

export function ArrowLeftIcon() {
  return <LineIcon icon={ArrowLeft} />;
}

export function ArrowDownIcon({ size = 12 }: { size?: number }) {
  return <LineIcon icon={ArrowDown} size={size} />;
}

export function ArrowUpIcon({ size = 12 }: { size?: number }) {
  return <LineIcon icon={ArrowUp} size={size} />;
}

/** 发送中等候的转圈 */
export function LoadingIcon() {
  return <LoaderCircle size={18} strokeWidth={1.8} className="spin" aria-hidden="true" />;
}

export function PinIcon({ off = false, size = 16 }: { off?: boolean; size?: number }) {
  return <LineIcon icon={off ? PinOff : Pin} size={size} />;
}

export function PencilIcon({ size = 16 }: { size?: number }) {
  return <LineIcon icon={Pencil} size={size} />;
}

export function TrashIcon({ size = 16 }: { size?: number }) {
  return <LineIcon icon={Trash2} size={size} />;
}

export function IdCardIcon({ size = 14 }: { size?: number }) {
  return <LineIcon icon={IdCard} size={size} />;
}

export function FlameIcon({ size = 14 }: { size?: number }) {
  return <LineIcon icon={Flame} size={size} />;
}

export function FileTextIcon({ size = 14 }: { size?: number }) {
  return <LineIcon icon={FileText} size={size} />;
}

export function SettingsIcon({ size = 16 }: { size?: number }) {
  return <LineIcon icon={Settings} size={size} />;
}