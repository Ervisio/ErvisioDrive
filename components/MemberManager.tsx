"use client";
import { useI18n } from "@/components/LocaleProvider";
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
  const { t, dateLocale } = useI18n();

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
    <div className="page-wrap">
      <h1 className="text-xl font-bold">{t("Users and access")}</h1>
      <p className="mt-2 text-sm text-white/40">
        {t(
          "Add authorized email addresses. Revoking access immediately blocks sessions and links created by that user.",
        )}
      </p>
      <form
        onSubmit={add}
        className="my-8 flex flex-wrap gap-3 rounded-2xl border border-white/[0.06] bg-[#111118] p-5"
      >
        <label className="min-w-0 basis-full sm:basis-auto flex-1 text-xs text-white/50">
          {t("Authorized email")}
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
          {t("Role")}
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="mt-2 block rounded-lg border border-white/10 bg-[#1c1c28] px-3 py-2.5 text-sm text-white"
          >
            <option value="member">{t("Member")}</option>
            <option value="admin">{t("Administrator")}</option>
          </select>
        </label>
        <button
          disabled={busy}
          className="self-end rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? t("Adding…") : t("Authorize email")}
        </button>
      </form>
      {invitation && (
        <div className="mb-6 rounded-xl border border-orange-500/20 bg-orange-500/5 p-5">
          <p className="text-sm text-orange-400">
            {t("One-time invitation · valid for 48 hours")}
          </p>
          <p className="my-3 text-xs text-white/40">
            {t(
              "Send this privately to the authorized person to set or reset their password.",
            )}
          </p>
          <input
            aria-label={t("Invitation link")}
            readOnly
            value={invitation}
            className="w-full rounded-lg bg-black/30 p-3 font-mono text-xs"
          />
          <div className="mt-3 flex gap-4">
            <button
              onClick={() => navigator.clipboard.writeText(invitation)}
              className="text-xs text-orange-400"
            >
              {t("Copy link")}
            </button>
            <button
              onClick={() => setInvitation("")}
              className="text-xs text-white/40"
            >
              {t("Hide")}
            </button>
          </div>
        </div>
      )}
      {isLoading && <p className="text-white/40">{t("Loading…")}</p>}
      {error && (
        <p role="alert" className="text-rose-400">
          {t("Unable to load users.")}
        </p>
      )}
      <div className="overflow-x-auto rounded-2xl border border-white/[0.06]">
        <table className="responsive-table w-full text-left text-sm">
          <thead className="bg-[#111118] text-xs text-white/30">
            <tr>
              <th className="p-4">Account</th>
              <th>{t("Role")}</th>
              <th>{t("Last sign-in")}</th>
              <th className="p-4 text-right">{t("Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {data?.data?.map((member: Member) => (
              <tr key={member._id} className="border-t border-white/[0.04]">
                <td className="p-4">
                  <p>{member.email}</p>
                  <p className="mt-1 text-xs text-white/30">
                    {member.name || t("Waiting for first sign-in")}
                  </p>
                </td>
                <td className="text-orange-400">
                  {member.isOwner
                    ? t("Owner")
                    : member.role === "admin"
                      ? t("Administrator")
                      : t("Member")}
                </td>
                <td className="text-xs text-white/40">
                  {member.lastLogin
                    ? new Date(member.lastLogin).toLocaleString(dateLocale)
                    : t("Never")}
                </td>
                <td className="member-actions flex flex-wrap gap-2 p-4 text-xs">
                  <button
                    onClick={() => invite(member)}
                    className="secondary-button"
                  >
                    {t("Invite / reset")}
                  </button>
                  {!member.isOwner && (
                    <>
                      <button
                        onClick={() => change(member)}
                        className="text-white/50 hover:text-white"
                      >
                        {member.role === "admin"
                          ? t("Make member")
                          : t("Make admin")}
                      </button>
                      <button
                        onClick={() => setRemove(member)}
                        className="text-rose-400"
                      >
                        {t("Revoke")}
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
        title={t("Revoke access")}
        description={t(
          "Revoke access for {email}? Existing sessions and shared links will stop working. Files remain in the drive.",
          { email: remove?.email ?? "" },
        )}
        onConfirm={revoke}
        onCancel={() => setRemove(null)}
      />
    </div>
  );
}
