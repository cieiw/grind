"use client";
/* eslint-disable react-hooks/refs -- dnd-kit exposes callback refs and listeners for sortable elements. */

import { CSSProperties, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type Task = { id: string; label: string; done: boolean };
type Group = { id: string; title: string; tasks: Task[] };
type Habit = { id: string; label: string };
type Sticky = { id: string; text: string; expiresAt: string };
type PeriodType = "week" | "month";
type Snapshot = { id: string; periodType: PeriodType; periodNumber: number; views: number; posts: number; recordedAt: string };
type RoutineTemplate = { id: string; periodType: PeriodType; periodNumber: number; dayNumber: number; title: string; description: string; trackPosts: boolean };
type Account = {
  id: string; name: string; instagramUrl: string; batch: number | null; createdAt: string;
  views: number; posts: number; materialDays: number; materialScope: number; materialUpdatedAt: string;
  notes: string; completedRoutine: string[]; snapshots: Snapshot[];
};
type AppData = {
  revenue: Record<string, string>; tasks: Record<string, Group[]>; habits: Habit[]; habitChecks: Record<string, string[]>;
  summaries: Record<string, string>; revenueGoal: string; revenueGoalStart: string; revenueGoalEnd: string; accent: string; stickies: Sticky[]; accounts: Account[]; routineTemplates: RoutineTemplate[];
};
type MainView = "today" | "operation";
type OperationView = "overview" | "profile" | "material" | "routine";
type RevenueRange = "week" | "month" | "30days";

const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const localDateKey = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};
const parseDate = (value: string) => new Date(`${value}T12:00:00`);
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const moneyValue = (value: string) => Number(value.replace(/[^\d,.-]/g, "").replace(",", ".")) || 0;

const defaultGroups = (): Group[] => [
  { id: uid(), title: "Prioridades", tasks: [{ id: uid(), label: "", done: false }] },
];
const defaultTemplates = (): RoutineTemplate[] => [
  { id: uid(), periodType: "week", periodNumber: 1, dayNumber: 0, title: "Publicar conteúdo", description: "Manter consistência e registrar o resultado.", trackPosts: true },
  { id: uid(), periodType: "week", periodNumber: 1, dayNumber: 0, title: "Revisar métricas", description: "Anotar views e aprendizados.", trackPosts: false },
];
const initialData = (): AppData => ({
  revenue: {}, tasks: {}, habits: ["Treinar", "Leitura", "Planejar amanhã"].map((label) => ({ id: uid(), label })),
  habitChecks: {}, summaries: {}, revenueGoal: "1000", revenueGoalStart: `${new Date().getFullYear()}-01-01`, revenueGoalEnd: `${new Date().getFullYear()}-12-31`, accent: "#c9ff70", stickies: [], accounts: [], routineTemplates: defaultTemplates(),
});

function addDuration(value: number, unit: "days" | "weeks" | "months") {
  const date = new Date();
  if (unit === "months") date.setMonth(date.getMonth() + value);
  else date.setDate(date.getDate() + value * (unit === "weeks" ? 7 : 1));
  return date.toISOString();
}

function remainingLabel(expiresAt: string) {
  const days = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000));
  if (days === 0) return "termina hoje";
  return `${days}d restantes`;
}

function addMonthsClamped(date: Date, months: number) {
  const targetMonth = date.getMonth() + months;
  const lastDay = new Date(date.getFullYear(), targetMonth + 1, 0).getDate();
  return new Date(date.getFullYear(), targetMonth, Math.min(date.getDate(), lastDay));
}

function timeline(account: Account) {
  if (!account.createdAt) return { absoluteDay: 1, periodType: "week" as PeriodType, periodNumber: 1, dayNumber: 1 };
  const start = parseDate(account.createdAt);
  const now = parseDate(localDateKey(new Date()));
  const absoluteDay = Math.max(1, Math.floor((now.getTime() - start.getTime()) / 86400000) + 1);
  const firstMonthEnd = addMonthsClamped(start, 1);
  if (now < firstMonthEnd) return { absoluteDay, periodType: "week" as PeriodType, periodNumber: Math.ceil(absoluteDay / 7), dayNumber: ((absoluteDay - 1) % 7) + 1 };
  let periodNumber = 2;
  let periodStart = firstMonthEnd;
  let nextPeriodStart = addMonthsClamped(firstMonthEnd, 1);
  while (now >= nextPeriodStart) {
    periodNumber += 1;
    periodStart = nextPeriodStart;
    nextPeriodStart = addMonthsClamped(firstMonthEnd, periodNumber - 1);
  }
  return { absoluteDay, periodType: "month" as PeriodType, periodNumber, dayNumber: Math.max(1, Math.floor((now.getTime() - periodStart.getTime()) / 86400000) + 1) };
}

function materialStatus(account: Account) {
  const elapsed = Math.max(0, Math.floor((Date.now() - new Date(account.materialUpdatedAt).getTime()) / 86400000));
  const remaining = Math.max(0, account.materialDays - elapsed);
  return { remaining, percent: Math.min(100, Math.round((remaining / Math.max(1, account.materialScope)) * 100)) };
}

function accentInk(hex: string) {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 145 ? "#101312" : "#ffffff";
}

function Icon({ name }: { name: "today" | "operation" | "overview" | "profile" | "material" | "routine" | "logout" }) {
  const paths = {
    today: <><path d="M4 6h16v14H4z"/><path d="M8 3v6M16 3v6M4 11h16"/></>,
    operation: <><path d="M4 19V9l8-5 8 5v10"/><path d="M8 19v-6h8v6"/></>,
    overview: <><circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-4 2-6 5-6s5 2 5 6M14 15c3-1 7 1 7 5"/></>,
    profile: <><circle cx="12" cy="8" r="4"/><path d="M4 21c0-5 3-8 8-8s8 3 8 8"/></>,
    material: <><path d="M4 7l8-4 8 4-8 4z"/><path d="M4 7v10l8 4 8-4V7M12 11v10"/></>,
    routine: <><path d="M9 5h11M9 12h11M9 19h11"/><path d="M3 5l1.5 1.5L7 3M3 12l1.5 1.5L7 10M3 19l1.5 1.5L7 17"/></>,
    logout: <><path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4"/><path d="M14 8l4 4-4 4M18 12H9"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function SortableItem({ id, className, children }: { id: string; className?: string; children: (handle: { attributes: ReturnType<typeof useSortable>["attributes"]; listeners: ReturnType<typeof useSortable>["listeners"] }) => React.ReactNode }) {
  const sortable = useSortable({ id });
  const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };
  return <div ref={sortable.setNodeRef} style={style} className={className}>{children({ attributes: sortable.attributes, listeners: sortable.listeners })}</div>;
}

export default function Home() {
  const today = localDateKey(new Date());
  const [loaded, setLoaded] = useState(false);
  const [databaseUserId, setDatabaseUserId] = useState<string | null>(null);
  const [databaseReady, setDatabaseReady] = useState(false);
  const [databaseStatus, setDatabaseStatus] = useState<"connecting" | "saving" | "saved" | "error">("connecting");
  const [databaseError, setDatabaseError] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [data, setDataState] = useState<AppData>(() => initialData());
  const dataRef = useRef(data);
  const saveTimerRef = useRef<number | null>(null);
  const summaryRef = useRef<HTMLTextAreaElement | null>(null);
  const [selectedDate, setSelectedDate] = useState(today);
  const [cursor, setCursor] = useState(() => new Date());
  const [accent, setAccent] = useState("#c9ff70");
  const [mainView, setMainView] = useState<MainView>("today");
  const [operationView, setOperationView] = useState<OperationView>("overview");
  const [habitName, setHabitName] = useState("");
  const [stickyText, setStickyText] = useState("");
  const [stickyDuration, setStickyDuration] = useState(1);
  const [stickyUnit, setStickyUnit] = useState<"days" | "weeks" | "months">("weeks");
  const [revenueRange, setRevenueRange] = useState<RevenueRange>("week");
  const [goalSettingsOpen, setGoalSettingsOpen] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [batchFilter, setBatchFilter] = useState<number | "all" | "unbatched">("all");
  const [sortMode, setSortMode] = useState<"manual" | "old" | "new">("manual");
  const [cardSize, setCardSize] = useState(210);
  const [materialSelection, setMaterialSelection] = useState<string[]>([]);
  const [materialDays, setMaterialDays] = useState(0);
  const [materialScope, setMaterialScope] = useState(30);
  const [routinePeriodType, setRoutinePeriodType] = useState<PeriodType>("week");
  const [routinePeriodNumber, setRoutinePeriodNumber] = useState(1);
  const [routineDayNumber, setRoutineDayNumber] = useState(0);
  const [overviewAccountIds, setOverviewAccountIds] = useState<string[]>([]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 7 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  function setData(nextState: AppData | ((current: AppData) => AppData)) {
    const next = typeof nextState === "function" ? nextState(dataRef.current) : nextState;
    dataRef.current = next;
    setDataState(next);
    if (!loaded || !databaseUserId || !databaseReady) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    setDatabaseStatus("saving");
    saveTimerRef.current = window.setTimeout(() => { void (async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      const result = await supabase.from("grind_states").upsert({ user_id: databaseUserId, data: next, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (result.error) { setDatabaseStatus("error"); setDatabaseError(result.error.message); return; }
      setDatabaseStatus("saved"); setDatabaseError("");
    })(); }, 500);
  }

  function resizeSummary(element: HTMLTextAreaElement) {
    element.style.height = "72px";
    element.style.height = `${Math.max(72, element.scrollHeight)}px`;
  }

  function reorderGroups(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    updateGroups((current) => arrayMove(current, current.findIndex((item) => item.id === active.id), current.findIndex((item) => item.id === over.id)));
  }

  function reorderTasks(groupId: string, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    updateGroups((current) => current.map((group) => group.id !== groupId ? group : { ...group, tasks: arrayMove(group.tasks, group.tasks.findIndex((item) => item.id === active.id), group.tasks.findIndex((item) => item.id === over.id)) }));
  }

  function reorderHabits(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setData((current) => ({ ...current, habits: arrayMove(current.habits, current.habits.findIndex((item) => item.id === active.id), current.habits.findIndex((item) => item.id === over.id)) }));
  }

  function reorderAccounts(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setData((current) => ({ ...current, accounts: arrayMove(current.accounts, current.accounts.findIndex((item) => item.id === active.id), current.accounts.findIndex((item) => item.id === over.id)) }));
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const saved = localStorage.getItem("grind-v2");
      if (saved) {
        try { const parsed = JSON.parse(saved) as AppData; dataRef.current = parsed; setDataState(parsed); setAccent(parsed.accent ?? (localStorage.getItem("grind-accent") || "#c9ff70")); } catch { /* mantém a base inicial */ }
      } else {
        const legacy = localStorage.getItem("discipline-data");
        if (legacy) {
          try {
            const old = JSON.parse(legacy) as Record<string, { revenue?: string; groups?: Group[]; habits?: Array<Habit & { done: boolean }> }>;
            const migrated = initialData();
            for (const [date, record] of Object.entries(old)) {
              if (record.revenue) migrated.revenue[date] = record.revenue;
              if (record.groups) migrated.tasks[date] = record.groups;
              if (record.habits) migrated.habitChecks[date] = record.habits.filter((habit) => habit.done).map((habit) => habit.id);
            }
            const firstHabits = Object.values(old).find((record) => record.habits?.length)?.habits;
            if (firstHabits) migrated.habits = firstHabits.map(({ id, label }) => ({ id, label }));
            dataRef.current = migrated; setDataState(migrated);
          } catch { /* ignora dados antigos inválidos */ }
        }
      }
      setAccent((current) => current || localStorage.getItem("grind-accent") || "#c9ff70");

      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setLoaded(true);
        return;
      }

      void (async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setLoaded(true);
          return;
        }

        setDatabaseUserId(user.id);
        setLoaded(true);
      })();
    });
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => { if (loaded) localStorage.setItem("grind-v2", JSON.stringify(data)); }, [data, loaded]);
  useEffect(() => {
    if (!loaded || !databaseUserId || databaseReady) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    void (async () => {
      setDatabaseStatus("connecting"); setDatabaseError("");
      const result = await supabase.from("grind_states").select("data").eq("user_id", databaseUserId).maybeSingle();
      if (result.error) {
        setDatabaseStatus("error"); setDatabaseError(result.error.message); return;
      }
      if (result.data?.data && Object.keys(result.data.data as object).length) {
        const remoteData = result.data.data as AppData;
        dataRef.current = remoteData; setDataState(remoteData);
        setAccent(remoteData.accent ?? "#c9ff70");
      } else {
        const write = await supabase.from("grind_states").upsert({ user_id: databaseUserId, data: dataRef.current, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
        if (write.error) {
          setDatabaseStatus("error"); setDatabaseError(write.error.message); return;
        }
      }
      setDatabaseReady(true); setDatabaseStatus("saved");
    })();
  }, [data, databaseReady, databaseUserId, loaded]);
  useEffect(() => { if (loaded) localStorage.setItem("grind-accent", accent); }, [accent, loaded]);
  useEffect(() => { const frame = requestAnimationFrame(() => { if (summaryRef.current) resizeSummary(summaryRef.current); }); return () => cancelAnimationFrame(frame); }, [data.summaries, selectedDate]);

  const groups = data.tasks[selectedDate] ?? defaultGroups();
  const pendingTaskCount = groups.reduce((total, group) => total + group.tasks.filter((task) => task.label.trim() && !task.done).length, 0);
  const checkedHabits = data.habitChecks[selectedDate] ?? [];
  const selectedAccount = data.accounts.find((item) => item.id === selectedAccountId) ?? data.accounts[0];
  const monthDays = useMemo(() => {
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1).getDay();
    const count = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    return Array.from({ length: start + count }, (_, index) => index < start ? null : new Date(cursor.getFullYear(), cursor.getMonth(), index - start + 1));
  }, [cursor]);
  const activeStickies = data.stickies.filter((item) => new Date(item.expiresAt).getTime() > parseDate(today).getTime());
  const rangeRevenue = useMemo(() => {
    const end = parseDate(today); const start = new Date(end);
    if (revenueRange === "week") start.setDate(end.getDate() - 6);
    if (revenueRange === "30days") start.setDate(end.getDate() - 29);
    if (revenueRange === "month") start.setDate(1);
    return Object.entries(data.revenue).filter(([date]) => parseDate(date) >= start && parseDate(date) <= end).reduce((sum, [, value]) => sum + moneyValue(value), 0);
  }, [data.revenue, revenueRange, today]);
  const goalStart = data.revenueGoalStart ?? `${new Date().getFullYear()}-01-01`;
  const goalEnd = data.revenueGoalEnd ?? `${new Date().getFullYear()}-12-31`;
  const goalAmount = moneyValue(data.revenueGoal ?? "1000");
  const goalRevenue = useMemo(() => Object.entries(data.revenue).filter(([date]) => date >= goalStart && date <= goalEnd).reduce((sum, [, value]) => sum + moneyValue(value), 0), [data.revenue, goalStart, goalEnd]);
  const goalProgress = Math.min(100, (goalRevenue / Math.max(1, goalAmount)) * 100);
  const filteredAccounts = useMemo(() => {
    const items = data.accounts.filter((account) => batchFilter === "all" || (batchFilter === "unbatched" ? account.batch == null : account.batch === batchFilter));
    if (sortMode === "old") return [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (sortMode === "new") return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return items;
  }, [data.accounts, batchFilter, sortMode]);
  const batchNumbers = [...new Set(data.accounts.map((item) => item.batch).filter((batch): batch is number => batch != null))].sort((a, b) => a - b);
  const overviewAccounts = overviewAccountIds.length ? filteredAccounts.filter((account) => overviewAccountIds.includes(account.id)) : filteredAccounts;

  function updateGroups(transform: (current: Group[]) => Group[]) {
    setData((current) => ({ ...current, tasks: { ...current.tasks, [selectedDate]: transform(current.tasks[selectedDate] ?? defaultGroups()) } }));
  }
  function rolloverPendingTasks() {
    if (!pendingTaskCount) return;
    const destination = parseDate(selectedDate);
    destination.setDate(destination.getDate() + 1);
    const destinationDate = localDateKey(destination);

    setData((current) => {
      const sourceGroups = current.tasks[selectedDate] ?? defaultGroups();
      const destinationGroups = [...(current.tasks[destinationDate] ?? [])];

      for (const sourceGroup of sourceGroups) {
        const pending = sourceGroup.tasks
          .filter((task) => task.label.trim() && !task.done)
          .map((task) => ({ ...task, id: uid(), done: false }));
        if (!pending.length) continue;

        const existingIndex = destinationGroups.findIndex((group) => group.title === sourceGroup.title);
        if (existingIndex >= 0) {
          const existing = destinationGroups[existingIndex];
          destinationGroups[existingIndex] = { ...existing, tasks: [...existing.tasks, ...pending] };
        } else {
          destinationGroups.push({ id: uid(), title: sourceGroup.title, tasks: pending });
        }
      }

      const sourceAfterMove = sourceGroups.map((group) => ({
        ...group,
        tasks: group.tasks.filter((task) => task.done || !task.label.trim()),
      }));

      return {
        ...current,
        tasks: { ...current.tasks, [selectedDate]: sourceAfterMove, [destinationDate]: destinationGroups },
      };
    });

    setSelectedDate(destinationDate);
    setCursor(new Date(destination.getFullYear(), destination.getMonth(), 1));
  }
  function updateAccount(id: string, patch: Partial<Account>) {
    setData((current) => ({ ...current, accounts: current.accounts.map((item) => item.id === id ? { ...item, ...patch } : item) }));
  }
  function addTaskAfter(event: KeyboardEvent<HTMLInputElement>, groupId: string, taskId: string) {
    if (event.key !== "Enter") return;
    event.preventDefault(); const nextId = uid();
    updateGroups((current) => current.map((group) => group.id === groupId ? { ...group, tasks: group.tasks.flatMap((task) => task.id === taskId ? [task, { id: nextId, label: "", done: false }] : [task]) } : group));
    requestAnimationFrame(() => document.getElementById(nextId)?.focus());
  }
  function habitStreak(habitId: string) {
    let count = 0; const cursorDate = parseDate(today);
    while ((data.habitChecks[localDateKey(cursorDate)] ?? []).includes(habitId)) { count++; cursorDate.setDate(cursorDate.getDate() - 1); }
    return count;
  }
  function createSticky(event: FormEvent) {
    event.preventDefault(); if (!stickyText.trim()) return;
    setData((current) => ({ ...current, stickies: [...activeStickies, { id: uid(), text: stickyText.trim(), expiresAt: addDuration(stickyDuration, stickyUnit) }] }));
    setStickyText("");
  }
  function createAccount(event: FormEvent) {
    event.preventDefault(); if (!accountName.trim()) return;
    const account: Account = { id: uid(), name: accountName.trim(), instagramUrl: "", batch: null, createdAt: today, views: 0, posts: 0, materialDays: 0, materialScope: 30, materialUpdatedAt: new Date().toISOString(), notes: "", completedRoutine: [], snapshots: [] };
    setData((current) => ({ ...current, accounts: [...current.accounts, account] })); setSelectedAccountId(account.id); setAccountName("");
  }
  function accountRoutine(account: Account) {
    const time = timeline(account);
    return data.routineTemplates.filter((item) => item.periodType === time.periodType && item.periodNumber === time.periodNumber && (item.dayNumber === 0 || item.dayNumber === time.dayNumber));
  }
  function saveSnapshot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedAccount) return;
    const form = new FormData(event.currentTarget); const time = timeline(selectedAccount);
    const views = Number(form.get("views") || 0); const posts = selectedAccount.posts;
    const snapshot: Snapshot = { id: uid(), periodType: time.periodType, periodNumber: time.periodNumber, views, posts, recordedAt: new Date().toISOString() };
    updateAccount(selectedAccount.id, { views, posts, snapshots: [...selectedAccount.snapshots.filter((item) => !(item.periodType === time.periodType && item.periodNumber === time.periodNumber)), snapshot] });
  }
  function applyMaterial(event: FormEvent) {
    event.preventDefault(); const targets = materialSelection;
    if (!targets.length) return;
    setData((current) => ({ ...current, accounts: current.accounts.map((item) => targets.includes(item.id) ? { ...item, materialDays, materialScope, materialUpdatedAt: new Date().toISOString() } : item) }));
  }
  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    setAuthBusy(true); setAuthMessage("");
    const result = await supabase.auth.signInWithPassword({ email: authEmail.trim(), password: authPassword });
    setAuthBusy(false);
    if (result.error) { setAuthMessage(result.error.message); return; }
    if (!result.data.user || !result.data.session) { setAuthMessage("Não foi possível entrar. Confira seu e-mail e senha."); return; }
    setDatabaseReady(false); setDatabaseStatus("connecting"); setDatabaseError(""); setDatabaseUserId(result.data.user.id); setAuthPassword("");
  }
  async function signOut() {
    const supabase = getSupabaseBrowserClient();
    if (supabase) await supabase.auth.signOut();
    setDatabaseReady(false); setDatabaseStatus("connecting"); setDatabaseError(""); setDatabaseUserId(null); setAuthPassword("");
  }

  if (!loaded) return <main className="loading-state">Carregando…</main>;
  const supabaseConfigured = Boolean(getSupabaseBrowserClient());
  if (!supabaseConfigured) return <main className="auth-shell"><section className="auth-card"><span className="auth-mark" aria-hidden="true" /><h1>Conexão pendente</h1><p>Configure as variáveis públicas do Supabase para liberar o login e seus dados salvos.</p><code>NEXT_PUBLIC_SUPABASE_URL<br/>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code></section></main>;
  if (supabaseConfigured && !databaseUserId) return <main className="auth-shell">
    <form className="auth-card" onSubmit={authenticate}>
      <span className="auth-mark" aria-hidden="true" />
      <h1>Entrar</h1>
      <p>Entre para acessar seus dados salvos.</p>
      <label>Usuário (e-mail)<input type="email" autoComplete="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} required placeholder="voce@exemplo.com" /></label>
      <label>Senha<input type="password" autoComplete="current-password" minLength={6} value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} required placeholder="Sua senha" /></label>
      {authMessage ? <p className="auth-message">{authMessage}</p> : null}
      <button className="primary auth-submit" disabled={authBusy}>{authBusy ? "Aguarde…" : "Entrar"}</button>
    </form>
  </main>;
  const themeStyle = { "--accent": accent, "--accent-ink": accentInk(accent) } as CSSProperties;

  return <main className="app-shell" style={themeStyle}>
    <header className="topbar">
      <nav className="main-tabs" aria-label="Áreas do aplicativo">
        <button aria-label="Hoje" className={mainView === "today" ? "active" : ""} onClick={() => setMainView("today")}><Icon name="today"/><span>Hoje</span></button>
        <button aria-label="Operação" className={mainView === "operation" ? "active" : ""} onClick={() => setMainView("operation")}><Icon name="operation"/><span>Operação</span></button>
      </nav>
      <div className="top-actions"><span className="selected-date">{parseDate(selectedDate).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" })}</span>{databaseStatus === "error" ? <span className="database-status error" title={databaseError}>erro ao salvar</span> : null}<label className="color-control" title="Cor do aplicativo"><input type="color" value={accent} onInput={(event) => { const nextAccent = event.currentTarget.value; setAccent(nextAccent); setData((current) => ({ ...current, accent: nextAccent })); }} aria-label="Cor do aplicativo" /></label>{supabaseConfigured ? <button className="logout-button" onClick={signOut} aria-label="Sair" title="Sair"><Icon name="logout"/></button> : null}</div>
    </header>

    {mainView === "today" ? <div className="today-view">
      <div className="task-workspace">
        <section className="panel daily-summary">
          <textarea ref={summaryRef} value={data.summaries?.[selectedDate] ?? ""} onInput={(event) => resizeSummary(event.currentTarget)} onChange={(event) => setData((current) => ({ ...current, summaries: { ...(current.summaries ?? {}), [selectedDate]: event.target.value } }))} placeholder="Escreva o que importa hoje: foco, decisões, aprendizados ou próximos passos." aria-label="Resumo do dia" />
        </section>
        <section className="tasks-section">
        <DndContext sensors={sensors} onDragEnd={reorderGroups}><SortableContext items={groups.map((group) => group.id)} strategy={rectSortingStrategy}><div className="group-grid">{groups.map((group) => <SortableItem id={group.id} key={group.id}>{groupHandle => <article className="task-group">
          <div className="group-title"><button className="drag-handle" {...groupHandle.attributes} {...groupHandle.listeners} aria-label="Arrastar grupo">⠿</button><input value={group.title} onChange={(event) => updateGroups((current) => current.map((item) => item.id === group.id ? { ...item, title: event.target.value } : item))} aria-label="Nome do grupo"/><button onClick={() => updateGroups((current) => current.filter((item) => item.id !== group.id))} aria-label="Excluir grupo">×</button></div>
          <DndContext sensors={sensors} onDragEnd={(event) => reorderTasks(group.id, event)}><SortableContext items={group.tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}><div className="task-list">{group.tasks.map((task) => <SortableItem id={task.id} className={`task-row ${task.done ? "checked" : ""}`} key={task.id}>{taskHandle => <><button className="drag-handle" {...taskHandle.attributes} {...taskHandle.listeners} aria-label="Arrastar tarefa">⠿</button><button className="check" onClick={() => updateGroups((current) => current.map((item) => item.id === group.id ? { ...item, tasks: item.tasks.map((row) => row.id === task.id ? { ...row, done: !row.done } : row) } : item))} aria-label="Concluir tarefa">✓</button><input id={task.id} value={task.label} placeholder="Escreva uma tarefa" onChange={(event) => updateGroups((current) => current.map((item) => item.id === group.id ? { ...item, tasks: item.tasks.map((row) => row.id === task.id ? { ...row, label: event.target.value } : row) } : item))} onKeyDown={(event) => addTaskAfter(event, group.id, task.id)}/><button className="quiet-delete" onClick={() => updateGroups((current) => current.map((item) => item.id === group.id ? { ...item, tasks: item.tasks.filter((row) => row.id !== task.id) } : item))} aria-label="Excluir tarefa">×</button></>}</SortableItem>)}</div></SortableContext></DndContext>
          <button className="text-button" onClick={() => { const id = uid(); updateGroups((current) => current.map((item) => item.id === group.id ? { ...item, tasks: [...item.tasks, { id, label: "", done: false }] } : item)); requestAnimationFrame(() => document.getElementById(id)?.focus()); }}>+ tarefa</button>
        </article>}</SortableItem>)}</div></SortableContext></DndContext>
        <div className="section-actions task-actions"><button className="rollover-button" disabled={!pendingTaskCount} onClick={rolloverPendingTasks} title="Mover tarefas não concluídas para o dia seguinte"><span>{pendingTaskCount || ""}</span> pendentes → amanhã</button><button className="primary compact-button" onClick={() => updateGroups((current) => [...current, { id: uid(), title: "Novo grupo", tasks: [{ id: uid(), label: "", done: false }] }])}>+ grupo</button></div>
        </section>
      </div>

      <div className="daily-grid">
        <section className="panel habits-panel">
          <div className="section-line"><span className="count-pill">{checkedHabits.length}/{data.habits.length}</span></div>
          <DndContext sensors={sensors} onDragEnd={reorderHabits}><SortableContext items={data.habits.map((habit) => habit.id)} strategy={verticalListSortingStrategy}><div className="habit-list">{data.habits.map((habit) => <SortableItem id={habit.id} className={`habit-row ${checkedHabits.includes(habit.id) ? "checked" : ""}`} key={habit.id}>{habitHandle => <><button className="drag-handle" {...habitHandle.attributes} {...habitHandle.listeners} aria-label="Arrastar hábito">⠿</button><input id={`habit-${habit.id}`} type="checkbox" checked={checkedHabits.includes(habit.id)} onChange={() => setData((current) => { const currentChecks = current.habitChecks[selectedDate] ?? []; return { ...current, habitChecks: { ...current.habitChecks, [selectedDate]: currentChecks.includes(habit.id) ? currentChecks.filter((id) => id !== habit.id) : [...currentChecks, habit.id] } }; })}/><label htmlFor={`habit-${habit.id}`} className="check">✓</label><span>{habit.label}</span><small>{habitStreak(habit.id)}d</small><button onClick={() => setData((current) => ({ ...current, habits: current.habits.filter((item) => item.id !== habit.id) }))}>×</button></>}</SortableItem>)}</div></SortableContext></DndContext>
          <form className="inline-add" onSubmit={(event) => { event.preventDefault(); if (!habitName.trim()) return; setData((current) => ({ ...current, habits: [...current.habits, { id: uid(), label: habitName.trim() }] })); setHabitName(""); }}><input value={habitName} onChange={(event) => setHabitName(event.target.value)} placeholder="Novo hábito"/><button className="primary">+</button></form>
        </section>

        <section className="panel calendar-panel">
          <div className="calendar-top"><button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>‹</button><strong>{cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</strong><button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>›</button></div>
          <div className="weekdays">{["D","S","T","Q","Q","S","S"].map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}</div>
          <div className="calendar-grid">{monthDays.map((date, index) => date ? <button key={localDateKey(date)} className={`${localDateKey(date) === selectedDate ? "selected" : ""} ${localDateKey(date) === today ? "today" : ""}`} onClick={() => setSelectedDate(localDateKey(date))}>{date.getDate()}{data.revenue[localDateKey(date)] ? <i/> : null}</button> : <span key={`blank-${index}`}/>)}</div>
          <button className="text-button today-link" onClick={() => { setSelectedDate(today); setCursor(new Date()); }}>hoje</button>
        </section>

        <section className="panel sticky-panel">
          <form className="sticky-form" onSubmit={createSticky}><textarea maxLength={140} value={stickyText} onChange={(event) => setStickyText(event.target.value)} placeholder="Escrever lembrete"/><div className="sticky-controls"><input type="number" min="1" value={stickyDuration} onChange={(event) => setStickyDuration(Math.max(1, Number(event.target.value)))}/><select value={stickyUnit} onChange={(event) => setStickyUnit(event.target.value as typeof stickyUnit)}><option value="days">dias</option><option value="weeks">semanas</option><option value="months">meses</option></select><button className="primary">+</button></div></form>
          <div className="sticky-list">{activeStickies.map((note) => <article className="sticky-card" key={note.id}><p>{note.text}</p><footer><span>{remainingLabel(note.expiresAt)}</span><button aria-label="Excluir nota" onClick={() => setData((current) => ({ ...current, stickies: current.stickies.filter((item) => item.id !== note.id) }))}>×</button></footer></article>)}</div>
        </section>
      </div>

      <section className="revenue-strip">
        <div className="revenue-input"><span>R$</span><input inputMode="decimal" value={data.revenue[selectedDate] ?? ""} onChange={(event) => setData((current) => ({ ...current, revenue: { ...current.revenue, [selectedDate]: event.target.value.replace(/[^\d,.]/g, "") } }))} placeholder="0,00" aria-label="Faturamento do dia"/></div>
        <div className="range-tabs">{([['week','7d'],['month','mês'],['30days','30d']] as [RevenueRange,string][]).map(([value,label]) => <button className={revenueRange === value ? "active" : ""} onClick={() => setRevenueRange(value)} key={value}>{label}</button>)}</div>
        <div className="revenue-total"><strong>{money.format(rangeRevenue)}</strong><button className="text-button goal-settings-button" onClick={() => setGoalSettingsOpen((open) => !open)}>{goalSettingsOpen ? "fechar meta" : "configurar meta"}</button></div>
        <div className="mini-metrics"><div><span>meta · {money.format(goalRevenue)} de {money.format(goalAmount)}</span><i><b style={{ width: `${goalProgress}%` }}/></i></div><div><label>{goalStart.split("-").reverse().join("/")} — {goalEnd.split("-").reverse().join("/")} · {Math.round(goalProgress)}%</label><i><b style={{ width: `${goalProgress}%` }}/></i></div></div>
        {goalSettingsOpen ? <div className="goal-settings"><label>Meta em R$<input inputMode="decimal" value={data.revenueGoal ?? "1000"} onChange={(event) => setData((current) => ({ ...current, revenueGoal: event.target.value.replace(/[^\d,.]/g, "") }))} placeholder="1000,00"/></label><label>Data inicial<input type="date" value={goalStart} onChange={(event) => setData((current) => ({ ...current, revenueGoalStart: event.target.value }))}/></label><label>Data final<input type="date" min={goalStart} value={goalEnd} onChange={(event) => setData((current) => ({ ...current, revenueGoalEnd: event.target.value }))}/></label></div> : null}
      </section>
    </div> : null}

    {mainView === "operation" ? <div className="operation-view">
      <div className="operation-tabs" aria-label="Modo da operação">{([['overview','overview','Geral'],['profile','profile','Perfil'],['material','material','Material'],['routine','routine','Rotina']] as [OperationView, Parameters<typeof Icon>[0]['name'], string][]).map(([value, icon, label]) => <button aria-label={label} key={value} className={operationView === value ? "active" : ""} onClick={() => setOperationView(value)}><Icon name={icon}/><span>{label}</span></button>)}</div>
      <div className="operation-layout">
        <aside className="account-rail">
          <form className="account-create" onSubmit={createAccount}><input value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="Modelo"/><button className="primary">+</button></form>
          <select value={batchFilter} onChange={(event) => setBatchFilter(event.target.value === "all" || event.target.value === "unbatched" ? event.target.value : Number(event.target.value))}><option value="all">Todos os lotes</option><option value="unbatched">Sem lote</option>{batchNumbers.map((batch) => <option value={batch} key={batch}>Lote {batch}</option>)}</select>
          <div className="account-list">{filteredAccounts.map((account) => { const time = timeline(account); const routine = accountRoutine(account); const done = routine.filter((item) => account.completedRoutine.includes(item.id)).length; return <button className={selectedAccount?.id === account.id ? "active" : ""} key={account.id} onClick={() => setSelectedAccountId(account.id)}><strong>{account.name}</strong><span>{time.periodType === "week" ? `Semana ${time.periodNumber}` : `Mês ${time.periodNumber}`} · dia {time.dayNumber}</span><i><b style={{ width: `${routine.length ? done / routine.length * 100 : 0}%` }}/></i></button>; })}{!filteredAccounts.length ? <p className="empty-state">Adicione o primeiro perfil.</p> : null}</div>
        </aside>

        <section className="operation-workspace">
          {operationView === "overview" ? <>
            <div className="workspace-tools"><label>Cards <input type="range" min="170" max="300" value={cardSize} onChange={(event) => setCardSize(Number(event.target.value))}/></label><select value={sortMode} onChange={(event) => setSortMode(event.target.value as typeof sortMode)}><option value="manual">Arrastar para ordenar</option><option value="old">Mais antigas</option><option value="new">Mais novas</option></select><details className="model-filter"><summary>{overviewAccountIds.length ? `${overviewAccountIds.length} modelos` : "Todas modelos"}</summary><div>{filteredAccounts.map((account) => <label key={account.id}><input type="checkbox" checked={overviewAccountIds.includes(account.id)} onChange={() => setOverviewAccountIds((current) => current.includes(account.id) ? current.filter((id) => id !== account.id) : [...current, account.id])}/><span>{account.name}</span></label>)}<button type="button" onClick={() => setOverviewAccountIds([])}>Mostrar todas</button></div></details></div>
            <DndContext sensors={sensors} onDragEnd={reorderAccounts}><SortableContext items={overviewAccounts.map((account) => account.id)} strategy={rectSortingStrategy}><div className="overview-grid" style={{ "--card-size": `${cardSize}px` } as CSSProperties}>{overviewAccounts.map((account) => { const time = timeline(account); const routine = accountRoutine(account); const done = routine.filter((item) => account.completedRoutine.includes(item.id)).length; const material = materialStatus(account); const snapshots = [...account.snapshots].sort((a,b) => a.recordedAt.localeCompare(b.recordedAt)); const previous = snapshots.length > 1 ? snapshots[snapshots.length - 2].views : 0; const growth = previous ? ((account.views - previous) / previous) * 100 : 0; return <SortableItem id={account.id} key={account.id}>{accountHandle => <article className="overview-card">
              <div className="card-head"><button onClick={() => { setSelectedAccountId(account.id); setOperationView("profile"); }}><strong>{account.name}</strong><span>dia {time.absoluteDay}</span></button><div><button className="drag-handle" {...accountHandle.attributes} {...accountHandle.listeners} aria-label="Arrastar modelo">⠿</button><button onClick={() => setData((current) => ({ ...current, accounts: current.accounts.filter((item) => item.id !== account.id) }))} aria-label="Excluir">×</button></div></div>
              <dl><div><dt>Views</dt><dd>{compact.format(account.views)}</dd></div><div><dt>Reels</dt><dd>{account.posts}</dd></div><div><dt>Rotina</dt><dd>{done}/{routine.length}</dd></div><div><dt>Var.</dt><dd className={growth >= 0 ? "positive" : "negative"}>{growth ? `${growth > 0 ? "+" : ""}${growth.toFixed(1)}%` : "–"}</dd></div></dl>
              <div className="card-progress"><span>rotina</span><i><b style={{ width: `${routine.length ? done / routine.length * 100 : 0}%` }}/></i></div><div className="card-progress"><span>material · {material.remaining}/{account.materialScope}d</span><i><b style={{ width: `${material.percent}%` }}/></i></div>
            </article>}</SortableItem>; })}</div></SortableContext></DndContext>
          </> : null}

          {operationView === "profile" ? selectedAccount ? <div className="profile-view">
            <div className="profile-head"><input className="profile-name" value={selectedAccount.name} onChange={(event) => updateAccount(selectedAccount.id,{name:event.target.value})}/><button className="danger-text" onClick={() => setData((current) => ({ ...current, accounts: current.accounts.filter((item) => item.id !== selectedAccount.id) }))}>excluir</button></div>
            <div className="profile-fields"><label>Instagram<input type="url" value={selectedAccount.instagramUrl} onChange={(event) => updateAccount(selectedAccount.id,{instagramUrl:event.target.value})}/></label><label>Data de criação<input type="date" value={selectedAccount.createdAt} onChange={(event) => updateAccount(selectedAccount.id,{createdAt:event.target.value})}/></label><label>Lote<input type="number" min="1" value={selectedAccount.batch ?? ""} onChange={(event) => updateAccount(selectedAccount.id,{batch:event.target.value === "" ? null : Math.max(1,Number(event.target.value))})} placeholder="Sem lote"/></label><label>Período atual<input readOnly value={timeline(selectedAccount).periodType === "week" ? `Semana ${timeline(selectedAccount).periodNumber}` : `Mês ${timeline(selectedAccount).periodNumber}`}/></label><label>Dia de operação<input readOnly value={timeline(selectedAccount).absoluteDay}/></label></div>
            <form className="snapshot-form" onSubmit={saveSnapshot}><label>Views<input name="views" type="number" min="0" defaultValue={selectedAccount.views}/></label><div className="readonly-metric"><span>{selectedAccount.posts}</span><small>reels pela rotina</small></div><button className="primary">Salvar período</button></form>
            <textarea className="profile-notes" value={selectedAccount.notes} onChange={(event) => updateAccount(selectedAccount.id,{notes:event.target.value})} placeholder="Notas de progresso"/>
            <div className="insights"><div><strong>{compact.format(selectedAccount.views)}</strong><span>views</span></div><div><strong>{selectedAccount.posts}</strong><span>reels</span></div><div><strong>{selectedAccount.snapshots.length}</strong><span>fechamentos</span></div><div><strong>{timeline(selectedAccount).absoluteDay}</strong><span>dias</span></div></div>
          </div> : <p className="empty-state large">Adicione ou selecione um perfil.</p> : null}

          {operationView === "material" ? <div className="material-view">
            <div className="material-toolbar"><select value={batchFilter} onChange={(event) => setBatchFilter(event.target.value === "all" || event.target.value === "unbatched" ? event.target.value : Number(event.target.value))}><option value="all">Todos os lotes</option><option value="unbatched">Sem lote</option>{batchNumbers.map((batch) => <option value={batch} key={batch}>Lote {batch}</option>)}</select><button className="text-button" onClick={() => setMaterialSelection(materialSelection.length === filteredAccounts.length ? [] : filteredAccounts.map((item) => item.id))}>{materialSelection.length === filteredAccounts.length && filteredAccounts.length ? "limpar" : "selecionar todos"}</button></div>
            <form className="material-bulk" onSubmit={applyMaterial}><strong>Aplicar em lote</strong><label>Dias<input type="number" min="0" value={materialDays} onChange={(event) => setMaterialDays(Math.max(0,Number(event.target.value)))}/></label><label>Escopo<input type="number" min="1" value={materialScope} onChange={(event) => setMaterialScope(Math.max(1,Number(event.target.value)))}/></label><button className="primary" disabled={!materialSelection.length}>Aplicar a {materialSelection.length}</button></form>
            <div className="material-list">{filteredAccounts.map((account) => { const status = materialStatus(account); return <article className={materialSelection.includes(account.id) ? "selected" : ""} key={account.id}><input type="checkbox" checked={materialSelection.includes(account.id)} onChange={() => setMaterialSelection((current) => current.includes(account.id) ? current.filter((id) => id !== account.id) : [...current,account.id])}/><div><strong>{account.name}</strong><span>{account.batch == null ? "Sem lote" : `Lote ${account.batch}`}</span></div><label>Dias<input type="number" min="0" value={status.remaining} onChange={(event) => updateAccount(account.id,{materialDays:Number(event.target.value),materialUpdatedAt:new Date().toISOString()})}/></label><label>Escopo<input type="number" min="1" value={account.materialScope} onChange={(event) => updateAccount(account.id,{materialScope:Number(event.target.value)})}/></label><div className="material-bar"><span>{status.remaining}/{account.materialScope} dias</span><i><b style={{width:`${status.percent}%`}}/></i></div></article>; })}</div>
          </div> : null}

          {operationView === "routine" ? <div className="routine-view">
            <div className="routine-controls"><select value={routinePeriodType} onChange={(event) => setRoutinePeriodType(event.target.value as PeriodType)}><option value="week">Semana</option><option value="month">Mês</option></select><input type="number" min="1" value={routinePeriodNumber} onChange={(event) => setRoutinePeriodNumber(Math.max(1,Number(event.target.value)))}/><select value={routineDayNumber} onChange={(event) => setRoutineDayNumber(Number(event.target.value))}><option value="0">Todos os dias</option>{Array.from({length:routinePeriodType === "week" ? 7 : 31},(_,index) => index+1).map((day) => <option value={day} key={day}>Dia {day}</option>)}</select><button className="primary" onClick={() => setData((current) => ({...current,routineTemplates:[...current.routineTemplates,{id:uid(),periodType:routinePeriodType,periodNumber:routinePeriodNumber,dayNumber:routineDayNumber,title:"Nova etapa",description:"",trackPosts:false}]}))}>+ etapa</button></div>
            <div className="routine-templates">{data.routineTemplates.filter((item) => item.periodType === routinePeriodType && item.periodNumber === routinePeriodNumber && item.dayNumber === routineDayNumber).map((item) => <article key={item.id}><input value={item.title} onChange={(event) => setData((current) => ({...current,routineTemplates:current.routineTemplates.map((row) => row.id === item.id ? {...row,title:event.target.value}:row)}))}/><textarea value={item.description} onChange={(event) => setData((current) => ({...current,routineTemplates:current.routineTemplates.map((row) => row.id === item.id ? {...row,description:event.target.value}:row)}))}/><label><input type="checkbox" checked={item.trackPosts} onChange={(event) => setData((current) => ({...current,routineTemplates:current.routineTemplates.map((row) => row.id === item.id ? {...row,trackPosts:event.target.checked}:row)}))}/> soma reel</label><button onClick={() => setData((current) => ({...current,routineTemplates:current.routineTemplates.filter((row) => row.id !== item.id)}))}>×</button></article>)}</div>
            <div className="today-routines">{data.accounts.map((account) => { const time = timeline(account); const items = accountRoutine(account); return <section key={account.id}><header><strong>{account.name}</strong><span>{time.periodType === "week" ? `Semana ${time.periodNumber}` : `Mês ${time.periodNumber}`} · dia {time.dayNumber}</span></header>{items.map((item) => <label key={item.id}><input type="checkbox" checked={account.completedRoutine.includes(item.id)} onChange={() => { const completed = account.completedRoutine.includes(item.id) ? account.completedRoutine.filter((id) => id !== item.id) : [...account.completedRoutine,item.id]; updateAccount(account.id,{completedRoutine:completed,posts:item.trackPosts && !account.completedRoutine.includes(item.id) ? account.posts+1 : item.trackPosts && account.completedRoutine.includes(item.id) ? Math.max(0,account.posts-1):account.posts}); }}/><span className="check">✓</span><span><strong>{item.title}</strong><small>{item.description}</small></span></label>)}{!items.length ? <p>Sem etapas para hoje.</p> : null}</section>; })}</div>
          </div> : null}
        </section>
      </div>
    </div> : null}
  </main>;
}
