import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Globe, LogOut, UserCircle } from "lucide-react";
import { APP_LOCALES } from "@dbkeeper/shared";
import { useAuth } from "../auth/AuthContext";
import { initialsOf } from "../lib/avatar";
import { ProfileModal } from "./ProfileModal";

const LOCALE_LABELS: Record<string, string> = { "es-419": "Español (LatAm)", en: "English" };

export function UserMenu() {
  const { t, i18n } = useTranslation();
  const { identity, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  if (!identity) return null;
  const user = identity.user;

  async function onLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="user-menu" ref={ref}>
      <button type="button" className="user-trigger" onClick={() => setOpen((o) => !o)}>
        <span className="avatar">
          {user.avatar ? <img src={user.avatar} alt="" /> : <span>{initialsOf(user.fullName || user.username)}</span>}
        </span>
        <span className="user-id">
          <strong>{user.fullName || user.username}</strong>
          <small>{user.username}</small>
        </span>
        <ChevronDown size={16} strokeWidth={1.75} aria-hidden />
      </button>

      {open && (
        <div className="dropdown" role="menu">
          <button
            type="button"
            className="dropdown-item"
            onClick={() => {
              setShowProfile(true);
              setOpen(false);
            }}
          >
            <UserCircle size={16} strokeWidth={1.75} aria-hidden />
            {t("profile.title")}
          </button>

          <div className="dropdown-section">
            <span className="dropdown-label">
              <Globe size={14} strokeWidth={1.75} aria-hidden /> {t("common.language")}
            </span>
            {APP_LOCALES.map((l) => (
              <button
                key={l}
                type="button"
                className="dropdown-item sub"
                onClick={() => void i18n.changeLanguage(l)}
              >
                <span>{LOCALE_LABELS[l] ?? l}</span>
                {i18n.language === l && <Check size={15} strokeWidth={2} aria-hidden />}
              </button>
            ))}
          </div>

          <button type="button" className="dropdown-item danger" onClick={onLogout}>
            <LogOut size={16} strokeWidth={1.75} aria-hidden />
            {t("common.logout")}
          </button>
        </div>
      )}

      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
    </div>
  );
}
