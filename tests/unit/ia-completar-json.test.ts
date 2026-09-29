import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { completarJson, limpiarRespuesta, type PedidoIA } from "@/lib/ia/completar-json";

const pedido: PedidoIA = { sistema: "s", usuario: "u", schema: { type: "object" }, nombreSchema: "x", maxTokens: 10 };
const ok = (contenido: string) => new Response(JSON.stringify({ choices: [{ message: { content: contenido } }] }), { status: 200 });
const falla = (status: number, msg = "x") => new Response(JSON.stringify({ error: { message: msg } }), { status });
const parsear = (t: string) => JSON.parse(t) as { a: number };

let fetchMock: ReturnType<typeof vi.fn>;
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.GROQ_API_KEY = "g"; process.env.OPENROUTER_API_KEY = "o";
  fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("completarJson", () => {
  it("usa Groq cuando responde y no toca OpenRouter", async () => {
    fetchMock.mockResolvedValueOnce(ok('{"a":1}'));
    const r = await completarJson(pedido, parsear);
    expect(r).toEqual({ valor: { a: 1 }, motor: "groq:qwen/qwen3.8-27b" });
    expect(urls()).toHaveLength(1);
  });

  it("si Groq no tiene el modelo (404) pasa a OpenRouter", async () => {
    fetchMock.mockResolvedValueOnce(falla(404, "model_not_found")).mockResolvedValueOnce(ok('{"a":2}'));
    const r = await completarJson(pedido, parsear);
    expect(r.valor).toEqual({ a: 2 });
    expect(r.motor).toMatch(/^openrouter:nvidia/);
    expect(urls()[1]).toContain("openrouter.ai");
  });

  it("una respuesta que el llamador no puede interpretar cuenta como falla y sigue con el próximo modelo", async () => {
    fetchMock.mockResolvedValueOnce(ok("no es json")).mockResolvedValueOnce(ok("```json\n{\"a\":3}\n```"));
    expect((await completarJson(pedido, parsear)).valor).toEqual({ a: 3 });
  });

  it("recorre los 3 modelos de OpenRouter antes de rendirse y junta el motivo de cada uno", async () => {
    fetchMock.mockResolvedValue(falla(404));
    const err = await completarJson(pedido, parsear).catch((e: Error) => e.message);
    for (const motor of ["groq:", "openrouter:nvidia", "openrouter:google/gemma-4-31b", "openrouter:google/gemma-4-26b"]) expect(err).toContain(motor);
    expect(urls()).toHaveLength(4);
  });

  it("un 429 de Groq se reintenta una vez antes de pasar de eslabón", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(falla(429)).mockResolvedValueOnce(ok('{"a":4}'));
    const p = completarJson(pedido, parsear);
    await vi.advanceTimersByTimeAsync(1500);
    expect((await p).motor).toBe("groq:qwen/qwen3.8-27b");
    expect(urls()).toHaveLength(2);
    vi.useRealTimers();
  });

  it("un 404 NO se reintenta (no es transitorio)", async () => {
    fetchMock.mockResolvedValueOnce(falla(404)).mockResolvedValueOnce(ok('{"a":5}'));
    await completarJson(pedido, parsear);
    expect(urls()[0]).toContain("groq.com");
    expect(urls()[1]).toContain("openrouter.ai");
  });

  it("sin key de Groq salta directo a OpenRouter; sin ninguna key falla sin llamar a la red", async () => {
    delete process.env.GROQ_API_KEY;
    fetchMock.mockResolvedValueOnce(ok('{"a":6}'));
    expect((await completarJson(pedido, parsear)).motor).toMatch(/^openrouter/);
    delete process.env.OPENROUTER_API_KEY; fetchMock.mockClear();
    await expect(completarJson(pedido, parsear)).rejects.toThrow(/no está configurada/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("con imagen la manda como data URL; Groq lleva json_schema y OpenRouter lo pide por prompt", async () => {
    fetchMock.mockResolvedValueOnce(falla(404)).mockResolvedValueOnce(ok('{"a":7}'));
    await completarJson({ ...pedido, imagen: { base64: "AAA", mimeType: "image/png" } }, parsear);
    const groq = JSON.parse(fetchMock.mock.calls[0][1].body);
    const or = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(groq.response_format.type).toBe("json_schema");
    expect(groq.messages[1].content[1].image_url.url).toBe("data:image/png;base64,AAA");
    expect(or.response_format).toBeUndefined();
    expect(or.messages[1].content[0].text).toContain("ÚNICAMENTE con el JSON");
  });
});

describe("limpiarRespuesta", () => {
  it("saca el bloque <think> y las marcas de markdown", () => {
    expect(limpiarRespuesta('<think>hmm</think>```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
});
