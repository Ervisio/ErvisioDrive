"use client";
export async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response
      .clone()
      .json()
      .catch(() => ({ error: "Richiesta non riuscita" }));
    const error = new Error(body.error || "Richiesta non riuscita");
    window.dispatchEvent(
      new CustomEvent("drive-error", { detail: error.message }),
    );
    throw error;
  }
  return response;
}
