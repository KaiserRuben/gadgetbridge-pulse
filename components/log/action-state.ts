export type LogActionState = {
  status: "idle" | "ok" | "error";
  message: string | null;
  ok_seq: number;
};

export const INITIAL_LOG_STATE: LogActionState = {
  status: "idle",
  message: null,
  ok_seq: 0,
};
