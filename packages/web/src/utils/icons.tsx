import type { LucideIcon } from 'lucide-react';
import {
  // 导航/布局
  Home, LayoutDashboard, LayoutGrid, LayoutTemplate, LayoutList, Menu,
  Navigation2, PanelLeft, Compass, Grid2x2, Grid3x3, Table, Table2,
  // 系统/设置
  Settings, Settings2, SlidersHorizontal, SlidersVertical, Terminal, Code,
  Cpu, Wrench, Hammer, MonitorCog, Workflow, Blocks, Variable, Component, BrainCircuit,
  // 安全/权限
  Shield, ShieldCheck, ShieldAlert, ShieldX, Lock, LockOpen,
  Key, KeyRound, Fingerprint, ScanFace, Eye, EyeOff,
  // 用户/团队
  User, Users, UserPlus, UserCheck, UserX, UserCog,
  UserRound, UsersRound, ContactRound, Crown, BadgeCheck, Award,
  // 文件/文档
  File, Files, FileText, FileCode, FileJson, FileImage, FileVideo, FileAudio,
  FilePlus, FileMinus, FileX, FileCheck, FileSearch, FileSpreadsheet,
  FileLock, ScrollText, NotepadText, NotebookPen, Paperclip,
  Clipboard, ClipboardList, ClipboardCheck,
  // 文件夹
  Folder, FolderOpen, FolderPlus, FolderMinus, FolderArchive, FolderSync, FolderCode, FolderGit,
  // 数据/存储
  Database, DatabaseBackup, Server, ServerCog, ServerCrash,
  Package, Package2, Box, Layers, Layers2,
  Cloud, CloudDownload, CloudUpload, HardDrive, HardDriveDownload, HardDriveUpload,
  Archive, GitBranch, GitMerge,
  // 图表/分析
  BarChart, BarChart2, BarChartHorizontal,
  LineChart, AreaChart, PieChart,
  ChartBar, ChartLine, ChartPie, ChartArea,
  TrendingUp, TrendingDown, Activity, Gauge,
  // 通信/消息
  Bell, BellOff, BellRing, BellDot,
  Mail, MailOpen, MessageSquare, MessageCircle,
  Phone, PhoneCall, PhoneOff, Send, Globe, Inbox,
  AtSign, Radio, Rss, Megaphone,
  // 内容/编辑
  BookOpen, Book, BookMarked, Bookmark,
  Pencil, PencilLine, PenLine,
  List, ListChecks, ListOrdered, ListTodo, Tag, Tags, Hash, Type,
  // 媒体
  Image, Images, Camera, CameraOff, Film, Video, VideoOff,
  Music, Mic, MicOff, Headphones, Volume2,
  // 地图/位置
  MapPin, Map, MapPinned, Navigation, Building, Building2,
  Hospital, Hotel, School, Factory, Store,
  // 商业/金融
  DollarSign, CreditCard, Wallet, PiggyBank, Receipt,
  ShoppingCart, ShoppingBag, Truck, Percent, Calculator, Coins, Banknote, BadgeDollarSign,
  // 工具/操作
  Search, Filter, RefreshCw, RefreshCcw, RotateCcw,
  LogIn, LogOut, Share, Share2, Link, ExternalLink, Copy, Trash2,
  QrCode, Printer, Wifi, WifiOff, Bluetooth, Usb, Smartphone, Tablet, Monitor, Laptop,
  // 状态/反馈
  CheckCircle, XCircle, AlertCircle, AlertTriangle, Info, HelpCircle,
  Star, Heart, HeartHandshake, ThumbsUp, ThumbsDown, Trophy, Flag, Zap,
  Signal, SignalLow, SignalMedium,
  // 时间/日历
  Calendar, CalendarDays, CalendarCheck, CalendarClock, Clock, Timer, Hourglass, AlarmClock,
} from 'lucide-react';
import React from 'react';

/** 侧边栏可用图标注册表（key = 存储在数据库中的图标名称） */
export const ICON_REGISTRY: Record<string, LucideIcon> = {
  // 导航/布局
  Home, LayoutDashboard, LayoutGrid, LayoutTemplate, LayoutList, Menu,
  Navigation2, PanelLeft, Compass, Grid2x2, Grid3x3, Table, Table2,
  // 系统/设置
  Settings, Settings2, SlidersHorizontal, SlidersVertical, Terminal, Code,
  Cpu, Wrench, Hammer, MonitorCog, Workflow, Blocks, Variable, Component, BrainCircuit,
  // 安全/权限
  Shield, ShieldCheck, ShieldAlert, ShieldX, Lock, LockOpen,
  Key, KeyRound, Fingerprint, ScanFace, Eye, EyeOff,
  // 用户/团队
  User, Users, UserPlus, UserCheck, UserX, UserCog,
  UserRound, UsersRound, ContactRound, Crown, BadgeCheck, Award,
  // 文件/文档
  File, Files, FileText, FileCode, FileJson, FileImage, FileVideo, FileAudio,
  FilePlus, FileMinus, FileX, FileCheck, FileSearch, FileSpreadsheet,
  FileLock, ScrollText, NotepadText, NotebookPen, Paperclip,
  Clipboard, ClipboardList, ClipboardCheck,
  // 文件夹
  Folder, FolderOpen, FolderPlus, FolderMinus, FolderArchive, FolderSync, FolderCode, FolderGit,
  // 数据/存储
  Database, DatabaseBackup, Server, ServerCog, ServerCrash,
  Package, Package2, Box, Layers, Layers2,
  Cloud, CloudDownload, CloudUpload, HardDrive, HardDriveDownload, HardDriveUpload,
  Archive, GitBranch, GitMerge,
  // 图表/分析
  BarChart, BarChart2, BarChartHorizontal,
  LineChart, AreaChart, PieChart,
  ChartBar, ChartLine, ChartPie, ChartArea,
  TrendingUp, TrendingDown, Activity, Gauge,
  // 通信/消息
  Bell, BellOff, BellRing, BellDot,
  Mail, MailOpen, MessageSquare, MessageCircle,
  Phone, PhoneCall, PhoneOff, Send, Globe, Inbox,
  AtSign, Radio, Rss, Megaphone,
  // 内容/编辑
  BookOpen, Book, BookMarked, Bookmark,
  Pencil, PencilLine, PenLine,
  List, ListChecks, ListOrdered, ListTodo, Tag, Tags, Hash, Type,
  // 媒体
  Image, Images, Camera, CameraOff, Film, Video, VideoOff,
  Music, Mic, MicOff, Headphones, Volume2,
  // 地图/位置
  MapPin, Map, MapPinned, Navigation, Building, Building2,
  Hospital, Hotel, School, Factory, Store,
  // 商业/金融
  DollarSign, CreditCard, Wallet, PiggyBank, Receipt,
  ShoppingCart, ShoppingBag, Truck, Percent, Calculator, Coins, Banknote, BadgeDollarSign,
  // 工具/操作
  Search, Filter, RefreshCw, RefreshCcw, RotateCcw,
  LogIn, LogOut, Share, Share2, Link, ExternalLink, Copy, Trash2,
  QrCode, Printer, Wifi, WifiOff, Bluetooth, Usb, Smartphone, Tablet, Monitor, Laptop,
  // 状态/反馈
  CheckCircle, XCircle, AlertCircle, AlertTriangle, Info, HelpCircle,
  Star, Heart, HeartHandshake, ThumbsUp, ThumbsDown, Trophy, Flag, Zap,
  Signal, SignalLow, SignalMedium,
  // 时间/日历
  Calendar, CalendarDays, CalendarCheck, CalendarClock, Clock, Timer, Hourglass, AlarmClock,
};

/** 图标选择器分类，用于分组展示 */
export const ICON_GROUPS: { label: string; icons: string[] }[] = [
  {
    label: '导航/布局',
    icons: ['Home', 'LayoutDashboard', 'LayoutGrid', 'LayoutTemplate', 'LayoutList', 'Menu',
            'Navigation2', 'PanelLeft', 'Compass', 'Grid2x2', 'Grid3x3', 'Table', 'Table2'],
  },
  {
    label: '系统/设置',
    icons: ['Settings', 'Settings2', 'SlidersHorizontal', 'SlidersVertical', 'Terminal', 'Code',
            'Cpu', 'Wrench', 'Hammer', 'MonitorCog', 'Workflow', 'Blocks', 'Variable', 'Component', 'BrainCircuit'],
  },
  {
    label: '安全/权限',
    icons: ['Shield', 'ShieldCheck', 'ShieldAlert', 'ShieldX', 'Lock', 'LockOpen',
            'Key', 'KeyRound', 'Fingerprint', 'ScanFace', 'Eye', 'EyeOff'],
  },
  {
    label: '用户/团队',
    icons: ['User', 'Users', 'UserPlus', 'UserCheck', 'UserX', 'UserCog',
            'UserRound', 'UsersRound', 'ContactRound', 'Crown', 'BadgeCheck', 'Award'],
  },
  {
    label: '文件/文档',
    icons: ['File', 'Files', 'FileText', 'FileCode', 'FileJson', 'FileImage', 'FileVideo', 'FileAudio',
            'FilePlus', 'FileMinus', 'FileX', 'FileCheck', 'FileSearch', 'FileSpreadsheet',
            'FileLock', 'ScrollText', 'NotepadText', 'NotebookPen', 'Paperclip',
            'Clipboard', 'ClipboardList', 'ClipboardCheck'],
  },
  {
    label: '文件夹',
    icons: ['Folder', 'FolderOpen', 'FolderPlus', 'FolderMinus', 'FolderArchive', 'FolderSync', 'FolderCode', 'FolderGit'],
  },
  {
    label: '数据/存储',
    icons: ['Database', 'DatabaseBackup', 'Server', 'ServerCog', 'ServerCrash',
            'Package', 'Package2', 'Box', 'Layers', 'Layers2',
            'Cloud', 'CloudDownload', 'CloudUpload', 'HardDrive', 'HardDriveDownload', 'HardDriveUpload',
            'Archive', 'GitBranch', 'GitMerge'],
  },
  {
    label: '图表/分析',
    icons: ['BarChart', 'BarChart2', 'BarChartHorizontal',
            'LineChart', 'AreaChart', 'PieChart',
            'ChartBar', 'ChartLine', 'ChartPie', 'ChartArea',
            'TrendingUp', 'TrendingDown', 'Activity', 'Gauge'],
  },
  {
    label: '通信/消息',
    icons: ['Bell', 'BellOff', 'BellRing', 'BellDot',
            'Mail', 'MailOpen', 'MessageSquare', 'MessageCircle',
            'Phone', 'PhoneCall', 'PhoneOff', 'Send', 'Globe', 'Inbox',
            'AtSign', 'Radio', 'Rss', 'Megaphone'],
  },
  {
    label: '内容/编辑',
    icons: ['BookOpen', 'Book', 'BookMarked', 'Bookmark',
            'Pencil', 'PencilLine', 'PenLine',
            'List', 'ListChecks', 'ListOrdered', 'ListTodo', 'Tag', 'Tags', 'Hash', 'Type'],
  },
  {
    label: '媒体',
    icons: ['Image', 'Images', 'Camera', 'CameraOff', 'Film', 'Video', 'VideoOff',
            'Music', 'Mic', 'MicOff', 'Headphones', 'Volume2'],
  },
  {
    label: '地图/位置',
    icons: ['MapPin', 'Map', 'MapPinned', 'Navigation', 'Building', 'Building2',
            'Hospital', 'Hotel', 'School', 'Factory', 'Store'],
  },
  {
    label: '商业/金融',
    icons: ['DollarSign', 'CreditCard', 'Wallet', 'PiggyBank', 'Receipt',
            'ShoppingCart', 'ShoppingBag', 'Truck', 'Percent', 'Calculator', 'Coins', 'Banknote', 'BadgeDollarSign'],
  },
  {
    label: '工具/设备',
    icons: ['Search', 'Filter', 'RefreshCw', 'RefreshCcw', 'RotateCcw',
            'LogIn', 'LogOut', 'Share', 'Share2', 'Link', 'ExternalLink', 'Copy', 'Trash2',
            'QrCode', 'Printer', 'Wifi', 'WifiOff', 'Bluetooth', 'Usb', 'Smartphone', 'Tablet', 'Monitor', 'Laptop'],
  },
  {
    label: '状态/反馈',
    icons: ['CheckCircle', 'XCircle', 'AlertCircle', 'AlertTriangle', 'Info', 'HelpCircle',
            'Star', 'Heart', 'HeartHandshake', 'ThumbsUp', 'ThumbsDown', 'Trophy', 'Flag', 'Zap',
            'Signal', 'SignalLow', 'SignalMedium'],
  },
  {
    label: '时间/日历',
    icons: ['Calendar', 'CalendarDays', 'CalendarCheck', 'CalendarClock', 'Clock', 'Timer', 'Hourglass', 'AlarmClock'],
  },
];

/** 通过名称渲染 Lucide 图标；找不到时返回 null */
export function renderLucideIcon(name: string | undefined, size = 16): React.ReactNode {
  if (!name) return null;
  const Icon = ICON_REGISTRY[name];
  if (!Icon) return null;
  return <Icon size={size} strokeWidth={1.7} />;
}
