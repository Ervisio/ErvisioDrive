"use client";
import { useState } from "react";
import useSWR from "swr";
import { request } from "@/lib/client-request";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
type Member = {
  _id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  isOwner: boolean;
  lastLogin: string | null;
};
export function MemberManager() {
  const { data, error, isLoading, mutate } = useSWR(
    "/api/admin/members",
    (url) => request(url).then((r) => r.json()),
  );
  const [email, setEmail] = useState(""),
    [role, setRole] = useState("member"),
    [busy, setBusy] = useState(false),
    [remove, setRemove] = useState<Member | null>(null),
    [invitation, setInvitation] = useState("");
  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await request("/api/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      setInvitation((await result.json()).invitation || "");
      setEmail("");
      await mutate();
    } finally {
      setBusy(false);
    }
  }
  async function invite(member: Member) {
    const result = await request("/api/admin/members", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: member._id, action: "invite" }),
    });
    setInvitation((await result.json()).invitation);
  }
  async function change(member: Member) {
    await request("/api/admin/members", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: member._id,
        role: member.role === "admin" ? "member" : "admin",
      }),
    });
    await mutate();
  }
  async function revoke() {
    if (!remove) return;
    await request("/api/admin/members", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: remove._id }),
    });
    setRemove(null);
    await mutate();
  }
  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="text-xl font-bold">Utenti e accessi</h1>
      <p className="mt-2 text-sm text-white/40">
        Aggiungi le email autorizzate. La revoca blocca subito le sessioni
        aperte e i link creati dall’utente.
      </p>
      <form
        onSubmit={add}
        className="my-8 flex flex-wrap gap-3 rounded-2xl border border-white/[0.06] bg-[#111118] p-5"
      >
        <label className="min-w-48 flex-1 text-xs text-white/50">
          Email autorizzata
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nome@esempio.it"
            className="mt-2 block w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white"
          />
        </label>
        <label className="text-xs text-white/50">
          Ruolo
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="mt-2 block rounded-lg border border-white/10 bg-[#1c1c28] px-3 py-2.5 text-sm text-white"
          >
            <option value="member">Membro</option>
            <option value="admin">Amministratore</option>
          </select>
        </label>
        <button
          disabled={busy}
          className="self-end rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? "Aggiunta…" : "Autorizza email"}
        </button>
      </form>
      {invitation && (
        <div className="mb-6 rounded-xl border border-orange-500/20 bg-orange-500/5 p-5">
          <p className="text-sm text-orange-400">
            Invito monouso · valido 48 ore
          </p>
          <p className="my-3 text-xs text-white/40">
            Consegnalo privatamente alla persona autorizzata per impostare o
            reimpostare la password.
          </p>
          <input
            aria-label="Link di invito"
            readOnly
            value={invitation}
            className="w-full rounded-lg bg-black/30 p-3 font-mono text-xs"
          />
          <div className="mt-3 flex gap-4">
            <button
              onClick={() => navigator.clipboard.writeText(invitation)}
              className="text-xs text-orange-400"
            >
              Copia link
            </button>
            <button
              onClick={() => setInvitation("")}
              className="text-xs text-white/40"
            >
              Nascondi
            </button>
          </div>
        </div>
      )}
      {isLoading && <p className="text-white/40">Caricamento…</p>}
      {error && (
        <p role="alert" className="text-rose-400">
          Impossibile caricare gli utenti.
        </p>
      )}
      <div className="overflow-x-auto rounded-2xl border border-white/[0.06]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#111118] text-xs text-white/30">
            <tr>
              <th className="p-4">Account</th>
              <th>Ruolo</th>
              <th>Ultimo accesso</th>
              <th className="p-4 text-right">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {data?.data?.map((member: Member) => (
              <tr key={member._id} className="border-t border-white/[0.04]">
                <td className="p-4">
                  <p>{member.email}</p>
                  <p className="mt-1 text-xs text-white/30">
                    {member.name || "In attesa del primo accesso"}
                  </p>
                </td>
                <td className="text-orange-400">
                  {member.isOwner
                    ? "Proprietario"
                    : member.role === "admin"
                      ? "Amministratore"
                      : "Membro"}
                </td>
                <td className="text-xs text-white/40">
                  {member.lastLogin
                    ? new Date(member.lastLogin).toLocaleString("it-IT")
                    : "Mai"}
                </td>
                <td className="space-x-3 p-4 text-right text-xs">
                  <button
                    onClick={() => invite(member)}
                    className="text-orange-400"
                  >
                    Invito / reset
                  </button>
                  {!member.isOwner && (
                    <>
                      <button
                        onClick={() => change(member)}
                        className="text-white/50 hover:text-white"
                      >
                        {member.role === "admin"
                          ? "Rendi membro"
                          : "Rendi admin"}
                      </button>
                      <button
                        onClick={() => setRemove(member)}
                        className="text-rose-400"
                      >
                        Revoca
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={!!remove}
        title="Revoca accesso"
        description={`Revocare l’accesso a ${remove?.email}? Le sessioni e i link condivisi dell’utente smetteranno di funzionare. I file restano nel drive.`}
        onConfirm={revoke}
        onCancel={() => setRemove(null)}
      />
    </div>
  );
}
