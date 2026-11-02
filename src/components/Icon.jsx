import React from 'react';
import {
  Activity, AlertCircle, AlertTriangle, ArrowRight, BadgeCheck, BrainCircuit,
  Building2, Camera, Check, ChevronUp, Circle, CircleCheck, ClipboardCheck,
  Clock, ExternalLink, FileText, GitMerge, Hammer, HandCoins, HardHat, Home,
  ImageOff, Inbox, Landmark, ListFilter, Map, MapPin, MapPinned, MessageCircle,
  Moon, MoveHorizontal, Play, RefreshCw, Scan, Search, ShieldAlert, ShieldCheck,
  Siren, Sparkles, Star, Sun, ThumbsUp, UploadCloud, UserCheck, X,
} from 'lucide-react';

const icons = {
  activity: Activity, 'alert-circle': AlertCircle, 'alert-triangle': AlertTriangle,
  'arrow-right': ArrowRight, 'badge-check': BadgeCheck, 'brain-circuit': BrainCircuit,
  'building-2': Building2, camera: Camera, check: Check, 'chevron-up': ChevronUp,
  'circle-check': CircleCheck, 'clipboard-check': ClipboardCheck, clock: Clock,
  'external-link': ExternalLink, 'file-text': FileText, 'git-merge': GitMerge,
  hammer: Hammer, 'hand-coins': HandCoins, 'hard-hat': HardHat, home: Home,
  'image-off': ImageOff, inbox: Inbox, landmark: Landmark, 'list-filter': ListFilter,
  map: Map, 'map-pin': MapPin, 'map-pinned': MapPinned, 'message-circle': MessageCircle,
  moon: Moon, 'move-horizontal': MoveHorizontal, play: Play, 'refresh-cw': RefreshCw, scan: Scan,
  search: Search, 'shield-alert': ShieldAlert, 'shield-check': ShieldCheck, siren: Siren,
  sparkles: Sparkles, star: Star, sun: Sun, 'thumbs-up': ThumbsUp,
  'upload-cloud': UploadCloud, 'user-check': UserCheck, x: X,
};

export default function Icon({ name, className = 'w-5 h-5', ...props }) {
  const Component = icons[name] || Circle;
  return <Component className={className} aria-hidden="true" {...props} />;
}
