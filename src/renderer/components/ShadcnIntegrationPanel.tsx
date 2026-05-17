import React, { useMemo, useState } from "react";
import { Activity, CalendarDays, Code2, GitBranch, LayoutDashboard, MessageSquare, Settings2, ShieldCheck } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

import type { AuthState } from "../../shared/domain/auth";
import type { AppSettings } from "../../shared/domain/settings";
import type { WatchedRepo } from "../../shared/domain/watched-repo";
import type { CacheSummary } from "../../shared/domain/cache";
import fallbackMarkDark from "../assets/fallback-mark-dark.png";
import { compactCount, formatBytes } from "../lib/format";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "./ui/alert-dialog";
import { AspectRatio } from "./ui/aspect-ratio";
import { Avatar as ShadcnAvatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Badge } from "./ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "./ui/breadcrumb";
import { Button } from "./ui/button";
import { ButtonGroup } from "./ui/button-group";
import { Calendar } from "./ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "./ui/carousel";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "./ui/chart";
import { Checkbox } from "./ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Combobox } from "./ui/combobox";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "./ui/context-menu";
import { DataTable, type DataTableColumn } from "./ui/data-table";
import { DatePicker } from "./ui/date-picker";
import { DirectionProvider } from "./ui/direction";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from "./ui/drawer";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./ui/field";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card";
import { Input } from "./ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "./ui/input-group";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "./ui/input-otp";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "./ui/item";
import { Kbd } from "./ui/kbd";
import { Label } from "./ui/label";
import { Menubar, MenubarContent, MenubarItem, MenubarMenu, MenubarTrigger } from "./ui/menubar";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { NavigationMenu, NavigationMenuItem, NavigationMenuLink, NavigationMenuList } from "./ui/navigation-menu";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "./ui/pagination";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Progress } from "./ui/progress";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./ui/resizable";
import { ScrollArea } from "./ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Separator } from "./ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "./ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider
} from "./ui/sidebar";
import { Skeleton } from "./ui/skeleton";
import { Slider } from "./ui/slider";
import { Spinner } from "./ui/spinner";
import { Switch } from "./ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Textarea } from "./ui/textarea";
import { toast } from "./ui/toast";
import { Toggle } from "./ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { TypographyH2, TypographyMuted, TypographyP } from "./ui/typography";

const chartConfig = {
  items: {
    label: "Items",
    color: "var(--chart-1)"
  }
} satisfies ChartConfig;

export function ShadcnIntegrationPanel({
  auth,
  cache,
  settings,
  repos
}: {
  auth: AuthState;
  cache?: CacheSummary;
  settings: AppSettings;
  repos: WatchedRepo[];
}) {
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [calendarDate, setCalendarDate] = useState<Date | undefined>(new Date());
  const [direction, setDirection] = useState<"ltr" | "rtl">("ltr");
  const [reviewTone, setReviewTone] = useState("comment");
  const [syncValue, setSyncValue] = useState([settings.syncFrequencyMinutes ?? 15]);
  const [compact, setCompact] = useState(true);
  const [otp, setOtp] = useState("123456");
  const [selectedRepo, setSelectedRepo] = useState(repos[0]?.id ?? "");
  const repoOptions = repos.slice(0, 12).map((repo) => ({ value: repo.id, label: repo.fullName }));
  const chartData = useMemo(
    () => [
      { name: "Repos", items: cache?.watchedRepos ?? repos.length },
      { name: "PRs", items: cache?.pullRequests ?? 0 },
      { name: "Issues", items: cache?.issues ?? 0 }
    ],
    [cache, repos.length]
  );
  const tableRows = repos.slice(0, 5);
  const columns: DataTableColumn<WatchedRepo>[] = [
    { key: "repo", header: "Repository", cell: (repo) => repo.fullName },
    { key: "branch", header: "Branch", cell: (repo) => repo.defaultBranch ?? "main" },
    { key: "state", header: "State", cell: (repo) => <Badge variant="outline">{repo.syncStatus}</Badge> }
  ];

  return (
    <Accordion type="single" collapsible className="rounded-lg border border-neutral-800 bg-[#0A0A0A]">
      <AccordionItem value="components" className="border-0">
        <AccordionTrigger className="px-5 py-4">
          <span className="flex items-center gap-2">
            <LayoutDashboard className="size-4 text-neutral-500" />
            Shadcn interface coverage
          </span>
        </AccordionTrigger>
        <AccordionContent className="px-5 pb-5">
          <DirectionProvider dir={direction}>
            <div className="space-y-5">
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbLink>Settings</BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>Components</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>

              <Alert>
                <ShieldCheck className="size-4" />
                <AlertTitle>Coverage mode</AlertTitle>
                <AlertDescription>
                  These controls exercise the shadcn catalog against live Fallback state without changing repository data.
                </AlertDescription>
              </Alert>

              <Tabs defaultValue="controls" className="gap-4">
                <TabsList variant="line">
                  <TabsTrigger value="controls">Controls</TabsTrigger>
                  <TabsTrigger value="data">Data</TabsTrigger>
                  <TabsTrigger value="layout">Layout</TabsTrigger>
                </TabsList>
                <TabsContent value="controls" className="space-y-4">
                  <FieldGroup>
                    <Field>
                      <FieldLabel>Repository combobox</FieldLabel>
                      <Combobox
                        value={selectedRepo}
                        options={repoOptions}
                        placeholder="Select a watched repo"
                        searchPlaceholder="Search watched repos..."
                        emptyMessage="No watched repos found."
                        onValueChange={setSelectedRepo}
                      />
                      <FieldDescription>Popover and Command power the searchable picker.</FieldDescription>
                    </Field>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field>
                        <FieldLabel>Native select</FieldLabel>
                        <NativeSelect value={String(settings.syncFrequencyMinutes ?? 15)} onChange={() => undefined}>
                          {[5, 15, 30, 60].map((minutes) => (
                            <NativeSelectOption key={minutes} value={String(minutes)}>
                              Every {minutes} minutes
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </Field>
                      <Field>
                        <FieldLabel>Radix select</FieldLabel>
                        <Select value={reviewTone} onValueChange={setReviewTone}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="comment">Comment</SelectItem>
                            <SelectItem value="approve">Approve</SelectItem>
                            <SelectItem value="changes">Request changes</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                    <Field>
                      <FieldLabel>Token input group</FieldLabel>
                      <InputGroup>
                        <InputGroupAddon>
                          <Kbd>GH</Kbd>
                        </InputGroupAddon>
                        <InputGroupInput placeholder="Paste token preview..." type="password" />
                        <InputGroupButton onClick={() => toast.info("Token preview stayed local.")}>Check</InputGroupButton>
                      </InputGroup>
                    </Field>
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                      <Field>
                        <FieldLabel>Plain input</FieldLabel>
                        <Input placeholder="Filter preview..." />
                      </Field>
                      <Field>
                        <FieldLabel>Button group</FieldLabel>
                        <ButtonGroup>
                          <Button variant="outline">Sync</Button>
                          <Button variant="outline">Cache</Button>
                        </ButtonGroup>
                      </Field>
                    </div>
                    <div className="grid gap-4 md:grid-cols-3">
                      <Field>
                        <FieldLabel>Switch</FieldLabel>
                        <div className="flex h-9 items-center gap-2">
                          <Switch checked={compact} onCheckedChange={setCompact} id="compact-preview" />
                          <Label htmlFor="compact-preview">Compact preview</Label>
                        </div>
                      </Field>
                      <Field>
                        <FieldLabel>Direction</FieldLabel>
                        <RadioGroup
                          value={direction}
                          onValueChange={(value) => setDirection(value as "ltr" | "rtl")}
                          className="flex h-9 gap-4"
                        >
                          <Label className="gap-2">
                            <RadioGroupItem value="ltr" />
                            LTR
                          </Label>
                          <Label className="gap-2">
                            <RadioGroupItem value="rtl" />
                            RTL
                          </Label>
                        </RadioGroup>
                      </Field>
                      <Field>
                        <FieldLabel>Slider</FieldLabel>
                        <Slider value={syncValue} min={5} max={60} step={5} onValueChange={setSyncValue} />
                        <FieldDescription>{syncValue[0]} minute preview</FieldDescription>
                      </Field>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Checkbox id="preview-checkbox" defaultChecked />
                      <Label htmlFor="preview-checkbox">Checkbox sample</Label>
                      <Toggle aria-label="Toggle signed commits" pressed>
                        <Code2 className="size-4" />
                      </Toggle>
                      <ToggleGroup type="single" defaultValue="files">
                        <ToggleGroupItem value="files">Files</ToggleGroupItem>
                        <ToggleGroupItem value="commits">Commits</ToggleGroupItem>
                      </ToggleGroup>
                      <InputOTP value={otp} onChange={setOtp} maxLength={6}>
                        <InputOTPGroup>
                          {[0, 1, 2, 3, 4, 5].map((index) => (
                            <InputOTPSlot key={index} index={index} />
                          ))}
                        </InputOTPGroup>
                      </InputOTP>
                    </div>
                  </FieldGroup>
                </TabsContent>

                <TabsContent value="data" className="space-y-4">
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                    <Card>
                      <CardHeader>
                        <CardTitle>Repository data</CardTitle>
                        <CardDescription>Table and data table variants over watched repositories.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <DataTable columns={columns} data={tableRows} getRowKey={(repo) => repo.id} empty="No watched repos." />
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Metric</TableHead>
                              <TableHead className="text-right">Value</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            <TableRow>
                              <TableCell>Storage</TableCell>
                              <TableCell className="text-right">{cache ? formatBytes(cache.totalBytes) : "Not loaded"}</TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell>Watched repositories</TableCell>
                              <TableCell className="text-right">{compactCount(repos.length)}</TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader>
                        <CardTitle>Cache chart</CardTitle>
                        <CardDescription>Chart, progress, skeleton, spinner.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <ChartContainer config={chartConfig} className="h-40 w-full">
                          <BarChart data={chartData}>
                            <CartesianGrid vertical={false} />
                            <XAxis dataKey="name" tickLine={false} axisLine={false} />
                            <ChartTooltip content={<ChartTooltipContent />} />
                            <Bar dataKey="items" fill="var(--color-items)" radius={4} />
                          </BarChart>
                        </ChartContainer>
                        <Progress value={Math.min(100, repos.length * 8)} />
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Spinner className="size-4" /> <Skeleton className="h-3 w-24" />
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious href="#" onClick={(event) => event.preventDefault()} />
                      </PaginationItem>
                      <PaginationItem>
                        <PaginationLink href="#" isActive onClick={(event) => event.preventDefault()}>
                          1
                        </PaginationLink>
                      </PaginationItem>
                      <PaginationItem>
                        <PaginationNext href="#" onClick={(event) => event.preventDefault()} />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </TabsContent>

                <TabsContent value="layout" className="space-y-4">
                  <ResizablePanelGroup orientation="horizontal" className="min-h-48 rounded-lg border border-neutral-800">
                    <ResizablePanel defaultSize={38} minSize={28}>
                      <ScrollArea className="h-48">
                        <ItemGroup>
                          {["Files", "Issues", "Pull requests"].map((label) => (
                            <ContextMenu key={label}>
                              <ContextMenuTrigger>
                                <Item size="sm">
                                  <ItemMedia variant="icon">
                                    <GitBranch className="size-4" />
                                  </ItemMedia>
                                  <ItemContent>
                                    <ItemTitle>{label}</ItemTitle>
                                    <ItemDescription>Right-click for a context menu.</ItemDescription>
                                  </ItemContent>
                                  <ItemActions>
                                    <Badge variant="secondary">Live</Badge>
                                  </ItemActions>
                                </Item>
                              </ContextMenuTrigger>
                              <ContextMenuContent>
                                <ContextMenuItem>Open</ContextMenuItem>
                                <ContextMenuItem>Copy path</ContextMenuItem>
                              </ContextMenuContent>
                            </ContextMenu>
                          ))}
                        </ItemGroup>
                      </ScrollArea>
                    </ResizablePanel>
                    <ResizableHandle />
                    <ResizablePanel defaultSize={62}>
                      <div className="space-y-4 p-4">
                        <AspectRatio ratio={16 / 9} className="overflow-hidden rounded-md border border-neutral-800 bg-black">
                          <img src={fallbackMarkDark} alt="Fallback mark" className="h-full w-full object-contain p-8" />
                        </AspectRatio>
                        <div className="flex flex-wrap items-center gap-2">
                          <HoverCard>
                            <HoverCardTrigger asChild>
                              <Button variant="outline">Auth profile</Button>
                            </HoverCardTrigger>
                            <HoverCardContent>
                              <div className="flex gap-3">
                                <ShadcnAvatar>
                                  <AvatarImage src={auth.status === "connected" ? (auth.avatarUrl ?? undefined) : undefined} />
                                  <AvatarFallback>
                                    {auth.status === "connected" ? (auth.login?.slice(0, 2).toUpperCase() ?? "GH") : "FB"}
                                  </AvatarFallback>
                                </ShadcnAvatar>
                                <div>
                                  <TypographyH2>{auth.status === "connected" ? (auth.login ?? "GitHub") : "Disconnected"}</TypographyH2>
                                  <TypographyP>Hover card, avatar, and typography.</TypographyP>
                                </div>
                              </div>
                            </HoverCardContent>
                          </HoverCard>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="outline">Dates</Button>
                            </PopoverTrigger>
                            <PopoverContent className="space-y-3">
                              <DatePicker date={date} onDateChange={setDate} />
                              <Calendar mode="single" selected={calendarDate} onSelect={setCalendarDate} />
                            </PopoverContent>
                          </Popover>
                          <Sheet>
                            <SheetTrigger asChild>
                              <Button variant="outline">Sheet</Button>
                            </SheetTrigger>
                            <SheetContent>
                              <SheetHeader>
                                <SheetTitle>Repository sheet</SheetTitle>
                                <SheetDescription>Sheet is ready for complementary workspace panels.</SheetDescription>
                              </SheetHeader>
                            </SheetContent>
                          </Sheet>
                          <Drawer>
                            <DrawerTrigger asChild>
                              <Button variant="outline">Drawer</Button>
                            </DrawerTrigger>
                            <DrawerContent>
                              <DrawerHeader>
                                <DrawerTitle>Review drawer</DrawerTitle>
                                <DrawerDescription>Drawer is available for mobile-first review flows.</DrawerDescription>
                              </DrawerHeader>
                            </DrawerContent>
                          </Drawer>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline">Menu</Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem>Refresh</DropdownMenuItem>
                              <DropdownMenuItem>Open settings</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="outline">Alert dialog</Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Preview only</AlertDialogTitle>
                                <AlertDialogDescription>No destructive action is wired from this coverage panel.</AlertDialogDescription>
                              </AlertDialogHeader>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    </ResizablePanel>
                  </ResizablePanelGroup>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <Card>
                      <CardHeader>
                        <CardTitle>Navigation primitives</CardTitle>
                        <CardDescription>Navigation menu and menubar coverage for desktop command surfaces.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <NavigationMenu>
                          <NavigationMenuList>
                            {["Code", "Actions", "Settings"].map((item) => (
                              <NavigationMenuItem key={item}>
                                <NavigationMenuLink className="rounded-md px-3 py-2 text-sm hover:bg-accent">{item}</NavigationMenuLink>
                              </NavigationMenuItem>
                            ))}
                          </NavigationMenuList>
                        </NavigationMenu>
                        <Menubar>
                          <MenubarMenu>
                            <MenubarTrigger>Repository</MenubarTrigger>
                            <MenubarContent>
                              <MenubarItem>Refresh</MenubarItem>
                              <MenubarItem>Open on GitHub</MenubarItem>
                            </MenubarContent>
                          </MenubarMenu>
                          <MenubarMenu>
                            <MenubarTrigger>Review</MenubarTrigger>
                            <MenubarContent>
                              <MenubarItem>Comment</MenubarItem>
                              <MenubarItem>Approve</MenubarItem>
                            </MenubarContent>
                          </MenubarMenu>
                        </Menubar>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader>
                        <CardTitle>Carousel and sidebar</CardTitle>
                        <CardDescription>Compact previews for components that are not primary workflows yet.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <Carousel className="mx-auto w-full max-w-sm">
                          <CarouselContent>
                            {["Local-first cache", "GitHub continuity", "Review drafting"].map((label) => (
                              <CarouselItem key={label}>
                                <div className="rounded-md border border-neutral-800 p-4 text-sm">{label}</div>
                              </CarouselItem>
                            ))}
                          </CarouselContent>
                          <CarouselPrevious />
                          <CarouselNext />
                        </Carousel>
                        <SidebarProvider className="min-h-0! rounded-md border border-neutral-800" style={{ minHeight: 132 }}>
                          <Sidebar collapsible="none" className="w-44">
                            <SidebarContent>
                              <SidebarGroup>
                                <SidebarGroupLabel>Preview</SidebarGroupLabel>
                                <SidebarGroupContent>
                                  <SidebarMenu>
                                    <SidebarMenuItem>
                                      <SidebarMenuButton isActive>
                                        <Activity />
                                        <span>Status</span>
                                      </SidebarMenuButton>
                                    </SidebarMenuItem>
                                    <SidebarMenuItem>
                                      <SidebarMenuButton>
                                        <Settings2 />
                                        <span>Settings</span>
                                      </SidebarMenuButton>
                                    </SidebarMenuItem>
                                  </SidebarMenu>
                                </SidebarGroupContent>
                              </SidebarGroup>
                            </SidebarContent>
                          </Sidebar>
                          <SidebarInset className="min-h-0 p-3">
                            <TypographyMuted>Sidebar components are available without replacing the main app chrome yet.</TypographyMuted>
                          </SidebarInset>
                        </SidebarProvider>
                      </CardContent>
                    </Card>
                  </div>

                  <Collapsible>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost">Advanced coverage notes</Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <Empty>
                        <EmptyHeader>
                          <EmptyMedia>
                            <CalendarDays className="size-5" />
                          </EmptyMedia>
                          <EmptyTitle>Every catalog primitive is wired</EmptyTitle>
                          <EmptyDescription>
                            Calendar, carousel, date picker, input OTP, navigation menu, menubar, and chart are intentionally present here.
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    </CollapsibleContent>
                  </Collapsible>
                  <Separator />
                  <Textarea readOnly value="Textarea coverage: review and commit flows use the same primitive in real workflow surfaces." />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost">
                        <MessageSquare className="size-4" />
                        Tooltip
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Tooltips name compact controls.</TooltipContent>
                  </Tooltip>
                </TabsContent>
              </Tabs>
            </div>
          </DirectionProvider>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
