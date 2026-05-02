import { useAppSettings } from "../AppSettingsContext";
import { useAuth } from "../auth/useAuth";

interface PaidApiToggleProps {
  /** Additional CSS class applied to the wrapper. */
  className?: string;
}

/**
 * Renders the paid-API toggle switch and the Google sign-in/out button.
 * Only mount this component when PAID_APIS_ENABLED === true (checked by caller).
 */
export default function PaidApiToggle({ className }: PaidApiToggleProps) {
  const { paidApisEnabled, setPaidApisEnabled } = useAppSettings();
  const { user, authLoading, login, logout } = useAuth();

  return (
    <div className={`paid-api-toggle-bar${className ? ` ${className}` : ""}`}>
      <label className="paid-api-toggle-label">
        <span className="paid-api-toggle-text">
          {paidApisEnabled ? "Premium APIs on" : "Premium APIs off"}
        </span>
        <span className="paid-api-toggle-switch">
          <input
            type="checkbox"
            role="switch"
            checked={paidApisEnabled}
            onChange={(e) => setPaidApisEnabled(e.target.checked)}
            aria-label="Enable premium APIs"
          />
          <span className="paid-api-toggle-slider" />
        </span>
      </label>

      {!authLoading &&
        (user ? (
          <div className="paid-api-user">
            {user.avatar_url && (
              <img
                src={user.avatar_url}
                alt={user.name}
                className="paid-api-avatar"
                referrerPolicy="no-referrer"
              />
            )}
            <span className="paid-api-user-name">{user.name}</span>
            <button
              type="button"
              className="ghost-btn paid-api-signout"
              onClick={logout}
            >
              Sign out
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="ghost-btn paid-api-signin"
            onClick={login}
          >
            <i className="fab fa-google" aria-hidden="true" /> Sign in with
            Google
          </button>
        ))}
    </div>
  );
}
