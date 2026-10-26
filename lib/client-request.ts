"use client";
export async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response
      .clone()
      .json()
      .catch(() => ({ error: "Request failed" }));
    const error = new Error(body.error || "Request failed");
    window.dispatchEvent(
      new CustomEvent("drive-error", { detail: error.message }),
    );
    throw error;
  }
  return response;
}
