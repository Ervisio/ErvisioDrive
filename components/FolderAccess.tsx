"use client";
import { useI18n } from "@/components/LocaleProvider";
import useSWR from "swr";
import { useState } from "react";
import { AdminModal } from "@/components/admin/AdminModal";
import { request } from "@/lib/client-request";
export function FolderAccess({
  slug,
  name,
  onClose,
}: {
  slug: string;
  name: string;
  onClose: () => void;
}) {
  const { t, dateLocale } = useI18n();

  const url = `/api/admin/cdn/folders/${slug}/access`,
    { data, mutate, error } = useSWR(url, (u) =>
      request(u).then((r) => r.json()),
    ),
    [email, setEmail] = useState(""),
    [busy, setBusy] = useState(false);
  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setEmail("");
      await mutate();
    } finally {
      setBusy(false);
    }
  }
  async function remove(userId: string) {
    await request(url, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    await mutate();
  }
  return (
    <AdminModal
      open
      title={t("Access rules · {name}", { name })}
      onClose={onClose}
    >
      <p className="mb-5 text-sm text-white/40">
        {t(
          "An empty list allows all authorized users. The owner and administrators retain access.",
        )}
      </p>
      {error ? (
        <p className="text-rose-400">
          {t(
            "Only the owner or an administrator can manage these access rules.",
          )}
        </p>
      ) : (
        <>
          <form onSubmit={add} className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="nome@esempio.it"
              aria-label={t("Authorized email")}
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 p-2 text-sm"
            />
            <button
              disabled={busy}
              className="rounded-lg bg-orange-500 px-4 text-sm disabled:opacity-50"
            >
              {t("Add")}
            </button>
          </form>
          <ul className="mt-5 space-y-3">
            {data?.allowedUsers?.map((u: { id: string; email: string }) => (
              <li
                key={u.id}
                className="flex items-center justify-between text-sm"
              >
                <span>{u.email}</span>
                <button
                  onClick={() => remove(u.id)}
                  className="text-xs text-rose-400"
                >
                  {t("Remove")}
                </button>
              </li>
            ))}
          </ul>
          {data?.isPublic && (
            <p className="mt-4 text-xs text-white/30">
              {t("Accessible to all whitelisted users.")}
            </p>
          )}
        </>
      )}
    </AdminModal>
  );
}
