import "server-only";

import { randomUUID } from "node:crypto";

import { pulseDb } from "../pulse-db";
import { getWritableDb } from "../db-writable";
import type { TrainingChatMessageV1 } from "../types/generated";

export interface ThreadRow {
  id: string;
  created_at: string;
  title: string | null;
  last_message_at: string | null;
}

export interface MessageRow {
  id: number;
  thread_id: string;
  role: TrainingChatMessageV1["role"];
  created_at: string;
  delivered_at: string | null;
  status: TrainingChatMessageV1["status"];
  content: string | null;
  context_snapshot: unknown | null;
  model: string | null;
  endpoint: TrainingChatMessageV1["endpoint"];
  extracted_proposal_id: number | null;
  error: string | null;
}

interface MessageRawRow extends Omit<MessageRow, "role" | "status" | "endpoint" | "context_snapshot"> {
  role: string;
  status: string;
  endpoint: string | null;
  context_snapshot_json: string | null;
}

const SELECT_MSG = `
  id, thread_id, role, created_at, delivered_at, status, content, context_snapshot_json,
  model, endpoint, extracted_proposal_id, error
`;

function rowToMessage(r: MessageRawRow): MessageRow {
  return {
    id: r.id,
    thread_id: r.thread_id,
    role: r.role as MessageRow["role"],
    created_at: r.created_at,
    delivered_at: r.delivered_at,
    status: r.status as MessageRow["status"],
    content: r.content,
    context_snapshot: r.context_snapshot_json ? JSON.parse(r.context_snapshot_json) : null,
    model: r.model,
    endpoint: r.endpoint as MessageRow["endpoint"],
    extracted_proposal_id: r.extracted_proposal_id,
    error: r.error,
  };
}

export function createThread(title: string | null = null): ThreadRow {
  const db = getWritableDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO PULSE_CHAT_THREAD (id, created_at, title, last_message_at)
     VALUES (?, ?, ?, ?)`,
  ).run(id, now, title, now);
  return { id, created_at: now, title, last_message_at: now };
}

export function readThread(id: string): ThreadRow | null {
  const db = pulseDb();
  if (!db) return null;
  try {
    const row = db
      .prepare<[string], ThreadRow>(
        `SELECT id, created_at, title, last_message_at
         FROM PULSE_CHAT_THREAD WHERE id = ?`,
      )
      .get(id);
    return row ?? null;
  } catch {
    return null;
  }
}

export function listThreads(limit = 20): ThreadRow[] {
  const db = pulseDb();
  if (!db) return [];
  try {
    return db
      .prepare<[], ThreadRow>(
        `SELECT id, created_at, title, last_message_at
         FROM PULSE_CHAT_THREAD
         ORDER BY COALESCE(last_message_at, created_at) DESC
         LIMIT ${limit}`,
      )
      .all();
  } catch {
    return [];
  }
}

export function listMessages(threadId: string): MessageRow[] {
  const db = pulseDb();
  if (!db) return [];
  try {
    const rows = db
      .prepare<[string], MessageRawRow>(
        `SELECT ${SELECT_MSG} FROM PULSE_CHAT_MESSAGE
         WHERE thread_id = ?
         ORDER BY created_at, id`,
      )
      .all(threadId);
    return rows.map(rowToMessage);
  } catch {
    return [];
  }
}

export interface CreateMessageInput {
  thread_id: string;
  role: TrainingChatMessageV1["role"];
  content: string | null;
  status?: TrainingChatMessageV1["status"];
  context_snapshot?: unknown | null;
  model?: string | null;
}

export function createMessage(input: CreateMessageInput): MessageRow {
  const db = getWritableDb();
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO PULSE_CHAT_MESSAGE
         (thread_id, role, created_at, status, content, context_snapshot_json, model)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.thread_id,
      input.role,
      now,
      input.status ?? "queued",
      input.content,
      input.context_snapshot ? JSON.stringify(input.context_snapshot) : null,
      input.model ?? null,
    );
  db.prepare(`UPDATE PULSE_CHAT_THREAD SET last_message_at = ? WHERE id = ?`).run(
    now,
    input.thread_id,
  );
  const row = db
    .prepare<[number], MessageRawRow>(`SELECT ${SELECT_MSG} FROM PULSE_CHAT_MESSAGE WHERE id = ?`)
    .get(Number(info.lastInsertRowid));
  if (!row) throw new Error("chat message vanished after insert");
  return rowToMessage(row);
}

export interface UpdateMessageInput {
  id: number;
  status?: TrainingChatMessageV1["status"];
  content?: string | null;
  endpoint?: TrainingChatMessageV1["endpoint"];
  delivered_at?: string;
  extracted_proposal_id?: number | null;
  error?: string | null;
}

export function updateMessage(input: UpdateMessageInput): MessageRow | null {
  const db = getWritableDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  if (input.status !== undefined) {
    fields.push("status = ?");
    values.push(input.status);
  }
  if (input.content !== undefined) {
    fields.push("content = ?");
    values.push(input.content);
  }
  if (input.endpoint !== undefined) {
    fields.push("endpoint = ?");
    values.push(input.endpoint);
  }
  if (input.delivered_at !== undefined) {
    fields.push("delivered_at = ?");
    values.push(input.delivered_at);
  }
  if (input.extracted_proposal_id !== undefined) {
    fields.push("extracted_proposal_id = ?");
    values.push(input.extracted_proposal_id);
  }
  if (input.error !== undefined) {
    fields.push("error = ?");
    values.push(input.error);
  }
  if (fields.length === 0) return null;
  values.push(input.id);
  db.prepare(`UPDATE PULSE_CHAT_MESSAGE SET ${fields.join(", ")} WHERE id = ?`).run(
    ...(values as never[]),
  );
  const row = db
    .prepare<[number], MessageRawRow>(`SELECT ${SELECT_MSG} FROM PULSE_CHAT_MESSAGE WHERE id = ?`)
    .get(input.id);
  return row ? rowToMessage(row) : null;
}

export function nextQueuedMessage(): MessageRow | null {
  const db = pulseDb();
  if (!db) return null;
  try {
    const row = db
      .prepare<[], MessageRawRow>(
        `SELECT ${SELECT_MSG} FROM PULSE_CHAT_MESSAGE
         WHERE role = 'user' AND status = 'queued'
         ORDER BY created_at ASC
         LIMIT 1`,
      )
      .get();
    return row ? rowToMessage(row) : null;
  } catch {
    return null;
  }
}
