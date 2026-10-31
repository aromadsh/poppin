const retryMessage = "검색 서버의 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.";

/** Nearby search streams progress; short API errors and route application remain JSON. */
export async function readNearbyResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-ndjson")) {
    if (!contentType.includes("application/json")) throw new Error(response.status === 504 || response.status === 524
      ? "검색 응답 시간이 초과됐어요. 잠시 후 주변 팝업을 다시 찾아 주세요." : retryMessage);
    try { return await response.json() as T; }
    catch (error) { if (error instanceof Error && error.name === "AbortError") throw error; throw new Error(retryMessage); }
  }
  if (!response.body) throw new Error(retryMessage);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      let chunk;
      try { chunk = await reader.read(); }
      catch (error) { if (error instanceof Error && error.name === "AbortError") throw error; throw new Error("검색 연결이 끊겼어요. 주변 팝업을 다시 찾아 주세요."); }
      const { value, done } = chunk;
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 1_000_000) throw new Error(retryMessage);
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      if (done && buffer.trim()) { lines.push(buffer); buffer = ""; }
      for (const line of lines) {
        if (!line.trim()) continue;
        let frame;
        try { frame = JSON.parse(line); } catch { throw new Error(retryMessage); }
        if (frame?.type === "result" || frame?.type === "error") {
          if (!frame.data || typeof frame.data !== "object" || Array.isArray(frame.data)) throw new Error(retryMessage);
          return frame.data as T;
        }
        if (frame?.type !== "progress") throw new Error(retryMessage);
      }
      if (done) throw new Error("검색 연결이 끊겼어요. 주변 팝업을 다시 찾아 주세요.");
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
