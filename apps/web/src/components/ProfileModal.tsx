import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { APP_LOCALES, type AppLocale } from "@dbkeeper/shared";
import { useAuth } from "../auth/AuthContext";
import { ApiClientError } from "../lib/api";
import { fileToAvatarDataUrl, initialsOf } from "../lib/avatar";
import { useToast } from "./Toast";
import { Modal } from "./Modal";

const errMsg = (e: unknown) => (e instanceof ApiClientError ? e.message : String(e));

export function ProfileModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { identity, updateProfile, changePassword } = useAuth();
  const toast = useToast();
  const user = identity!.user;
  const fileRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState(user.fullName ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [language, setLanguage] = useState(user.preferredLanguage ?? "");
  const [avatar, setAvatar] = useState<string | null>(user.avatar);

  const [curPwd, setCurPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");

  const [busy, setBusy] = useState(false);

  async function onPickFile(file: File) {
    try {
      setAvatar(await fileToAvatarDataUrl(file));
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function saveProfile() {
    setBusy(true);
    try {
      await updateProfile({
        fullName: fullName || null,
        email: email || null,
        preferredLanguage: (language || null) as AppLocale | null,
        avatar: avatar ?? "",
      });
      toast.success(t("profile.saved"));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function savePassword() {
    if (newPwd !== confirmPwd) {
      toast.error(t("profile.passwordMismatch"));
      return;
    }
    setBusy(true);
    try {
      await changePassword(curPwd, newPwd);
      setCurPwd("");
      setNewPwd("");
      setConfirmPwd("");
      toast.success(t("profile.passwordChanged"));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t("profile.title")} onClose={onClose} size="md">

      <div className="profile-avatar-row">
        <div className="avatar avatar-lg">
          {avatar ? <img src={avatar} alt="" /> : <span>{initialsOf(user.fullName || user.username)}</span>}
        </div>
        <div className="profile-avatar-actions">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => e.target.files?.[0] && onPickFile(e.target.files[0])}
          />
          <button type="button" className="secondary" onClick={() => fileRef.current?.click()}>
            {t("profile.changeAvatar")}
          </button>
          {avatar && (
            <button type="button" className="secondary" onClick={() => setAvatar(null)}>
              {t("profile.removeAvatar")}
            </button>
          )}
        </div>
      </div>

      <div className="form-grid">
        <label>
          {t("users.username")}
          <input value={user.username} disabled />
        </label>
        <label>
          {t("users.fullName")}
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </label>
        <label>
          {t("users.email")}
          <input value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          {t("profile.language")}
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="">{t("profile.systemDefault")}</option>
            {APP_LOCALES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-actions">
        <button onClick={saveProfile} disabled={busy}>
          {t("profile.saveProfile")}
        </button>
      </div>

      {user.authType === "local" ? (
        <>
          <hr className="sep" />
          <h3>{t("profile.changePassword")}</h3>
          <div className="form-grid">
            <label>
              {t("profile.currentPassword")}
              <input type="password" value={curPwd} onChange={(e) => setCurPwd(e.target.value)} />
            </label>
            <label>
              {t("profile.newPassword")}
              <input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
            </label>
            <label>
              {t("profile.confirmPassword")}
              <input type="password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} />
            </label>
          </div>
          <div className="form-actions">
            <button onClick={savePassword} disabled={busy || !curPwd || !newPwd}>
              {t("profile.changePassword")}
            </button>
          </div>
        </>
      ) : (
        <p className="muted">{t("profile.adManaged")}</p>
      )}
    </Modal>
  );
}
