export async function readApiJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    throw new Error(
      `接口没有返回响应内容（HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}）`,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const detail = text.replace(/\s+/g, " ").trim().slice(0, 500);
    throw new Error(
      `接口返回了非 JSON 响应（HTTP ${response.status}）：${detail || "无内容"}`,
    );
  }
}
