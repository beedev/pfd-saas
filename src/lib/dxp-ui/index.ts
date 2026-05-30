// @dxp/ui — Enterprise portal component library
// Portal code imports ONLY from this file. Never from primitives or foundation directly.

// === Theme ===
export { ThemeProvider, useTheme } from './theme/ThemeProvider';
export type { ThemeProviderProps } from './theme/ThemeProvider';
export type { DxpTheme } from './theme/tokens';
export { defaultTheme } from './theme/tokens';

// === Primitives (foundation-abstracted) ===
export { Button } from './primitives/Button';
export type { ButtonProps } from './primitives/Button';

export { Input } from './primitives/Input';
export type { InputProps } from './primitives/Input';

export { Badge } from './primitives/Badge';
export type { BadgeProps } from './primitives/Badge';

export { Card, CardHeader, CardContent, CardFooter } from './primitives/Card';
export type { CardProps, CardVariant, CardAccent } from './primitives/Card';

export { Tabs } from './primitives/Tabs';
export type { TabsProps, Tab } from './primitives/Tabs';

export { Slider } from './primitives/Slider';
export type { SliderProps } from './primitives/Slider';

export { Select } from './primitives/Select';
export type { SelectProps, SelectOption } from './primitives/Select';

// === Composed (enterprise patterns) ===
export { DataTable } from './composed/DataTable';
export type { DataTableProps, Column } from './composed/DataTable';

export { DashboardCard } from './composed/DashboardCard';
export type { DashboardCardProps } from './composed/DashboardCard';

export { StatusBadge } from './composed/StatusBadge';
export type { StatusBadgeProps } from './composed/StatusBadge';

export { DetailPanel } from './composed/DetailPanel';
export type { DetailPanelProps } from './composed/DetailPanel';

export { MultiStepForm } from './composed/MultiStepForm';
export type { MultiStepFormProps, FormStep } from './composed/MultiStepForm';

export { FilterBar } from './composed/FilterBar';
export type { FilterBarProps, FilterOption } from './composed/FilterBar';

export { NotificationInbox } from './composed/NotificationInbox';
export type { NotificationInboxProps, NotificationItem } from './composed/NotificationInbox';

export { StepIndicator } from './composed/StepIndicator';
export type { StepIndicatorProps, Step } from './composed/StepIndicator';

export { FileUploadZone } from './composed/FileUploadZone';
export type { FileUploadZoneProps, UploadedFile } from './composed/FileUploadZone';

export { DocumentCard } from './composed/DocumentCard';
export type { DocumentCardProps } from './composed/DocumentCard';

export { Chart } from './composed/Chart';
export type { ChartProps } from './composed/Chart';

export { StatsDisplay } from './composed/StatsDisplay';
export type { StatsDisplayProps, Stat } from './composed/StatsDisplay';

export { ApprovalCard } from './composed/ApprovalCard';
export type { ApprovalCardProps } from './composed/ApprovalCard';

export { ProgressTracker } from './composed/ProgressTracker';
export type { ProgressTrackerProps, ProgressStep } from './composed/ProgressTracker';

export { QuestionFlow } from './composed/QuestionFlow';
export type { QuestionFlowProps, Question, QuestionOption } from './composed/QuestionFlow';

export { OrderSummary } from './composed/OrderSummary';
export type { OrderSummaryProps, OrderLineItem } from './composed/OrderSummary';

export { OptionList } from './composed/OptionList';
export type { OptionListProps, OptionItem } from './composed/OptionList';

export { PreferencesPanel } from './composed/PreferencesPanel';
export type { PreferencesPanelProps, PreferenceGroup, PreferenceItem } from './composed/PreferencesPanel';

export { ImageGallery } from './composed/ImageGallery';
export type { ImageGalleryProps, GalleryImage } from './composed/ImageGallery';

export { PlanView } from './composed/PlanView';
export type { PlanViewProps, PlanTask } from './composed/PlanView';

export { LinkPreview } from './composed/LinkPreview';
export type { LinkPreviewProps } from './composed/LinkPreview';

export { ItemCarousel } from './composed/ItemCarousel';
export type { ItemCarouselProps, CarouselItem } from './composed/ItemCarousel';

export { DynamicForm } from './composed/DynamicForm';
export type { DynamicFormProps, FormSchema } from './composed/DynamicForm';

export { FormDesigner } from './composed/FormDesigner';
export type { FormDesignerProps } from './composed/FormDesigner';

export { FormField } from './composed/FormField';
export type { FieldSchema } from './composed/FormField';

export { Citation } from './composed/Citation';
export type { CitationProps } from './composed/Citation';

export { Breadcrumb } from './composed/Breadcrumb';
export type { BreadcrumbProps, BreadcrumbItem } from './composed/Breadcrumb';

export { CoverageCard } from './composed/CoverageCard';
export type { CoverageCardProps, CoverageType, CoverageHighlight } from './composed/CoverageCard';

export { QuickActions } from './composed/QuickActions';
export type { QuickActionsProps, QuickAction } from './composed/QuickActions';

export { ProviderCard } from './composed/ProviderCard';
export type {
  ProviderCardProps,
  ProviderCardVariant,
  ProviderNetworkStatus,
  ProviderCardAction,
} from './composed/ProviderCard';

export { Gauge } from './composed/Gauge';
export type { GaugeProps, GaugeFormat, GaugeSize, GaugeThresholds } from './composed/Gauge';

// === Layouts ===
export { PageLayout } from './composed/PageLayout';
export type { PageLayoutProps, NavItem } from './composed/PageLayout';
