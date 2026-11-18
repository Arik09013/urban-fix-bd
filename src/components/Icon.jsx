import React from 'react';
import {
  Activity, AlertCircle, AlertTriangle, ArrowRight, BadgeCheck, BookOpen, BrainCircuit,
  Building2, Camera, Check, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Circle, CircleCheck, ClipboardCheck,
  Clock, Code, Cpu, Database, Download, ExternalLink, FileText, GitBranch, GitMerge, Globe,
  Hammer, HandCoins, HardHat, HelpCircle, Home, ImageOff, Inbox, Key, Landmark, Layers, ListFilter,
  LogOut, Map, MapPin, MapPinned, MessageCircle, Moon, MoveHorizontal, Play, Radio, RefreshCw,
  Scan, Search, Server, Share2, Shield, ShieldAlert, ShieldCheck, Siren, Sparkles, Star, Sun,
  Terminal, ThumbsUp, UploadCloud, UserCheck, Workflow, X, Zap,
} from 'lucide-react';

const icons = {
  activity: Activity, 'alert-circle': AlertCircle, 'alert-triangle': AlertTriangle,
  'arrow-right': ArrowRight, 'badge-check': BadgeCheck, 'book-open': BookOpen, 'brain-circuit': BrainCircuit,
  'building-2': Building2, camera: Camera, check: Check, 'check-circle-2': CheckCircle2,
  'chevron-down': ChevronDown, 'chevron-right': ChevronRight, 'chevron-up': ChevronUp,
  'circle-check': CircleCheck, 'clipboard-check': ClipboardCheck, clock: Clock,
  code: Code, cpu: Cpu, database: Database, download: Download,
  'external-link': ExternalLink, 'file-text': FileText, 'git-branch': GitBranch, 'git-merge': GitMerge,
  globe: Globe, hammer: Hammer, 'hand-coins': HandCoins, 'hard-hat': HardHat,
  'help-circle': HelpCircle, home: Home, 'image-off': ImageOff, inbox: Inbox,
  key: Key, landmark: Landmark, layers: Layers, 'list-filter': ListFilter,
  'log-out': LogOut, map: Map, 'map-pin': MapPin, 'map-pinned': MapPinned, 'message-circle': MessageCircle,
  moon: Moon, 'move-horizontal': MoveHorizontal, play: Play, radio: Radio,
  'refresh-cw': RefreshCw, scan: Scan, search: Search, server: Server, 'share-2': Share2,
  shield: Shield, 'shield-alert': ShieldAlert, 'shield-check': ShieldCheck, siren: Siren,
  sparkles: Sparkles, star: Star, sun: Sun, terminal: Terminal, 'thumbs-up': ThumbsUp,
  'upload-cloud': UploadCloud, 'user-check': UserCheck, workflow: Workflow, x: X, zap: Zap,
};

export default function Icon({ name, className = 'w-5 h-5', ...props }) {
  const Component = icons[name] || Circle;
  return <Component className={className} aria-hidden="true" {...props} />;
}
