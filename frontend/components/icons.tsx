"use client";

/**
 * The app's icon set. Every glyph comes from Hugeicons; the export names stay
 * close to the shapes they draw so call sites read naturally.
 */
import * as React from "react";
import { HugeiconsIcon, type HugeiconsIconProps } from "@hugeicons/react";
import {
  Add01Icon,
  Alert02Icon,
  AlertCircleIcon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowLeft02Icon,
  ArrowRight01Icon,
  ArrowRight02Icon,
  ArrowTurnBackwardIcon,
  ArrowUp01Icon,
  ArrowUpDownIcon,
  BookOpen01Icon,
  Calendar01Icon,
  Calendar03Icon,
  CalendarCheckOut01Icon,
  CalendarRemove01Icon,
  Cancel01Icon,
  CancelCircleIcon,
  ChartHistogramIcon,
  ChartLineData01Icon,
  CheckListIcon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  Clock03Icon,
  Clock04Icon,
  CloudOffIcon,
  Compass01Icon,
  ComputerIcon,
  DashboardBrowsingIcon,
  DashboardSquare01Icon,
  Delete02Icon,
  FilterHorizontalIcon,
  Flag02Icon,
  Globe02Icon,
  InformationCircleIcon,
  Key01Icon,
  KeyboardIcon,
  LeftToRightListBulletIcon,
  Link01Icon,
  LinkSquare02Icon,
  Loading03Icon,
  LockIcon,
  Logout01Icon,
  Mail01Icon,
  Menu01Icon,
  Moon02Icon,
  MoonIcon,
  MoreHorizontalIcon as MoreHorizontalGlyph,
  MortarboardIcon,
  NextIcon,
  Notebook01Icon,
  Notification01Icon,
  PaintBoardIcon,
  PauseIcon,
  PencilEdit02Icon,
  PieChartIcon,
  PlayIcon,
  RefreshIcon,
  Search01Icon,
  SecurityCheckIcon,
  SentIcon,
  Settings01Icon,
  Settings02Icon,
  SidebarLeftIcon,
  SparklesIcon,
  Sun01Icon,
  Target02Icon,
  Task01Icon,
  Tick02Icon,
  Timer02Icon,
  TimerOffIcon,
  UnavailableIcon,
  Undo02Icon,
  UnfoldMoreIcon,
  UserCircleIcon,
  UserIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";

export type IconProps = Omit<HugeiconsIconProps, "icon"> & { ref?: React.Ref<SVGSVGElement> };
export type IconComponent = React.ComponentType<IconProps>;

function createIcon(icon: HugeiconsIconProps["icon"], name: string): IconComponent {
  function Icon({ className, ...props }: IconProps) {
    // Decorative unless the caller names it, matching how screen readers
    // should treat a glyph that sits beside its own text.
    const labelled = props["aria-label"] !== undefined || props["aria-labelledby"] !== undefined;
    return (
      <HugeiconsIcon
        icon={icon}
        aria-hidden={labelled ? undefined : true}
        {...props}
        className={cn("hgi", className)}
      />
    );
  }
  Icon.displayName = name;
  return Icon;
}

export const AlertCircle = createIcon(AlertCircleIcon, "AlertCircle");
export const AlertTriangle = createIcon(Alert02Icon, "AlertTriangle");
export const ArrowLeft = createIcon(ArrowLeft02Icon, "ArrowLeft");
export const ArrowRight = createIcon(ArrowRight02Icon, "ArrowRight");
export const ArrowUpDown = createIcon(ArrowUpDownIcon, "ArrowUpDown");
export const BarChart3 = createIcon(ChartHistogramIcon, "BarChart3");
export const BellRing = createIcon(Notification01Icon, "BellRing");
export const BookOpen = createIcon(BookOpen01Icon, "BookOpen");
export const Calendar = createIcon(Calendar01Icon, "Calendar");
export const CalendarClock = createIcon(CalendarCheckOut01Icon, "CalendarClock");
export const CalendarDays = createIcon(Calendar03Icon, "CalendarDays");
export const CalendarOff = createIcon(CalendarRemove01Icon, "CalendarOff");
export const ChartLine = createIcon(ChartLineData01Icon, "ChartLine");
export const ChartPie = createIcon(PieChartIcon, "ChartPie");
export const Check = createIcon(Tick02Icon, "Check");
export const CheckCircle2 = createIcon(CheckmarkCircle02Icon, "CheckCircle2");
export const CheckIcon = createIcon(Tick02Icon, "CheckIcon");
export const ChevronDownIcon = createIcon(ArrowDown01Icon, "ChevronDownIcon");
export const ChevronLeft = createIcon(ArrowLeft01Icon, "ChevronLeft");
export const ChevronLeftIcon = createIcon(ArrowLeft01Icon, "ChevronLeftIcon");
export const ChevronRight = createIcon(ArrowRight01Icon, "ChevronRight");
export const ChevronRightIcon = createIcon(ArrowRight01Icon, "ChevronRightIcon");
export const ChevronUpIcon = createIcon(ArrowUp01Icon, "ChevronUpIcon");
export const ChevronsUpDown = createIcon(UnfoldMoreIcon, "ChevronsUpDown");
export const CircleCheckIcon = createIcon(CheckmarkCircle02Icon, "CircleCheckIcon");
export const CircleSlash = createIcon(UnavailableIcon, "CircleSlash");
export const CircleUserRound = createIcon(UserCircleIcon, "CircleUserRound");
export const ClipboardList = createIcon(Task01Icon, "ClipboardList");
export const Clock = createIcon(Clock01Icon, "Clock");
export const Clock3 = createIcon(Clock03Icon, "Clock3");
export const Clock4 = createIcon(Clock04Icon, "Clock4");
export const CloudOff = createIcon(CloudOffIcon, "CloudOff");
export const Compass = createIcon(Compass01Icon, "Compass");
export const CornerDownLeft = createIcon(ArrowTurnBackwardIcon, "CornerDownLeft");
export const ExternalLink = createIcon(LinkSquare02Icon, "ExternalLink");
export const Eye = createIcon(ViewIcon, "Eye");
export const Flag = createIcon(Flag02Icon, "Flag");
export const Globe = createIcon(Globe02Icon, "Globe");
export const GraduationCap = createIcon(MortarboardIcon, "GraduationCap");
export const Info = createIcon(InformationCircleIcon, "Info");
export const InfoIcon = createIcon(InformationCircleIcon, "InfoIcon");
export const KeyRound = createIcon(Key01Icon, "KeyRound");
export const Keyboard = createIcon(KeyboardIcon, "Keyboard");
export const LayoutDashboard = createIcon(DashboardBrowsingIcon, "LayoutDashboard");
export const LayoutGrid = createIcon(DashboardSquare01Icon, "LayoutGrid");
export const Link2 = createIcon(Link01Icon, "Link2");
export const ListChecks = createIcon(CheckListIcon, "ListChecks");
export const ListTodo = createIcon(LeftToRightListBulletIcon, "ListTodo");
export const Loader2 = createIcon(Loading03Icon, "Loader2");
export const Loader2Icon = createIcon(Loading03Icon, "Loader2Icon");
export const Lock = createIcon(LockIcon, "Lock");
export const LogOut = createIcon(Logout01Icon, "LogOut");
export const Mail = createIcon(Mail01Icon, "Mail");
export const Monitor = createIcon(ComputerIcon, "Monitor");
export const Moon = createIcon(Moon02Icon, "Moon");
export const MoonStar = createIcon(MoonIcon, "MoonStar");
export const MoreHorizontal = createIcon(MoreHorizontalGlyph, "MoreHorizontal");
export const MoreHorizontalIcon = createIcon(MoreHorizontalGlyph, "MoreHorizontalIcon");
export const NotebookPen = createIcon(Notebook01Icon, "NotebookPen");
export const OctagonXIcon = createIcon(CancelCircleIcon, "OctagonXIcon");
export const Palette = createIcon(PaintBoardIcon, "Palette");
export const PanelLeftIcon = createIcon(SidebarLeftIcon, "PanelLeftIcon");
export const Pause = createIcon(PauseIcon, "Pause");
export const Pencil = createIcon(PencilEdit02Icon, "Pencil");
export const Play = createIcon(PlayIcon, "Play");
export const Plus = createIcon(Add01Icon, "Plus");
export const RefreshCw = createIcon(RefreshIcon, "RefreshCw");
export const RotateCcw = createIcon(Undo02Icon, "RotateCcw");
export const Rows3 = createIcon(Menu01Icon, "Rows3");
export const Search = createIcon(Search01Icon, "Search");
export const SearchIcon = createIcon(Search01Icon, "SearchIcon");
export const Send = createIcon(SentIcon, "Send");
export const Settings = createIcon(Settings01Icon, "Settings");
export const Settings2 = createIcon(Settings02Icon, "Settings2");
export const ShieldCheck = createIcon(SecurityCheckIcon, "ShieldCheck");
export const SlidersHorizontal = createIcon(FilterHorizontalIcon, "SlidersHorizontal");
export const SkipForward = createIcon(NextIcon, "SkipForward");
export const Sparkles = createIcon(SparklesIcon, "Sparkles");
export const Sun = createIcon(Sun01Icon, "Sun");
export const Target = createIcon(Target02Icon, "Target");
export const Timer = createIcon(Timer02Icon, "Timer");
export const TimerOff = createIcon(TimerOffIcon, "TimerOff");
export const Trash2 = createIcon(Delete02Icon, "Trash2");
export const TriangleAlertIcon = createIcon(Alert02Icon, "TriangleAlertIcon");
export const User = createIcon(UserIcon, "User");
export const X = createIcon(Cancel01Icon, "X");
export const XCircle = createIcon(CancelCircleIcon, "XCircle");
export const XIcon = createIcon(Cancel01Icon, "XIcon");
