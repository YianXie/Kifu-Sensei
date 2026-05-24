export interface Item {
    id: string;
    title: string;
    description: string;
    data: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}

export interface ItemCreate {
    title: string;
    description?: string;
    data?: Record<string, unknown>;
}

export interface ItemUpdate {
    title?: string;
    description?: string;
    data?: Record<string, unknown>;
}
