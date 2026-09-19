// Doble en memoria del cliente de Supabase (solo la parte que usan los
// módulos de src/lib/pedidos): cada consulta se registra como un objeto Q y
// un handler decide qué devolver. Permite verificar QUÉ se le pidió a la base
// (filtros, payloads de insert/update) sin tocar la base real.

export type Filtro = { op: string; col: string; val: unknown };
export type Q = {
  table: string;
  op: "select" | "insert" | "update" | "delete" | "upsert";
  payload?: any;
  filters: Filtro[];
  single: boolean;
  maybeSingle: boolean;
  head: boolean;
};
export type Resp = { data?: any; error?: any; count?: number | null };

export function eqDe(q: Q, col: string): unknown {
  return q.filters.find((f) => f.op === "eq" && f.col === col)?.val;
}

export function fakeAdmin(
  handler: (q: Q) => Resp | Promise<Resp> | undefined,
  rpcHandler: (name: string, args: any) => Resp | Promise<Resp> = () => ({ data: null }),
) {
  const calls: Q[] = [];
  const rpcCalls: { name: string; args: any }[] = [];

  function builder(table: string) {
    const q: Q = { table, op: "select", filters: [], single: false, maybeSingle: false, head: false };
    let opFijada = false;
    const fijar = (op: Q["op"], payload?: any) => { q.op = op; q.payload = payload; opFijada = true; return b; };
    const filtro = (op: string) => (col: string, val?: unknown) => { q.filters.push({ op, col, val }); return b; };
    const b: any = {
      select: (_cols?: string, opts?: { head?: boolean }) => { if (!opFijada) q.op = "select"; if (opts?.head) q.head = true; return b; },
      insert: (p: any) => fijar("insert", p),
      update: (p: any) => fijar("update", p),
      upsert: (p: any) => fijar("upsert", p),
      delete: () => fijar("delete"),
      single: () => { q.single = true; return b; },
      maybeSingle: () => { q.maybeSingle = true; return b; },
      order: () => b, limit: () => b, range: () => b,
      eq: filtro("eq"), neq: filtro("neq"), in: filtro("in"), gte: filtro("gte"), lte: filtro("lte"),
      gt: filtro("gt"), lt: filtro("lt"), is: filtro("is"), not: filtro("not"), or: filtro("or"),
      then: (resolve: (v: any) => any, reject?: (e: any) => any) => {
        calls.push(q);
        return Promise.resolve(handler(q) ?? { data: null })
          .then((r) => {
            let data = r.data ?? null;
            if ((q.single || q.maybeSingle) && Array.isArray(data)) data = data[0] ?? null;
            return { data, error: r.error ?? null, count: r.count ?? null };
          })
          .then(resolve, reject);
      },
    };
    return b;
  }

  const admin: any = {
    from: (t: string) => builder(t),
    rpc: (name: string, args: any) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(rpcHandler(name, args)).then((r) => ({ data: r.data ?? null, error: r.error ?? null }));
    },
  };
  return { admin, calls, rpcCalls };
}
