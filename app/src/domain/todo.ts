import { create, type StoreApi, type UseBoundStore } from 'zustand';

export type TodoFilter = 'today' | 'week' | 'other';

export interface TodoItem {
    id: string;
    title: string;
    completed: boolean;
    filter: TodoFilter;
    startTime: string;
    endTime: string;
    createdAt: number;
    updatedAt: number;
    completedAt: number | null;
}

export interface TodoState {
    currentTaskTitle: string;
    items: TodoItem[];
    activeFilter: TodoFilter;
    expanded: boolean;
    editingItemId: string | null;
}

export interface TodoSnapshot {
    currentTaskTitle: string;
    items: TodoItem[];
    activeFilter: TodoFilter;
    expanded: boolean;
}

export interface TodoActions {
    setCurrentTaskTitle: (title: string) => void;
    addCurrentTaskToTodo: () => TodoItem | null;
    setActiveFilter: (filter: TodoFilter) => void;
    setExpanded: (expanded: boolean) => void;
    beginEdit: (id: string) => void;
    finishEdit: (id: string) => void;
    updateItem: (id: string, patch: Partial<Pick<TodoItem, 'title' | 'startTime' | 'endTime'>>) => void;
    toggleCompleted: (id: string) => void;
    deleteItem: (id: string) => void;
    setItemAsCurrent: (id: string) => void;
    hydrateTodo: (snapshot: Partial<TodoSnapshot>) => void;
}

export type TodoStore = UseBoundStore<StoreApi<TodoState & TodoActions>>;

const TODO_FILTERS = new Set<TodoFilter>(['today', 'week', 'other']);

export function defaultTodoSnapshot(): TodoSnapshot {
    return {
        currentTaskTitle: '',
        items: [],
        activeFilter: 'today',
        expanded: true,
    };
}

function createTodoId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID();
    }
    return `todo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nowMs(): number {
    return Date.now();
}

function normalizeFilter(value: unknown, fallback: TodoFilter): TodoFilter {
    return typeof value === 'string' && TODO_FILTERS.has(value as TodoFilter)
        ? value as TodoFilter
        : fallback;
}

export function cloneTodoItem(item: TodoItem): TodoItem {
    return { ...item };
}

export function cloneTodoSnapshot(snapshot: TodoSnapshot): TodoSnapshot {
    return {
        currentTaskTitle: snapshot.currentTaskTitle,
        items: snapshot.items.map(cloneTodoItem),
        activeFilter: snapshot.activeFilter,
        expanded: snapshot.expanded,
    };
}

export function createTodoStore(): TodoStore {
    return create<TodoState & TodoActions>((set, get) => ({
        ...defaultTodoSnapshot(),
        editingItemId: null,
        setCurrentTaskTitle: (currentTaskTitle) => set({ currentTaskTitle }),
        addCurrentTaskToTodo: () => {
            const title = get().currentTaskTitle.trim();
            if (!title) return null;
            const timestamp = nowMs();
            const item: TodoItem = {
                id: createTodoId(),
                title,
                completed: false,
                filter: get().activeFilter,
                startTime: '',
                endTime: '',
                createdAt: timestamp,
                updatedAt: timestamp,
                completedAt: null,
            };
            set((state) => ({
                currentTaskTitle: '',
                items: [item, ...state.items],
            }));
            return item;
        },
        setActiveFilter: (activeFilter) => set({ activeFilter }),
        setExpanded: (expanded) => set({ expanded }),
        beginEdit: (id) => {
            if (!get().items.some((item) => item.id === id)) return;
            set({ editingItemId: id });
        },
        finishEdit: (id) => {
            if (get().editingItemId !== id) return;
            set((state) => ({
                editingItemId: null,
                items: state.items.map((item) => (
                    item.id === id
                        ? { ...item, title: item.title.trim() || '未命名待办', updatedAt: nowMs() }
                        : item
                )),
            }));
        },
        updateItem: (id, patch) => set((state) => ({
            items: state.items.map((item) => (
                item.id === id
                    ? {
                        ...item,
                        ...('title' in patch ? { title: patch.title ?? item.title } : {}),
                        ...('startTime' in patch ? { startTime: patch.startTime ?? item.startTime } : {}),
                        ...('endTime' in patch ? { endTime: patch.endTime ?? item.endTime } : {}),
                        updatedAt: nowMs(),
                    }
                    : item
            )),
        })),
        toggleCompleted: (id) => set((state) => ({
            items: state.items.map((item) => {
                if (item.id !== id) return item;
                const completed = !item.completed;
                return {
                    ...item,
                    completed,
                    completedAt: completed ? nowMs() : null,
                    updatedAt: nowMs(),
                };
            }),
        })),
        deleteItem: (id) => set((state) => ({
            items: state.items.filter((item) => item.id !== id),
            editingItemId: state.editingItemId === id ? null : state.editingItemId,
        })),
        setItemAsCurrent: (id) => {
            const item = get().items.find((candidate) => candidate.id === id);
            if (!item) return;
            set({ currentTaskTitle: item.title });
        },
        hydrateTodo: (snapshot) => {
            const fallback = defaultTodoSnapshot();
            set({
                currentTaskTitle: typeof snapshot.currentTaskTitle === 'string'
                    ? snapshot.currentTaskTitle
                    : fallback.currentTaskTitle,
                items: Array.isArray(snapshot.items)
                    ? snapshot.items.map(cloneTodoItem)
                    : fallback.items,
                activeFilter: normalizeFilter(snapshot.activeFilter, fallback.activeFilter),
                expanded: typeof snapshot.expanded === 'boolean' ? snapshot.expanded : fallback.expanded,
                editingItemId: null,
            });
        },
    }));
}

export function visibleTodoItems(state: Pick<TodoState, 'items' | 'activeFilter'>): TodoItem[] {
    return state.items.filter((item) => item.filter === state.activeFilter);
}

export const useTodoStore: TodoStore = createTodoStore();
